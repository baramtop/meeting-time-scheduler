const NAME_KEY = 'meetingScheduler.myName';
const ADMIN_NAME = '면죄';
const KST_MS = 9 * 60 * 60 * 1000;
const DAY_KO = ['일', '월', '화', '수', '목', '금', '토'];

const el = {
  nameInput: document.getElementById('name-input'),
  nameSaveBtn: document.getElementById('name-save-btn'),
  nameCurrent: document.getElementById('name-current'),
  finalizedCard: document.getElementById('finalized-card'),
  finalizedTime: document.getElementById('finalized-time'),
  finalizedMeta: document.getElementById('finalized-meta'),
  unfinalizeBtn: document.getElementById('unfinalize-btn'),
  defaultTimeDisplay: document.getElementById('default-time-display'),
  btnYes: document.getElementById('btn-yes'),
  btnNo: document.getElementById('btn-no'),
  yesCount: document.getElementById('yes-count'),
  noCount: document.getElementById('no-count'),
  yesList: document.getElementById('yes-list'),
  noList: document.getElementById('no-list'),
  finalizeDefaultBtn: document.getElementById('finalize-default-btn'),
  bestBox: document.getElementById('best-box'),
  dayList: document.getElementById('day-list'),
  confirmTime: document.getElementById('confirm-time'),
  adminCard: document.getElementById('admin-card'),
  adminDatetime: document.getElementById('admin-datetime'),
  adminRecurring: document.getElementById('admin-recurring'),
  adminSetBtn: document.getElementById('admin-set-btn'),
};

let currentState = null;
let renderedDefault = null;

function getMyName() {
  return (localStorage.getItem(NAME_KEY) || '').trim();
}

function setMyName(name) {
  localStorage.setItem(NAME_KEY, name.trim());
}

function formatDateTime(iso) {
  if (!iso) return '-';
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    month: 'long',
    day: 'numeric',
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(new Date(iso));
}

// ISO -> KST 벽시계 Date (UTC getter로 읽으면 KST 값)
function toKst(iso) {
  return new Date(new Date(iso).getTime() + KST_MS);
}

function pad(n) {
  return String(n).padStart(2, '0');
}

