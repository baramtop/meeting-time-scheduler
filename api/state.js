const { kv } = require('@vercel/kv');

function getSeoulNow() {
  const now = new Date();
  const seoulStr = now.toLocaleString('en-US', { timeZone: 'Asia/Seoul' });
  return new Date(seoulStr);
}

// 다가오는(아직 지나지 않은) 수요일 오후 8시를 반환
function getUpcomingWednesday8pm() {
  const now = getSeoulNow();
  const day = now.getDay(); // 0=일 ... 3=수 ... 6=토
  let diff = (3 - day + 7) % 7;
  const candidate = new Date(now);
  candidate.setHours(20, 0, 0, 0);
  candidate.setDate(now.getDate() + diff);
  if (diff === 0 && candidate.getTime() <= now.getTime()) {
    candidate.setDate(candidate.getDate() + 7);
  }
  return candidate;
}

function getWeekId(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
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
    const defaultDate = getUpcomingWednesday8pm();
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
