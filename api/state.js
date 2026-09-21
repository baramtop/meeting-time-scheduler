const { createClient } = require('redis');

// 서버리스 인스턴스가 살아있는 동안 연결을 재사용
let clientPromise = null;
function getClient() {
  if (!clientPromise) {
    const client = createClient({ url: process.env.REDIS_URL });
    client.on('error', (e) => console.error('redis error', e.message));
    clientPromise = client.connect().then(() => client).catch((e) => {
      clientPromise = null;
      throw e;
    });
  }
  return clientPromise;
}

const kv = {
  async get(key) {
    const raw = await (await getClient()).get(key);
    return raw ? JSON.parse(raw) : null;
  },
  async set(key, value, opts) {
    const args = opts && opts.ex ? { EX: opts.ex } : undefined;
    await (await getClient()).set(key, JSON.stringify(value), args);
  },
};

const ADMIN_NAME = '면죄';
const CONFIG_KEY = 'meeting:config';
const DEFAULT_CONFIG = { weekday: 3, hour: 20, minute: 0 }; // 수요일 20:00 (KST)
const KST_MS = 9 * 60 * 60 * 1000;
const TTL = 60 * 60 * 24 * 21;

// 서버 타임존(UTC)과 무관하게 KST 기준으로 계산
function getUpcomingDefault(config) {
  const nowMs = Date.now();
  const k = new Date(nowMs + KST_MS);
  const diff = (config.weekday - k.getUTCDay() + 7) % 7;
  let ms = Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate() + diff, config.hour, config.minute) - KST_MS;
  if (ms <= nowMs) ms += 7 * 24 * 60 * 60 * 1000;
  // 관리자가 '클리어'한 주는 건너뜀 (skipBefore 이전/같은 일정은 다음 주로 넘김)
  const skip = config.skipBefore ? new Date(config.skipBefore).getTime() : 0;
  while (ms <= skip) ms += 7 * 24 * 60 * 60 * 1000;
  return new Date(ms);
}