// 공대 주기는 수요일 시작: 기본 일정이 속한 수~화 7일
const WEEK_START_DOW = 3;
function weekDays(defaultIso) {
  const k = toKst(defaultIso);
  const offset = (k.getUTCDay() - WEEK_START_DOW + 7) % 7; // 수요일까지 거슬러 올라갈 일수
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate() - offset + i));
    days.push({
      date: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`,
      label: `${d.getUTCMonth() + 1}/${d.getUTCDate()} (${DAY_KO[d.getUTCDay()]})`,
    });
  }
  return days;
}

function todayKst() {
  const d = new Date(Date.now() + KST_MS);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

async function fetchState() {
  const res = await fetch('/api/state');
  if (!res.ok) throw new Error('상태를 불러오지 못했습니다.');
  return res.json();
}

async function postAction(payload) {
  const name = getMyName();
  if (!name) {
    alert('먼저 이름을 입력하고 저장해주세요.');
    throw new Error('no name');
  }
  const res = await fetch('/api/state', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...payload, name }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    alert(err.error || '요청에 실패했습니다.');
    throw new Error(err.error || 'request failed');
  }
  return res.json();
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function renderDays(state, myName) {
  const days = weekDays(state.defaultDateTime);
  const defaultDay = days.find((d) => d.date === toKst(state.defaultDateTime).toISOString().slice(0, 10));
  const avail = state.availability || {};
  const fromTimes = state.fromTimes || {};
  const members = new Set([...Object.keys(state.responses || {}), ...Object.keys(avail)]);
  const today = todayKst();
  const finalizedDay = state.finalized ? toKst(state.finalized.dateTime).toISOString().slice(0, 10) : null;

  const stats = days.map((d) => {
    const yes = [];
    const no = [];
    members.forEach((n) => {
      const v = (avail[n] || {})[d.date];
      if (v === 'yes') yes.push({ name: n, from: (fromTimes[n] || {})[d.date] || '' });
      else if (v === 'no') no.push(n);
    });
    // 가능한 사람들의 시작 시각 중 가장 늦은 값 = 모두 모일 수 있는 시각 (없으면 시간 제한 없음)
    const lateFrom = yes.reduce((m, y) => (y.from > m ? y.from : m), '');
    return { ...d, yes, no, lateFrom, none: members.size - yes.length - no.length, past: d.date < today };
  });

  // 추천: 불가 0명이면서 가능이 가장 많은 날 (지난 날 제외)
  const candidates = stats.filter((s) => !s.past && s.no.length === 0 && s.yes.length > 0);
  const maxYes = candidates.reduce((m, s) => Math.max(m, s.yes.length), 0);
  const best = new Set(candidates.filter((s) => s.yes.length === maxYes).map((s) => s.date));
  const lateText = (s) => (s.lateFrom ? ` (${s.lateFrom}부터)` : '');

  if (members.size === 0) {
    el.bestBox.className = 'best-box';
    el.bestBox.textContent = '아직 응답한 사람이 없어요.';
  } else if (best.size > 0) {
    const names = stats.filter((s) => best.has(s.date)).map((s) => s.label + lateText(s)).join(', ');
    el.bestBox.className = 'best-box good';
    el.bestBox.innerHTML = `⭐ 추천: <b>${escapeHtml(names)}</b><br><span>불가 0명 · 가능 ${maxYes}명 (응답 ${members.size}명 중)</span>`;
  } else {
    el.bestBox.className = 'best-box warn';
    el.bestBox.textContent = `응답 ${members.size}명 · 아직 모두가 되는 날이 없어요. 가능한 날을 더 체크해 주세요.`;
  }

  el.dayList.innerHTML = stats.map((s) => {
    const mine = (avail[myName] || {})[s.date];
    const badges = [
      defaultDay && s.date === defaultDay.date ? '<span class="badge base">기본</span>' : '',
      best.has(s.date) ? '<span class="badge best">추천</span>' : '',
      s.date === finalizedDay ? '<span class="badge fin">확정</span>' : '',
    ].join('');
    const dis = s.past ? 'disabled' : '';
    return `
      <li class="day-row ${best.has(s.date) ? 'is-best' : ''} ${s.past ? 'is-past' : ''}">
        <div class="day-head">
          <span class="day-label">${s.label}</span>${badges}
          <span class="day-count">가능 ${s.yes.length} · 불가 ${s.no.length}${s.none > 0 ? ` · 미응답 ${s.none}` : ''}</span>
        </div>
        ${s.no.length ? `<div class="day-names no-names">불가: ${s.no.map(escapeHtml).join(', ')}</div>` : ''}
        ${s.yes.length ? `<div class="day-names yes-names">가능: ${s.yes.map((y) => escapeHtml(y.name) + (y.from ? `<span class="from-tag">${y.from}~</span>` : '')).join(', ')}</div>` : ''}
        <div class="day-actions">
          <button class="day-btn yes ${mine === 'yes' ? 'active' : ''}" data-day="${s.date}" data-val="yes" ${dis}>가능</button>
          <button class="day-btn no ${mine === 'no' ? 'active' : ''}" data-day="${s.date}" data-val="no" ${dis}>불가</button>
          <button class="day-btn fin-btn" data-confirm="${s.date}" ${dis}>이 날로 확정</button>
        </div>
        <div class="from-row">
          <label>몇 시부터 가능? (비우면 시간 상관없음)</label>
          <input type="time" class="from-input" data-from-day="${s.date}" value="${(fromTimes[myName] || {})[s.date] || ''}" ${dis} />
          ${(fromTimes[myName] || {})[s.date] ? `<button class="from-clear" data-from-clear="${s.date}" ${dis}>지우기</button>` : ''}
        </div>
      </li>`;
  }).join('');
}

function render(state) {
  currentState = state;
  const myName = getMyName();

  el.adminCard.hidden = myName !== ADMIN_NAME;

  // 기본 일정
  el.defaultTimeDisplay.textContent = formatDateTime(state.defaultDateTime);
  if (renderedDefault !== state.defaultDateTime) {
    renderedDefault = state.defaultDateTime;
    const k = toKst(state.defaultDateTime);
    el.confirmTime.value = `${pad(k.getUTCHours())}:${pad(k.getUTCMinutes())}`;
  }

  const responses = state.responses || {};
  const myResponse = responses[myName];
  el.btnYes.classList.toggle('active', myResponse === 'yes');
  el.btnNo.classList.toggle('active', myResponse === 'no');

  const yesNames = Object.entries(responses).filter(([, v]) => v === 'yes').map(([n]) => n);
  const noNames = Object.entries(responses).filter(([, v]) => v === 'no').map(([n]) => n);
  el.yesCount.textContent = yesNames.length;
  el.noCount.textContent = noNames.length;
  el.yesList.innerHTML = yesNames.map((n) => `<li>${escapeHtml(n)}</li>`).join('');
  el.noList.innerHTML = noNames.map((n) => `<li>${escapeHtml(n)}</li>`).join('');

  renderDays(state, myName);

  // 확정 배너
  if (state.finalized) {
    el.finalizedCard.hidden = false;
    el.finalizedTime.textContent = formatDateTime(state.finalized.dateTime);
    el.finalizedMeta.textContent = `${state.finalized.by}님이 확정함`;
  } else {
    el.finalizedCard.hidden = true;
  }

  el.nameCurrent.textContent = myName ? `현재 이름: ${myName}` : '이름을 입력해야 응답할 수 있어요.';
}

async function refresh() {
  try {
    const state = await fetchState();
    // 시간 입력 중에는 화면을 다시 그리지 않음 (입력창이 초기화되는 것 방지)
    const a = document.activeElement;
    if (a && a.classList && a.classList.contains('from-input')) {
      currentState = state;
      return;
    }
    render(state);
  } catch (e) {
    console.error(e);
  }
}

el.nameInput.value = getMyName();

el.nameSaveBtn.addEventListener('click', () => {
  const v = el.nameInput.value.trim();
  if (!v) {
    alert('이름을 입력해주세요.');
    return;
  }
  setMyName(v);
  refresh();
});

el.btnYes.addEventListener('click', async () => {
  render(await postAction({ action: 'respond', value: 'yes' }));
});

el.btnNo.addEventListener('click', async () => {
  render(await postAction({ action: 'respond', value: 'no' }));
});

el.finalizeDefaultBtn.addEventListener('click', async () => {
  if (!currentState) return;
  if (!confirm('기본 일정으로 이번 주 일정을 확정할까요?')) return;
  render(await postAction({ action: 'finalize', dateTime: currentState.defaultDateTime }));
});

el.unfinalizeBtn.addEventListener('click', async () => {
  if (!confirm('확정을 취소할까요?')) return;
  render(await postAction({ action: 'unfinalize' }));
});

el.dayList.addEventListener('click', async (e) => {
  const dayBtn = e.target.closest('[data-day]');
  if (dayBtn && !dayBtn.disabled) {
    const myName = getMyName();
    const current = ((currentState && currentState.availability || {})[myName] || {})[dayBtn.dataset.day];
    const value = current === dayBtn.dataset.val ? '' : dayBtn.dataset.val; // 같은 버튼 다시 누르면 해제
    render(await postAction({ action: 'set_day', date: dayBtn.dataset.day, value }));
    return;
  }
  const clearBtn = e.target.closest('[data-from-clear]');
  if (clearBtn && !clearBtn.disabled) {
    render(await postAction({ action: 'set_from', date: clearBtn.dataset.fromClear, from: '' }));
    return;
  }
  const finBtn = e.target.closest('[data-confirm]');
  if (finBtn && !finBtn.disabled) {
    const time = el.confirmTime.value || '20:00';
    const dt = new Date(`${finBtn.dataset.confirm}T${time}:00+09:00`);
    if (isNaN(dt.getTime())) {
      alert('확정 시간을 확인해주세요.');
      return;
    }
    const dayInfo = currentState && currentState.fromTimes
      ? Object.entries(currentState.fromTimes)
          .map(([n, m]) => [n, m[finBtn.dataset.confirm]])
          .filter(([n, t]) => t && t > time && ((currentState.availability[n] || {})[finBtn.dataset.confirm] === 'yes'))
      : [];
    const warn = dayInfo.length
      ? `

⚠️ 이 시간에 아직 안 되는 사람: ${dayInfo.map(([n, t]) => `${n}(${t}부터)`).join(', ')}`
      : '';
    if (!confirm(`${formatDateTime(dt.toISOString())}로 확정할까요?${warn}`)) return;
    render(await postAction({ action: 'finalize', dateTime: dt.toISOString() }));
  }
});

el.dayList.addEventListener('change', async (e) => {
  const input = e.target.closest('[data-from-day]');
  if (!input) return;
  render(await postAction({ action: 'set_from', date: input.dataset.fromDay, from: input.value }));
});

el.adminSetBtn.addEventListener('click', async () => {
  const v = el.adminDatetime.value;
  if (!v) {
    alert('날짜와 시간을 선택해주세요.');
    return;
  }
  const recurring = el.adminRecurring.checked;
  const msg = recurring
    ? '기본 일정을 변경하고 다음 주부터도 같은 요일·시간으로 할까요? (이번 주 응답이 초기화됩니다)'
    : '이번 주 기본 일정만 변경할까요? (이번 주 응답이 초기화됩니다)';
  if (!confirm(msg)) return;
  const pin = prompt('관리자 비밀번호를 입력하세요.');
  if (!pin) return;
  const state = await postAction({ action: 'set_default', dateTime: new Date(v).toISOString(), recurring, pin });
  el.adminDatetime.value = '';
  el.adminRecurring.checked = false;
  render(state);
});

refresh();
setInterval(refresh, 5000);
