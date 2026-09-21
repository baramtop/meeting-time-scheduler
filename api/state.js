const { kv } = require('@vercel/kv');

const ADMIN_NAME = '면죄';
const CONFIG_KEY = 'meeting:config';
const DEFAULT_CONFIG = { weekday: 3, hour: 20, minute: 0 }; // 수요일 20:00 (KST)
const KST_MS = 9 * 60 * 60 * 1000;

// 서버 타임존(UTC)과 무관하게 KST 기준으로 계산
function getUpcomingDefault(config) {
  const nowMs = Date.now();
  const k = new Date(nowMs + KST_MS);
  const diff = (config.weekday - k.getUTCDay() + 7) % 7;
  let ms = Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate() + diff, config.hour, config.minute) - KST_MS;
  if (ms <= nowMs) ms += 7 * 24 * 60 * 60 * 1000;
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

function emptyState(weekId, defaultDate) {
  return {
    weekId,
    defaultDateTime: defaultDate.toISOString(),
    responses: {},
    proposals: [],
    finalized: null,
  };
}

module.exports = async (req, res) => {
  try {
    const config = (await kv.get(CONFIG_KEY)) || DEFAULT_CONFIG;
    const defaultDate = getUpcomingDefault(config);
    const weekId = getWeekId(defaultDate);
    const key = `meeting:${weekId}`;

    if (req.method === 'GET') {
      const state = (await kv.get(key)) || emptyState(weekId, defaultDate);
      res.status(200).json(state);
      return;
    }

    if (req.method === 'POST') {
      const body = req.body || {};
      const { action, name } = body;
      if (!name || !String(name).trim()) {
        res.status(400).json({ error: '이름을 입력해주세요.' });
        return;
      }

      if (action === 'set_default') {
        if (String(name).trim() !== ADMIN_NAME) {
          res.status(403).json({ error: '관리자만 기본 일정을 변경할 수 있습니다.' });
          return;
        }
        const dt = new Date(body.dateTime);
        if (!body.dateTime || isNaN(dt.getTime())) {
          res.status(400).json({ error: '날짜/시간을 입력해주세요.' });
          return;
        }
        let newConfig = config;
        if (body.recurring) {
          const k = new Date(dt.getTime() + KST_MS);
          newConfig = { weekday: k.getUTCDay(), hour: k.getUTCHours(), minute: k.getUTCMinutes() };
          await kv.set(CONFIG_KEY, newConfig);
        }
        // 기본 일정이 바뀌면 기존 응답/확정은 초기화
        const newWeekId = getWeekId(getUpcomingDefault(newConfig));
        const fresh = emptyState(newWeekId, dt);
        await kv.set(`meeting:${newWeekId}`, fresh, { ex: 60 * 60 * 24 * 21 });
        res.status(200).json(fresh);
        return;
      }

      let state = (await kv.get(key)) || emptyState(weekId, defaultDate);

      if (action === 'respond') {
        state.responses[name] = body.value === 'no' ? 'no' : 'yes';
      } else if (action === 'propose') {
        const dateTime = body.dateTime;
        if (!dateTime) {
          res.status(400).json({ error: '날짜/시간을 입력해주세요.' });
          return;
        }
        const existing = state.proposals.find((p) => p.dateTime === dateTime);
        if (!existing) {
          state.proposals.push({
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            dateTime,
            createdBy: name,
            votes: [name],
          });
        } else if (!existing.votes.includes(name)) {
          existing.votes.push(name);
        }
      } else if (action === 'vote') {
        const proposal = state.proposals.find((p) => p.id === body.proposalId);
        if (proposal) {
          const idx = proposal.votes.indexOf(name);
          if (idx >= 0) proposal.votes.splice(idx, 1);
          else proposal.votes.push(name);
        }
      } else if (action === 'finalize') {
        state.finalized = {
          dateTime: body.dateTime,
          proposalId: body.proposalId || null,
          by: name,
          at: new Date().toISOString(),
        };
      } else if (action === 'unfinalize') {
        state.finalized = null;
      } else {
        res.status(400).json({ error: '알 수 없는 요청입니다.' });
        return;
      }

      await kv.set(key, state, { ex: 60 * 60 * 24 * 21 });
      res.status(200).json(state);
      return;
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error', detail: String(err && err.message) });
  }
};
