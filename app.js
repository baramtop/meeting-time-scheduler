const NAME_KEY = 'meetingScheduler.myName';
const ADMIN_NAME = '면죄';

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
  altDatetime: document.getElementById('alt-datetime'),
  altProposeBtn: document.getElementById('alt-propose-btn'),
  proposalList: document.getElementById('proposal-list'),
  adminCard: document.getElementById('admin-card'),
  adminDatetime: document.getElementById('admin-datetime'),
  adminRecurring: document.getElementById('admin-recurring'),
  adminSetBtn: document.getElementById('admin-set-btn'),
};

let currentState = null;

function getMyName() {
  return (localStorage.getItem(NAME_KEY) || '').trim();
}

function setMyName(name) {
  localStorage.setItem(NAME_KEY, name.trim());
}

function formatDateTime(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  const formatted = new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    month: 'long',
    day: 'numeric',
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(d);
  return formatted;
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

function render(state) {
  currentState = state;
  const myName = getMyName();

  el.adminCard.hidden = myName !== ADMIN_NAME;

  // 기본 일정
  el.defaultTimeDisplay.textContent = formatDateTime(state.defaultDateTime);

  const myResponse = state.responses[myName];
  el.btnYes.classList.toggle('active', myResponse === 'yes');
  el.btnNo.classList.toggle('active', myResponse === 'no');

  const yesNames = Object.entries(state.responses).filter(([, v]) => v === 'yes').map(([n]) => n);
  const noNames = Object.entries(state.responses).filter(([, v]) => v === 'no').map(([n]) => n);
  el.yesCount.textContent = yesNames.length;
  el.noCount.textContent = noNames.length;
  el.yesList.innerHTML = yesNames.map((n) => `<li>${escapeHtml(n)}</li>`).join('');
  el.noList.innerHTML = noNames.map((n) => `<li>${escapeHtml(n)}</li>`).join('');

  // 대안 제안 목록 (투표 많은 순)
  const proposals = [...state.proposals].sort((a, b) => b.votes.length - a.votes.length);
  el.proposalList.innerHTML = proposals.map((p) => {
    const voted = p.votes.includes(myName);
    return `
      <li class="proposal-item">
        <div>
          <div class="proposal-time">${formatDateTime(p.dateTime)}</div>
          <div class="proposal-meta">${p.votes.length}명 참여 가능 · ${escapeHtml(p.createdBy)}님 제안</div>
        </div>
        <div class="proposal-actions">
          <button class="vote-btn ${voted ? 'voted' : ''}" data-vote-id="${p.id}">${voted ? '✓ 가능' : '가능'}</button>
          <button class="finalize-small-btn" data-finalize-id="${p.id}" data-finalize-time="${p.dateTime}">확정</button>
        </div>
      </li>
    `;
  }).join('') || '<p class="hint">아직 제안된 대안이 없습니다.</p>';

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

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

async function refresh() {
  try {
    const state = await fetchState();
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
  const state = await postAction({ action: 'respond', value: 'yes' });
  render(state);
});

el.btnNo.addEventListener('click', async () => {
  const state = await postAction({ action: 'respond', value: 'no' });
  render(state);
});

el.finalizeDefaultBtn.addEventListener('click', async () => {
  if (!currentState) return;
  if (!confirm('기본 일정으로 이번 주 모임을 확정할까요?')) return;
  const state = await postAction({ action: 'finalize', dateTime: currentState.defaultDateTime });
  render(state);
});

el.unfinalizeBtn.addEventListener('click', async () => {
  if (!confirm('확정을 취소할까요?')) return;
  const state = await postAction({ action: 'unfinalize' });
  render(state);
});

el.altProposeBtn.addEventListener('click', async () => {
  const v = el.altDatetime.value;
  if (!v) {
    alert('날짜와 시간을 선택해주세요.');
    return;
  }
  const iso = new Date(v).toISOString();
  const state = await postAction({ action: 'propose', dateTime: iso });
  el.altDatetime.value = '';
  render(state);
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

el.proposalList.addEventListener('click', async (e) => {
  const voteBtn = e.target.closest('[data-vote-id]');
  if (voteBtn) {
    const state = await postAction({ action: 'vote', proposalId: voteBtn.dataset.voteId });
    render(state);
    return;
  }
  const finalizeBtn = e.target.closest('[data-finalize-id]');
  if (finalizeBtn) {
    if (!confirm('이 시간으로 이번 주 모임을 확정할까요?')) return;
    const state = await postAction({
      action: 'finalize',
      proposalId: finalizeBtn.dataset.finalizeId,
      dateTime: finalizeBtn.dataset.finalizeTime,
    });
    render(state);
  }
});

refresh();
setInterval(refresh, 5000);