function getWeekId(date) {
  const k = new Date(date.getTime() + KST_MS);
  const d = new Date(Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

// ISO 시각 -> KST 기준 'YYYY-MM-DD'
function kstDateStr(iso) {
  return new Date(new Date(iso).getTime() + KST_MS).toISOString().slice(0, 10);
}

function emptyState(weekId, defaultDate) {
  return {
    weekId,
    defaultDateTime: defaultDate.toISOString(),
    responses: {},
    availability: {}, // { 이름: { 'YYYY-MM-DD': 'yes' | 'no' } }
    fromTimes: {}, // { 이름: { 'YYYY-MM-DD': 'HH:MM' } } 가능한 시작 시각
    finalized: null,
  };
}

function normalize(state) {
  state.responses = state.responses || {};
  state.availability = state.availability || {};
  state.fromTimes = state.fromTimes || {};
  return state;
}

module.exports = async (req, res) => {
  try {
    const config = (await kv.get(CONFIG_KEY)) || DEFAULT_CONFIG;
    const defaultDate = getUpcomingDefault(config);
    const weekId = getWeekId(defaultDate);
    const key = `meeting:${weekId}`;

    if (req.method === 'GET') {
      const state = (await kv.get(key)) || emptyState(weekId, defaultDate);
      res.status(200).json(normalize(state));
      return;
    }

    if (req.method === 'POST') {
      const body = req.body || {};
      const { action } = body;
      const name = String(body.name || '').trim();
      if (!name) {
        res.status(400).json({ error: '이름을 입력해주세요.' });
        return;
      }

      // 관리자 전용 동작: 이름이 관리자이고 비밀번호가 맞아야 함
      const ADMIN_ACTIONS = ['set_default', 'clear_week', 'finalize', 'unfinalize'];
      if (ADMIN_ACTIONS.includes(action)) {
        if (name !== ADMIN_NAME) {
          res.status(403).json({ error: '관리자만 할 수 있습니다.' });
          return;
        }
        const adminPin = process.env.ADMIN_PIN;
        if (!adminPin) {
          res.status(500).json({ error: '서버에 ADMIN_PIN이 설정되지 않았습니다.' });
          return;
        }
        if (String(body.pin || '') !== adminPin) {
          res.status(403).json({ error: '관리자 비밀번호가 올바르지 않습니다.' });
          return;
        }
      }

      if (action === 'set_default') {
        const dt = new Date(body.dateTime);
        if (!body.dateTime || isNaN(dt.getTime())) {
          res.status(400).json({ error: '날짜/시간을 입력해주세요.' });
          return;
        }
        let newConfig = config;
        if (body.recurring) {
          const k = new Date(dt.getTime() + KST_MS);
          newConfig = { ...config, weekday: k.getUTCDay(), hour: k.getUTCHours(), minute: k.getUTCMinutes() };
          await kv.set(CONFIG_KEY, newConfig);
        }
        // 기본 일정이 바뀌면 기존 응답/확정은 초기화
        const newWeekId = getWeekId(getUpcomingDefault(newConfig));
        const fresh = emptyState(newWeekId, dt);
        await kv.set(`meeting:${newWeekId}`, fresh, { ex: TTL });
        res.status(200).json(fresh);
        return;
      }

      if (action === 'clear_week') {
        // 지금 표시 중인 주를 비우고 다음 주 일정으로 넘어감
        const current = (await kv.get(key)) || emptyState(weekId, defaultDate);
        const newConfig = { ...config, skipBefore: current.defaultDateTime };
        await kv.set(CONFIG_KEY, newConfig);
        const nextDate = getUpcomingDefault(newConfig);
        const fresh = emptyState(getWeekId(nextDate), nextDate);
        await kv.set(`meeting:${fresh.weekId}`, fresh, { ex: TTL });
        res.status(200).json(fresh);
        return;
      }

      const state = normalize((await kv.get(key)) || emptyState(weekId, defaultDate));
      const defaultDay = kstDateStr(state.defaultDateTime);

      // 요일 응답 반영 + 기본 일정 날짜면 기본 일정 응답과 동기화
      // value: 'yes' | 'no' | '' (해제), from: 'HH:MM' (가능한 시작 시각, 가능일 때만)
      const setDay = (date, value, from) => {
        const mine = { ...(state.availability[name] || {}) };
        const times = { ...(state.fromTimes[name] || {}) };
        if (value === 'yes' || value === 'no') mine[date] = value;
        else delete mine[date];
        if (value === 'yes' && from) times[date] = from;
        else if (value !== 'yes') delete times[date];
        state.availability[name] = mine;
        state.fromTimes[name] = times;
        if (date === defaultDay) {
          if (mine[date]) state.responses[name] = mine[date];
          else delete state.responses[name];
        }
      };
      const validDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d);

      if (action === 'respond') {
        // 기본 일정에 대한 가능/불가능
        setDay(defaultDay, body.value === 'no' ? 'no' : 'yes', (state.fromTimes[name] || {})[defaultDay]);
      } else if (action === 'set_day') {
        const date = String(body.date || '');
        if (!validDate(date)) {
          res.status(400).json({ error: '날짜가 올바르지 않습니다.' });
          return;
        }
        setDay(date, body.value, (state.fromTimes[name] || {})[date]);
      } else if (action === 'set_from') {
        // 몇 시부터 가능한지: 시간을 넣으면 그 날은 '가능'으로 표시됨, 빈 값이면 시각만 해제
        const date = String(body.date || '');
        const from = String(body.from || '');
        if (!validDate(date) || (from && !/^([01]\d|2[0-3]):[0-5]\d$/.test(from))) {
          res.status(400).json({ error: '날짜 또는 시간이 올바르지 않습니다.' });
          return;
        }
        if (from) {
          setDay(date, 'yes', from);
        } else {
          const times = { ...(state.fromTimes[name] || {}) };
          delete times[date];
          state.fromTimes[name] = times;
        }
      } else if (action === 'finalize') {
        const dt = new Date(body.dateTime);
        if (!body.dateTime || isNaN(dt.getTime())) {
          res.status(400).json({ error: '확정할 날짜/시간이 올바르지 않습니다.' });
          return;
        }
        state.finalized = { dateTime: dt.toISOString(), by: name, at: new Date().toISOString() };
      } else if (action === 'unfinalize') {
        state.finalized = null;
      } else {
        res.status(400).json({ error: '알 수 없는 요청입니다.' });
        return;
      }

      await kv.set(key, state, { ex: TTL });
      res.status(200).json(state);
      return;
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error', detail: String(err && err.message) });
  }
};
