const socket = io();
let lastState = null;
let pendingSkill = null;      // { cardInstanceId, skillId, targetType, skillName }
let pendingAttach = null;     // { handInstanceId, cardName }
let pendingConsumable = null; // { handInstanceId, defId, cardName, needsTarget }
let placingCard = null;
let predationState = null;    // { cardInstanceId }
let dragData = null;          // 드래그 중인 카드 정보

// 모바일/PC 우클릭 및 롱프레스 터치 시 '이미지 복사하기' 브라우저 팝업 차단
window.addEventListener('contextmenu', (e) => e.preventDefault());

// 1. 모바일 화면 상단 당겨서 새로고침 (Pull-to-Refresh) 차단
let _lastTouchY = 0;
window.addEventListener('touchstart', (e) => {
  if (e.touches.length === 1) _lastTouchY = e.touches[0].clientY;
}, { passive: true });

window.addEventListener('touchmove', (e) => {
  if (e.touches.length === 1) {
    const touchY = e.touches[0].clientY;
    const touchDiff = touchY - _lastTouchY;
    if (window.scrollY <= 0 && touchDiff > 0) {
      if (e.cancelable) e.preventDefault();
    }
  }
}, { passive: false });

// 2. 대전 진행 중 실수로 새로고침/뒤로가기/창 닫기 방지 경고 팝업
window.addEventListener('beforeunload', (e) => {
  const gameView = document.getElementById('gameView');
  const isMatchInProgress = gameView && gameView.style.display !== 'none' && lastState && !lastState.winner;
  if (isMatchInProgress) {
    e.preventDefault();
    e.returnValue = '대전이 진행 중입니다. 정말로 나가시겠습니까?';
    return e.returnValue;
  }
});



// 카드 데이터 캐시
let rawCardsData = { mobs: [], items: [] };
let allCardsMap = {};

// 덱 빌더 상태 (20장 배열)
let myDeckList = [];

// ===== 닉네임 & 덱 초기화 =====
let currentNickname = localStorage.getItem('goa_nickname') || '플레이어';
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('currentNicknameDisplay').textContent = currentNickname;
  loadInitialDeckFromStorage();
  loadDeckData();
});

function getNickname() { return currentNickname || '플레이어'; }

function openNicknameModal() {
  document.getElementById('nicknameModal').classList.add('active');
  const inp = document.getElementById('nicknameInput');
  inp.value = currentNickname;
  inp.focus();
}
function closeNicknameModal() { document.getElementById('nicknameModal').classList.remove('active'); }
function saveNickname() {
  const val = document.getElementById('nicknameInput').value.trim();
  if (val) {
    currentNickname = val;
    localStorage.setItem('goa_nickname', val);
    document.getElementById('currentNicknameDisplay').textContent = val;
  }
  closeNicknameModal();
}

function openPlayModal() {
  document.getElementById('playModal').classList.add('active');
  document.getElementById('playOptionsGroup').style.display = '';
  document.getElementById('matchWaitingBox').style.display = 'none';
}
function closePlayModal() { document.getElementById('playModal').classList.remove('active'); }
function openDeckModal() {
  document.getElementById('deckModal').classList.add('active');
  renderDeckBuilder();
}
function closeDeckModal() { document.getElementById('deckModal').classList.remove('active'); }

// ===== 덱 데이터 & 덱 빌더 관리 =====
function loadInitialDeckFromStorage() {
  try {
    const saved = localStorage.getItem('goa_custom_deck');
    if (saved) {
      myDeckList = JSON.parse(saved);
    } else {
      myDeckList = getDefaultDeckList();
    }
  } catch (e) {
    myDeckList = getDefaultDeckList();
  }
}

function getDefaultDeckList() {
  // 기본 추천 20장 덱 (몹 12장, 아이템 8장)
  return [
    'card_jeonjangyeon', 'card_jeonjangyeon',
    'card_inmyeoneo', 'card_inmyeoneo',
    'card_garados',
    'card_jammanbo', 'card_jammanbo',
    'card_meka', 'card_meka',
    'card_jongyeonchu', 'card_jongyeonchu',
    'card_jaeonjaehae',
    'item_innaeryeok', 'item_innaeryeok',
    'item_hakseupryeok', 'item_hakseupryeok',
    'item_sahoechinhwaryeok', 'item_sahoechinhwaryeok',
    'item_ppa', 'item_chaekgabang'
  ];
}

function getCustomDeck() {
  if (Array.isArray(myDeckList) && myDeckList.length === 20) {
    return myDeckList;
  }
  return null;
}

function loadDeckData() {
  fetch('/api/cards')
    .then(r => r.json())
    .then(data => {
      rawCardsData = data;
      allCardsMap = {};
      for (const m of (data.mobs || [])) allCardsMap[m.id] = m;
      for (const i of (data.items || [])) allCardsMap[i.id] = i;

      renderDeckGrid(data.mobs || [], 'deckMobGrid', 'mob');
      renderDeckGrid(data.items || [], 'deckItemGrid', 'item');
      renderDeckBuilder();
    })
    .catch(() => {});
}

function switchDeckTab(tab) {
  const tabBuilder = document.getElementById('deckTabBuilder');
  const tabCatalog = document.getElementById('deckTabCatalog');
  const btnBuilder = document.getElementById('deckTabBuilderBtn');
  const btnCatalog = document.getElementById('deckTabCatalogBtn');

  if (tab === 'builder') {
    tabBuilder.style.display = 'flex';
    tabCatalog.style.display = 'none';
    btnBuilder.classList.add('active');
    btnCatalog.classList.remove('active');
    renderDeckBuilder();
  } else {
    tabBuilder.style.display = 'none';
    tabCatalog.style.display = 'block';
    btnBuilder.classList.remove('active');
    btnCatalog.classList.add('active');
  }
}

function renderDeckBuilder() {
  const poolEl = document.getElementById('builderPoolGrid');
  const currentEl = document.getElementById('builderCurrentList');
  const countBadge = document.getElementById('deckCountBadge');
  const compText = document.getElementById('deckCompositionText');
  if (!poolEl || !currentEl) return;

  // 1. 상단 통계
  const mobCount = myDeckList.filter(id => allCardsMap[id]?.type === 'mob').length;
  const itemCount = myDeckList.filter(id => allCardsMap[id]?.type !== 'mob').length;
  countBadge.textContent = `${myDeckList.length} / 20장`;
  if (myDeckList.length === 20) {
    countBadge.style.color = '#10b981';
  } else {
    countBadge.style.color = '#f59e0b';
  }
  compText.textContent = `(몹: ${mobCount}장, 아이템: ${itemCount}장)`;

  // 2. 우측 현재 덱 리스트
  currentEl.innerHTML = '';
  if (myDeckList.length === 0) {
    currentEl.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:20px;font-size:13px;">덱이 비어 있습니다. 왼쪽 카드 풀에서 카드를 추가하세요.</p>';
  } else {
    myDeckList.forEach((id, idx) => {
      const c = allCardsMap[id];
      if (!c) return;
      const row = document.createElement('div');
      row.className = 'deck-item-row';
      const isMob = c.type === 'mob';
      row.innerHTML = `
        <div style="display:flex;align-items:center;gap:8px;">
          <span style="color:var(--text-muted);font-size:11px;">#${idx + 1}</span>
          <b>${c.name}</b>
          <span style="font-size:11px;color:${isMob ? '#60a5fa' : '#34d399'};">[${isMob ? '몹' : '아이템'}]</span>
        </div>
        <button style="background:#ef4444;color:#fff;border:none;border-radius:4px;padding:3px 8px;font-size:11px;cursor:pointer;"
                onclick="removeCardFromDeck(${idx})">제거 ✕</button>
      `;
      currentEl.appendChild(row);
    });
  }

  // 3. 좌측 카드 풀 그리드
  poolEl.innerHTML = '';
  const allPool = [...(rawCardsData.mobs || []), ...(rawCardsData.items || [])];
  allPool.forEach(c => {
    if (c.hidden) return; // 각성 리즈시절 등 히든 카드는 덱에 직접 편성 불가

    const inDeckCount = myDeckList.filter(id => id === c.id).length;
    const maxLimit = c.deckLimit || 2;
    const isFull = inDeckCount >= maxLimit;

    const div = document.createElement('div');
    div.className = 'deck-card-item';
    div.style.padding = '8px 10px';
    div.style.cursor = isFull || myDeckList.length >= 20 ? 'not-allowed' : 'pointer';
    if (isFull) div.style.opacity = '0.5';

    const isMob = c.type === 'mob';
    const limitTag = c.deckLimit === 1 ? '<span style="color:#f87171;font-size:10px;">[1장 제한]</span>' : '';
    const imgHtml = c.image ? `<img src="/image/${c.image}" style="max-height:80px;object-fit:contain;border-radius:4px;margin-bottom:4px;" />` : '';

    div.innerHTML = `
      ${imgHtml}
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <b>${c.name}</b>
        <span style="font-size:11px;font-weight:700;color:${isFull ? '#f87171' : 'var(--primary)'}">${inDeckCount}/${maxLimit}</span>
      </div>
      <div style="font-size:11px;color:${isMob ? '#60a5fa' : '#34d399'}">${isMob ? `몹 HP ${c.hp}` : '아이템'} ${limitTag}</div>
    `;

    div.onclick = () => {
      addCardToDeck(c.id);
    };
    poolEl.appendChild(div);
  });
}

function addCardToDeck(id) {
  if (myDeckList.length >= 20) {
    alert('덱은 최대 20장까지만 구성할 수 있습니다.');
    return;
  }
  const c = allCardsMap[id];
  if (!c) return;
  const inDeckCount = myDeckList.filter(cardId => cardId === id).length;
  const maxLimit = c.deckLimit || 2;
  if (inDeckCount >= maxLimit) {
    alert(`[${c.name}] 카드는 최대 ${maxLimit}장까지만 덱에 넣을 수 있습니다.`);
    return;
  }
  myDeckList.push(id);
  renderDeckBuilder();
}

function removeCardFromDeck(index) {
  myDeckList.splice(index, 1);
  renderDeckBuilder();
}

function fillDefaultDeck() {
  myDeckList = getDefaultDeckList();
  renderDeckBuilder();
  alert('추천 기본 20장 덱으로 채웠습니다. 💾 덱 저장을 눌러 저장하세요.');
}

function clearCustomDeck() {
  myDeckList = [];
  renderDeckBuilder();
}

function saveCustomDeck() {
  if (myDeckList.length !== 20) {
    alert(`덱은 반드시 정확히 20장이어야 합니다! (현재 ${myDeckList.length}장)`);
    return;
  }
  const mobCount = myDeckList.filter(id => allCardsMap[id]?.type === 'mob').length;
  if (mobCount < 3) {
    alert('원활한 게임을 위해 최소 3장 이상의 몹 카드를 포함해주세요.');
    return;
  }
  localStorage.setItem('goa_custom_deck', JSON.stringify(myDeckList));
  alert('🎉 덱이 성공적으로 저장되었습니다! 대전 시 이 덱으로 플레이합니다.');
  closeDeckModal();
}

function renderDeckGrid(cards, containerId, type) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = '';
  for (const c of cards) {
    const div = document.createElement('div');
    div.className = 'deck-card-item';
    const imgHtml = c.image ? `<img src="/image/${c.image}" alt="${c.name}" />` : '';
    const typeLabel = type === 'mob'
      ? `<span class="deck-card-type-mob">몹 | HP ${c.hp}</span>`
      : `<span class="deck-card-type-item">${c.type === 'item_attach' ? '장착 아이템' : '소모 아이템'}</span>`;
    const traitHtml = c.trait ? `<div style="color:#8fd;font-size:11px;margin-top:4px;">[${c.trait.name}] ${c.trait.desc}</div>` : '';
    const skillsHtml = (c.skills || []).map(s => `<div style="font-size:11px;color:#ccc;margin-top:2px;">▸ ${s.name}: ${s.desc}</div>`).join('');
    const descHtml = c.desc ? `<div style="font-size:11px;color:#ccc;margin-top:4px;">${c.desc}</div>` : '';
    div.innerHTML = `${imgHtml}<b>${c.name}</b>${typeLabel}${traitHtml}${skillsHtml}${descHtml}`;
    el.appendChild(div);
  }
}

// ===== 플레이 모달 (커스텀 덱 전달) =====
function startMatchmaking() {
  document.getElementById('playOptionsGroup').style.display = 'none';
  document.getElementById('matchWaitingBox').style.display = 'block';
  socket.emit('findMatch', { nickname: getNickname(), customDeck: getCustomDeck() });
}
function cancelMatchmaking() {
  socket.emit('cancelFindMatch');
  document.getElementById('playOptionsGroup').style.display = '';
  document.getElementById('matchWaitingBox').style.display = 'none';
}
function joinWithCode() {
  const code = document.getElementById('joinRoomCodeInput').value.trim();
  if (!code) return alert('방 코드를 입력하세요.');
  socket.emit('joinRoom', { code, nickname: getNickname(), customDeck: getCustomDeck() });
}
function createNewRoom() {
  socket.emit('createRoom', { nickname: getNickname(), customDeck: getCustomDeck() });
}
function leaveToMainLobby() { location.reload(); }

// ===== 로그 =====
function log(msg) {
  const el = document.getElementById('log');
  if (!el) return;
  const d = document.createElement('div');
  d.textContent = msg;
  el.appendChild(d);
  el.scrollTop = el.scrollHeight;
}

// ===== 사운드 효과 (Web Audio API) =====
function playTurnSound(isMe) {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    const now = ctx.currentTime;
    if (isMe) {
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(523.25, now);
      osc.frequency.setValueAtTime(659.25, now + 0.08);
      osc.frequency.setValueAtTime(783.99, now + 0.16);
      gain.gain.setValueAtTime(0.3, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
      osc.start(now);
      osc.stop(now + 0.5);
    } else {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(261.63, now);
      osc.frequency.setValueAtTime(220.00, now + 0.12);
      gain.gain.setValueAtTime(0.25, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
      osc.start(now);
      osc.stop(now + 0.4);
    }
  } catch (err) {}
}

// ===== 소켓 이벤트 =====
socket.on('roomJoined', ({ code }) => {
  closePlayModal();
  document.getElementById('mainLobbyView').style.display = 'none';
  document.getElementById('gameView').style.display = 'block';
  document.getElementById('roomCode').textContent = code;
});
socket.on('waitingForOpponent', () => {});
socket.on('errorMsg', ({ error }) => {
  alert(error);
  log(`❌ 오류: ${error}`);
});
socket.on('opponentLeft', () => alert('상대방이 게임을 나갔습니다.'));
socket.on('gameOverFinal', ({ winner }) => {
  log(`🏆 === 게임 종료: ${winner} 승리! ===`);
  showGameOverModal(winner);
});

function showGameOverModal(winnerNickname) {
  const modal = document.getElementById('gameOverModal');
  const icon = document.getElementById('gameOverIcon');
  const title = document.getElementById('gameOverTitle');
  const sub = document.getElementById('gameOverSub');
  const box = document.getElementById('gameOverBox');
  if (!modal || !title || !sub) return;

  const isMeWinner = lastState && lastState.me && lastState.me.nickname === winnerNickname;

  if (isMeWinner) {
    icon.textContent = '🏆';
    title.textContent = 'VICTORY!';
    title.style.color = '#fbbf24';
    sub.textContent = `축하합니다! ${winnerNickname} 님이 대전에서 승리하셨습니다.`;
    box.style.borderColor = '#fbbf24';
    box.style.boxShadow = '0 0 80px rgba(245, 158, 11, 0.6)';
  } else {
    icon.textContent = '💀';
    title.textContent = 'DEFEAT';
    title.style.color = '#ef4444';
    sub.textContent = `${winnerNickname} 님이 승리하셨습니다. 다음 기회에 다시 도전하세요!`;
    box.style.borderColor = '#ef4444';
    box.style.boxShadow = '0 0 80px rgba(239, 68, 68, 0.6)';
  }

  modal.style.display = 'flex';
}

// 애니메이션 연출 중 수신된 최신 state 대기용
let _pendingState = null;

// ===== 애니메이션 이벤트 큐 (아이템 팝업 -> 코인 -> 진화 순서 보장) =====
let _eventQueue = [];
let _eventQueueRunning = false;

function enqueueEvents(events) {
  _eventQueue.push(...events);
  if (!_eventQueueRunning) _drainEventQueue();
}

function _drainEventQueue() {
  if (_eventQueue.length === 0) {
    _eventQueueRunning = false;
    if (_pendingState) {
      lastState = _pendingState;
      render(_pendingState);
      _pendingState = null;
    }
    return;
  }
  _eventQueueRunning = true;
  const e = _eventQueue.shift();
  const delay = _processEvent(e);
  setTimeout(() => _drainEventQueue(), delay);
}

// 특정 카드의 HP만 연출 타이밍에 맞춰 DOM 단계적 반영
function updateCardHpDom(instanceId, newHp) {
  const cardEl = document.querySelector(`[data-instance-id="${instanceId}"]`);
  if (!cardEl) return;
  const hpTextEl = cardEl.querySelector('.hp-text, .card-hp');
  if (hpTextEl) {
    hpTextEl.textContent = `HP ${newHp}`;
  }
  const hpBarEl = cardEl.querySelector('.hp-bar-fill');
  if (hpBarEl && cardEl._maxHp) {
    const pct = Math.max(0, Math.min(100, (newHp / cardEl._maxHp) * 100));
    hpBarEl.style.width = pct + '%';
  }
}

// 카드 파괴 / 트레쉬 이동 연출
function triggerCardDestructionAnim(instanceId) {
  const cardEl = document.querySelector(`[data-instance-id="${instanceId}"]`);
  if (!cardEl) return;
  cardEl.classList.add('card-destroyed-anim');
}

// 모든 카드의 opacity 및 드래그 상태 리셋 (모바일 잠김 방지)
function resetAllCardStyles() {
  document.querySelectorAll('.card').forEach(el => {
    el.style.opacity = '1';
  });
  dragData = null;
}

// 이벤트 처리 후 다음 이벤트까지 기다릴 ms 반환
function _processEvent(e) {
  if (e.type === 'log') {
    log(e.payload.message);
    return 0;
  }
  if (e.type === 'coinFlip') {
    if (e.payload.isInitiative) {
      const iAmFirst = (e.payload.firstPlayerSocketId === socket.id) ||
                       (lastState && lastState.me && lastState.me.nickname === e.payload.firstPlayerNickname);
      showInitiativeCoinFlip(iAmFirst, e.payload.firstPlayerNickname);
      return 2200;
    } else {
      log(`🪙 동전 던지기 (${e.payload.reason}) -> ${e.payload.result === 'heads' ? '앞면' : '뒷면'}`);
      showCoinFlip(e.payload.reason, e.payload.result);
      return 1800;
    }
  }
  if (e.type === 'damage') {
    log(`💥 ${e.payload.amount} 피해 (hp -> ${e.payload.hpAfter})`);
    showFloatingEffect(e.payload.instanceId, `-${e.payload.amount}`, 'damage');
    updateCardHpDom(e.payload.instanceId, e.payload.hpAfter);
    return 400;
  }
  if (e.type === 'heal') {
    log(`💚 ${e.payload.amount} 회복 (hp -> ${e.payload.hpAfter})`);
    showFloatingEffect(e.payload.instanceId, `+${e.payload.amount}`, 'heal');
    updateCardHpDom(e.payload.instanceId, e.payload.hpAfter);
    return 400;
  }
  if (e.type === 'death') {
    log(`☠ ${e.payload.name} 쓰러짐`);
    triggerCardDestructionAnim(e.payload.instanceId);
    return 750;
  }
  if (e.type === 'specialEvolution') {
    log(`✨ 특수 연출: ${e.payload.name}`);
    if (e.payload.kind === 'gakseong_awaken') {
      showGakseongSummon(e.payload.name);
      return 3200; // 각성 연출 3.2초 대기
    }
    showSpecialEffect(e.payload.name, e.payload.kind);
    return 2500;
  }
  if (e.type === 'turnChange') {
    showTurnChange(e.payload.nickname, e.payload.turnNumber, e.payload.socketId);
    return 1200; // 턴 전환 오버레이 노출 동안 대기
  }
  if (e.type === 'skillCast') {
    triggerSkillVfx(e.payload);
    return 1500; // 공격/스킬 VFX 애니메이션(컷인, 투사체, 타격)이 완료된 후 턴 전환 이벤트 진행
  }
  if (e.type === 'itemUsed') {
    showItemUsePopup(e.payload);
    return 1800; // 아이템 팝업 끝난 후 동전/진화 연출 시작
  }
  if (e.type === 'cardDrawn') {
    playDrawCardSound();
    return 0;
  }
  if (e.type === 'fieldKeyword') {
    // 필드 키워드 변경 시 즉시 시각 이펙트
    triggerFieldKeywordVfx(e.payload.keyword, e.payload.owner);
    return 400;
  }
  return 0;
}

socket.on('events', (events) => {
  enqueueEvents(events);
});

socket.on('state', (state) => {
  if (_eventQueueRunning || _eventQueue.length > 0) {
    _pendingState = state;
  } else {
    lastState = state;
    render(state);
  }
});

// ===== 선/후공 전용 코인 플립 연출 (선공=앞면, 후공=뒷면) =====
function showInitiativeCoinFlip(iAmFirst, firstNickname) {
  const overlay = document.getElementById('coinFlipOverlay');
  const coinEl = document.getElementById('coinFace');
  const reasonEl = document.getElementById('coinReason');
  const resultEl = document.getElementById('coinResult');

  reasonEl.textContent = '선공 / 후공 결정 동전 던지기';
  coinEl.className = 'coin ' + (iAmFirst ? 'heads' : 'tails');
  coinEl.textContent = iAmFirst ? '😀' : '😢';

  if (iAmFirst) {
    resultEl.innerHTML = '<span style="color:#10b981;font-size:26px;">🎉 앞면 (선공 당첨!)</span><div style="font-size:15px;color:#fff;margin-top:4px;">당신이 먼저 공격합니다!</div>';
  } else {
    resultEl.innerHTML = `<span style="color:#f87171;font-size:26px;">🛡️ 뒷면 (후공 당첨!)</span><div style="font-size:15px;color:#fff;margin-top:4px;">[${firstNickname}] 님이 선공입니다. 방어하세요!</div>`;
  }

  overlay.classList.add('active');
  setTimeout(() => overlay.classList.remove('active'), 2400);
}

// ===== 일반 코인 플립 애니메이션 =====
function showCoinFlip(reason, result) {
  const overlay = document.getElementById('coinFlipOverlay');
  const coinEl = document.getElementById('coinFace');
  const reasonEl = document.getElementById('coinReason');
  const resultEl = document.getElementById('coinResult');
  reasonEl.textContent = reason;
  coinEl.className = 'coin ' + (result === 'heads' ? 'heads' : 'tails');
  coinEl.textContent = result === 'heads' ? '😀' : '😢';
  resultEl.textContent = result === 'heads' ? '앞면!' : '뒷면!';
  overlay.classList.add('active');
  setTimeout(() => overlay.classList.remove('active'), 2000);
}

// ===== 턴 전환 이펙트 =====
function showTurnChange(nickname, turnNumber, turnSocketId) {
  const overlay = document.getElementById('turnChangeOverlay');
  const banner = document.getElementById('turnBanner');
  const sub = document.getElementById('turnBannerSub');
  if (!overlay || !banner || !sub) return;

  const isMe = (turnSocketId && socket.id === turnSocketId) ||
               (lastState && lastState.me && lastState.me.nickname === nickname) ||
               (nickname === currentNickname);

  banner.className = 'turn-change-banner ' + (isMe ? 'my-turn' : 'opp-turn');
  banner.innerHTML = isMe
    ? '⚔️ YOUR TURN! ⚔️<div style="font-size:22px;margin-top:6px;font-weight:700;">내 차례입니다</div>'
    : '🛡️ OPPONENT TURN<div style="font-size:22px;margin-top:6px;font-weight:700;">상대방 차례입니다</div>';
  sub.textContent = `제 ${turnNumber}턴 — ${nickname}`;

  playTurnSound(isMe);

  overlay.classList.remove('active');
  void overlay.offsetWidth;
  overlay.classList.add('active');
  setTimeout(() => overlay.classList.remove('active'), 1800);
}

// ===== 특수 이펙트 =====
function showSpecialEffect(name, kind) {
  const overlay = document.getElementById('specialEffectOverlay');
  const textEl = document.getElementById('specialEffectText');
  const subEl = document.getElementById('specialEffectSub');
  textEl.className = 'special-effect-text';
  if (kind === 'gakseong_awaken') {
    textEl.classList.add('awaken');
    textEl.textContent = `⚡ ${name} 각성!`;
    subEl.textContent = '세 가지 힘이 하나로 모였다!';
  } else if (kind === 'garados_evolve') {
    textEl.classList.add('evolve');
    textEl.textContent = `🌊 ${name} 진화!`;
    subEl.textContent = '인면어가 갸라도스로 진화했다!';
  } else {
    textEl.classList.add('disaster');
    textEl.textContent = `💀 ${name}`;
    subEl.textContent = '특수 등장!';
  }
  overlay.classList.add('active');
  setTimeout(() => overlay.classList.remove('active'), 2500);
}

// ===== 각성 리즈시절 전장연 전용 화려한 소환 연출 =====
function showGakseongSummon(name) {
  const overlay = document.getElementById('gakseongSummonOverlay');
  if (!overlay) { showSpecialEffect(name, 'gakseong_awaken'); return; }

  const title = overlay.querySelector('#gakseongTitle');
  if (title) title.textContent = `⚡ ${name || '각성 리즈시절 전장연'} ⚡`;

  // 플래시 → 마법진 → 카드 어센드 → 클로즈
  overlay.classList.remove('active', 'phase2', 'phase3');
  void overlay.offsetWidth;

  // 화면 전체 진동
  document.body.classList.add('screen-shake');
  setTimeout(() => document.body.classList.remove('screen-shake'), 500);

  overlay.classList.add('active');
  setTimeout(() => overlay.classList.add('phase2'), 300);   // 마법진 등장
  setTimeout(() => overlay.classList.add('phase3'), 900);   // 카드 어센드 + 타이틀
  setTimeout(() => {
    overlay.classList.remove('active', 'phase2', 'phase3');
  }, 3100);

  // 사운드: 빔 + 고음 효과
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (AudioCtx) {
      const ctx = new AudioCtx();
      // 깊은 북소리
      const osc1 = ctx.createOscillator();
      const g1 = ctx.createGain();
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(80, ctx.currentTime);
      osc1.frequency.exponentialRampToValueAtTime(20, ctx.currentTime + 0.6);
      g1.gain.setValueAtTime(0.8, ctx.currentTime);
      g1.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.6);
      osc1.connect(g1); g1.connect(ctx.destination);
      osc1.start(); osc1.stop(ctx.currentTime + 0.6);
      // 고음 번개
      const osc2 = ctx.createOscillator();
      const g2 = ctx.createGain();
      osc2.type = 'sawtooth';
      osc2.frequency.setValueAtTime(1200, ctx.currentTime + 0.1);
      osc2.frequency.exponentialRampToValueAtTime(400, ctx.currentTime + 0.7);
      g2.gain.setValueAtTime(0.25, ctx.currentTime + 0.1);
      g2.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.7);
      osc2.connect(g2); g2.connect(ctx.destination);
      osc2.start(ctx.currentTime + 0.1); osc2.stop(ctx.currentTime + 0.7);
    }
  } catch(e) {}
}

// ===== 필드 키워드 활성화 VFX =====
function triggerFieldKeywordVfx(keyword, ownerNickname) {
  if (keyword === 'electricField' || keyword === 'electric_field') {
    // 전기장 활성화 알림
    const flash = document.createElement('div');
    flash.style.cssText = `
      position:fixed;inset:0;background:rgba(255,255,0,0.18);z-index:9000;
      pointer-events:none;animation:screenFlash 0.6s ease-out forwards;
    `;
    document.body.appendChild(flash);
    setTimeout(() => flash.remove(), 700);
    log(`⚡ 전기장이 필드에 전개되었다!`);
  }
}



// ===== 스킬 시전 애니메이션 & 비주얼 VFX & 사운드 =====
function triggerSkillVfx(payload) {
  const { sourceCardId, sourceCardName, targetCardId, targetCardName, skillId, skillName, defId, isAoE, motion } = payload;

  // 1. 상단 컷인 배너 노출
  const banner = document.getElementById('skillCastBanner');
  const sourceEl2 = document.getElementById('skillBannerSource');
  const nameEl2 = document.getElementById('skillBannerName');
  if (banner && sourceEl2 && nameEl2) {
    sourceEl2.textContent = `[${sourceCardName}]`;
    nameEl2.textContent = `[${skillName}]`;
    banner.classList.remove('active');
    void banner.offsetWidth;
    banner.classList.add('active');
    setTimeout(() => banner.classList.remove('active'), 1400);
  }

  // 2. motion 필드 우선 사용 (cards.json 기준), 없으면 defId로 추론
  const PROJECTILE_MOTIONS = new Set(['lightning', 'water', 'fire', 'curse', 'beam']);
  const ATTACK_MOTIONS = new Set(['tackle', 'slash', 'lightning', 'water', 'fire', 'earthquake', 'curse', 'beam']);
  const HEAL_MOTIONS = new Set(['heal']);
  const SLEEP_MOTIONS = new Set(['sleep']);

  let effectType = motion || 'slash'; // cards.json의 motion 값 사용

  // 사운드 재생
  playSkillSound(effectType);

  // 3. 강한 스킬 화면 진동
  if (effectType === 'beam' || effectType === 'earthquake' || isAoE) {
    document.body.classList.add('screen-shake');
    setTimeout(() => document.body.classList.remove('screen-shake'), 480);
  }

  // 4. 시전자 카드 & 피격 카드 DOM 찾기
  const srcEl = sourceCardId
    ? document.querySelector(`[data-instance-id="${sourceCardId}"]`) : null;
  const tgtEl = targetCardId
    ? document.querySelector(`[data-instance-id="${targetCardId}"]`)
    : (sourceCardId ? document.querySelector(`[data-instance-id="${sourceCardId}"]`) : null);

  // 5. 빔 전체화면 이펙트
  if (effectType === 'beam') {
    const beam = document.createElement('div');
    beam.className = 'vfx-solar-beam';
    document.body.appendChild(beam);
    setTimeout(() => beam.remove(), 800);
    if (srcEl) { srcEl.classList.add('card-strike-forward'); setTimeout(() => srcEl.classList.remove('card-strike-forward'), 500); }
    return;
  }

  // 6. 힐/버프 모션
  if (HEAL_MOTIONS.has(effectType)) {
    [srcEl, tgtEl].forEach(el => {
      if (el) {
        el.classList.add('card-buff-float');
        applyVfxToElement(el, 'heal');
        setTimeout(() => el.classList.remove('card-buff-float'), 800);
      }
    });
    return;
  }

  // 7. 수면 모션
  if (SLEEP_MOTIONS.has(effectType)) {
    if (tgtEl) {
      tgtEl.classList.add('card-buff-float');
      applyVfxToElement(tgtEl, 'sleep');
      setTimeout(() => tgtEl.classList.remove('card-buff-float'), 800);
    }
    return;
  }

  // 8. 지진 모션 (전체 AoE 진동)
  if (effectType === 'earthquake') {
    const allCards = document.querySelectorAll('#oppField .card:not(.dead), #myField .card:not(.dead)');
    allCards.forEach(el => {
      el.classList.add('card-hit-recoil');
      applyVfxToElement(el, 'fire');
      setTimeout(() => el.classList.remove('card-hit-recoil'), 600);
    });
    return;
  }

  // 9. 투사체 공격 모션 (lightning/water/fire/curse)
  if (PROJECTILE_MOTIONS.has(effectType) && srcEl && (tgtEl || isAoE)) {
    // 시전자 전진 모션
    if (srcEl) {
      srcEl.classList.add('card-strike-forward');
      setTimeout(() => srcEl.classList.remove('card-strike-forward'), 400);
    }

    const targetEls = isAoE
      ? [...document.querySelectorAll('#oppField .card:not(.dead)')]
      : (tgtEl ? [tgtEl] : []);

    targetEls.forEach((target, i) => {
      setTimeout(() => {
        // 투사체 생성
        if (srcEl) {
          const proj = document.createElement('div');
          proj.className = `projectile-vfx projectile-${effectType}`;
          document.body.appendChild(proj);

          const srcRect = srcEl.getBoundingClientRect();
          const tgtRect = target.getBoundingClientRect();
          const startX = srcRect.left + srcRect.width / 2;
          const startY = srcRect.top + srcRect.height / 2;
          const endX = tgtRect.left + tgtRect.width / 2;
          const endY = tgtRect.top + tgtRect.height / 2;

          proj.style.left = startX + 'px';
          proj.style.top = startY + 'px';
          proj.style.transform = 'translate(-50%, -50%)';
          proj.style.position = 'fixed';
          proj.style.zIndex = '9999';

          const dx = endX - startX;
          const dy = endY - startY;
          const angle = Math.atan2(dy, dx) * 180 / Math.PI;
          proj.style.transform = `translate(-50%, -50%) rotate(${angle}deg)`;

          // 애니메이션: startX,Y → endX,Y
          proj.animate([
            { left: startX + 'px', top: startY + 'px', opacity: 1 },
            { left: endX + 'px', top: endY + 'px', opacity: 0.85 }
          ], { duration: 350, easing: 'ease-in', fill: 'forwards' });

          setTimeout(() => {
            proj.remove();
            // 피격 반동
            target.classList.add('card-hit-recoil');
            applyVfxToElement(target, effectType);
            setTimeout(() => target.classList.remove('card-hit-recoil'), 550);
          }, 340);
        } else {
          // srcEl 없으면 바로 피격
          target.classList.add('card-hit-recoil');
          applyVfxToElement(target, effectType);
          setTimeout(() => target.classList.remove('card-hit-recoil'), 550);
        }
      }, i * 120);
    });
    return;
  }

  // 10. 기본 근접 공격 (tackle/slash)
  if (srcEl) {
    srcEl.classList.add('card-strike-forward');
    setTimeout(() => {
      srcEl.classList.remove('card-strike-forward');
      if (isAoE) {
        document.querySelectorAll('#oppField .card:not(.dead)').forEach(el => {
          el.classList.add('card-hit-recoil');
          applyVfxToElement(el, effectType);
          setTimeout(() => el.classList.remove('card-hit-recoil'), 550);
        });
      } else if (tgtEl) {
        tgtEl.classList.add('card-hit-recoil');
        applyVfxToElement(tgtEl, effectType);
        setTimeout(() => tgtEl.classList.remove('card-hit-recoil'), 550);
      }
    }, 250);
  }
}

function applyVfxToElement(el, effectType) {
  if (!el) return;
  const vfx = document.createElement('div');
  vfx.className = `vfx-overlay vfx-${effectType}`;
  if (effectType === 'sleep') {
    vfx.textContent = '💤 Z z z';
  }
  el.appendChild(vfx);
  setTimeout(() => vfx.remove(), 700);
}



function playSkillSound(effectType) {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    const now = ctx.currentTime;

    if (effectType === 'lightning') {
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(800, now);
      osc.frequency.linearRampToValueAtTime(180, now + 0.3);
      gain.gain.setValueAtTime(0.3, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
      osc.start(now);
      osc.stop(now + 0.3);
    } else if (effectType === 'water') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(300, now);
      osc.frequency.linearRampToValueAtTime(500, now + 0.2);
      osc.frequency.linearRampToValueAtTime(150, now + 0.45);
      gain.gain.setValueAtTime(0.3, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.45);
      osc.start(now);
      osc.stop(now + 0.45);
    } else if (effectType === 'fire') {
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(140, now);
      osc.frequency.exponentialRampToValueAtTime(35, now + 0.4);
      gain.gain.setValueAtTime(0.35, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.4);
      osc.start(now);
      osc.stop(now + 0.4);
    } else if (effectType === 'beam') {
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(300, now);
      osc.frequency.exponentialRampToValueAtTime(1300, now + 0.5);
      gain.gain.setValueAtTime(0.3, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.6);
      osc.start(now);
      osc.stop(now + 0.6);
    } else if (effectType === 'heal') {
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(523.25, now);
      osc.frequency.setValueAtTime(659.25, now + 0.1);
      osc.frequency.setValueAtTime(783.99, now + 0.2);
      gain.gain.setValueAtTime(0.25, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.45);
      osc.start(now);
      osc.stop(now + 0.45);
    } else {
      osc.type = 'square';
      osc.frequency.setValueAtTime(220, now);
      osc.frequency.exponentialRampToValueAtTime(70, now + 0.25);
      gain.gain.setValueAtTime(0.3, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.25);
      osc.start(now);
      osc.stop(now + 0.25);
    }
  } catch (err) {}
}

// ===== 플로팅 데미지/힐 =====
function showFloatingEffect(instanceId, text, type) {
  const cardEl = document.querySelector(`[data-instance-id="${instanceId}"]`);
  if (!cardEl) return;
  const float = document.createElement('div');
  float.className = `float-effect ${type}`;
  float.textContent = text;
  float.style.left = '50%';
  float.style.top = '10px';
  float.style.transform = 'translateX(-50%)';
  cardEl.appendChild(float);
  if (type === 'damage') cardEl.style.animation = 'cardShake 0.3s ease';
  setTimeout(() => {
    float.remove();
    cardEl.style.animation = '';
  }, 1000);
}

// ===== 한글 상태이상 & 스택 뱃지 생성 함수 =====
function renderStatusBadges(card) {
  let html = '';
  const statuses = card.statuses || {};
  const stacks = card.stacks || {};

  // 1. 상태이상 (디버프형)
  if (statuses.confusion) {
    html += `<span class="status-badge-item badge-confusion" title="공격 스킬 시전 시 동전을 던져 뒷면이면 20 자해 및 실패">🌀 [혼란]</span>`;
  }
  if (statuses.burn) {
    html += `<span class="status-badge-item badge-burn" title="매 턴 시작 시 20 데미지 피해 (동전 앞면 시 해제)">🔥 [화상 -20]</span>`;
  }
  if (statuses.sleep) {
    html += `<span class="status-badge-item badge-sleep" title="이번 턴 수면 상태로 행동 불가">💤 [수면]</span>`;
  }
  if (statuses.fixedTarget) {
    html += `<span class="status-badge-item badge-fixed" title="상대의 다음 공격 대상으로 강제 고정">🎯 [도발: 고정]</span>`;
  }
  if (statuses.halveNextDamageTaken) {
    html += `<span class="status-badge-item badge-hyperfocus" title="다음 받는 피해 50% 감소">🛡️ [받는피해 반감]</span>`;
  }
  if (statuses.halveNextDamageDealt) {
    html += `<span class="status-badge-item badge-weakness" title="다음 주는 피해 50% 감소">⚠️ [공격력 반감]</span>`;
  }

  // 2. 스택형 키워드
  if (stacks.overcharge && stacks.overcharge > 0) {
    html += `<span class="status-badge-item badge-overcharge" title="과충전 스택">⚡ [과충전 x${stacks.overcharge}]</span>`;
  }
  if (stacks.hotFuel && stacks.hotFuel > 0) {
    html += `<span class="status-badge-item badge-hotfuel" title="과열된 연료 스택">🏎️ [과열연료 x${stacks.hotFuel}]</span>`;
  }
  if (stacks.shield && stacks.shield > 0) {
    html += `<span class="status-badge-item badge-shield" title="보호막 수치만큼 피격 피해를 우선 감면">🛡️ [보호막 ${stacks.shield}]</span>`;
  }
  if (stacks.dmgUp && stacks.dmgUp > 0) {
    html += `<span class="status-badge-item badge-dmgup" title="1스택당 주는 피해 +10% (공격 후 소실)">⚔️ [피해증가 x${stacks.dmgUp}]</span>`;
  }
  if (stacks.dmgDown && stacks.dmgDown > 0) {
    html += `<span class="status-badge-item badge-dmgdown" title="1스택당 받는 피해 -10% (피격 후 소실)">🛡️ [피해감소 x${stacks.dmgDown}]</span>`;
  }

  if (!html) return '';
  return `<div class="status-badge-list">${html}</div>`;
}

// ===== 카드 상세 팝업 =====
function openCardDetail(card) {
  if (!card) return;
  const modal = document.getElementById('cardDetailModal');
  const titleEl = document.getElementById('cardDetailTitle');
  const bodyEl = document.getElementById('cardDetailBody');
  titleEl.textContent = `📋 ${card.name}`;
  let html = '';
  if (card.image) html += `<img class="card-detail-img" src="/image/${card.image}" alt="${card.name}" />`;
  if (card.type === 'mob') {
    html += `<div class="card-detail-hp"><span class="hp-current">HP ${card.hp}</span> / <span class="hp-max">${card.maxHp}</span></div>`;
    if (card.trait) html += `<div class="card-detail-trait"><b style="color:#8fd;">[${card.trait.name}]</b> ${card.trait.desc}</div>`;
    if (card.skills) {
      for (const sk of card.skills) {
        const typeTag = sk.targetType === 'enemy' ? '<span style="color:#f87171;font-size:11px">[공격 대상 지정]</span>'
          : sk.targetType === 'passive' ? '<span style="color:#9ca3af;font-size:11px">[패시브]</span>'
          : '<span style="color:#34d399;font-size:11px">[즉시 시전]</span>';
        html += `<div class="card-detail-skill"><b>${sk.name}</b> ${typeTag}<br/><span style="color:#ccc;">${sk.desc}</span></div>`;
      }
    }
    // 상태이상 한글 뱃지
    const badgesHtml = renderStatusBadges(card);
    if (badgesHtml) {
      html += `<div style="margin-top:8px;">${badgesHtml}</div>`;
    }
    // 부착 아이템
    if (card.attachedItems && card.attachedItems.length > 0) {
      html += `<div class="card-detail-items"><b style="color:#aaf;">부착 아이템:</b>`;
      for (const i of card.attachedItems) html += `<div style="font-size:12px;color:#aaf;margin-top:2px;">🔗 ${i.name} - ${i.desc || ''}</div>`;
      html += `</div>`;
    }
    if (card.permanentDamageBonus) html += `<div style="margin-top:6px;font-size:12px;color:#fbbf24;">⚔ 영구 데미지 보너스: +${card.permanentDamageBonus}</div>`;
  } else {
    html += `<div style="margin-top:8px;">${card.desc || ''}</div>`;
  }
  bodyEl.innerHTML = html;
  modal.classList.add('active');
}
function closeCardDetail() { document.getElementById('cardDetailModal').classList.remove('active'); }

// ===== 트레쉬 보기 =====
function openTrash(who) {
  if (!lastState) return;
  const trash = who === 'me' ? lastState.me.trash : (lastState.opponent ? lastState.opponent.trash : []);
  const titleEl = document.getElementById('trashTitle');
  titleEl.textContent = `🗑️ ${who === 'me' ? '내' : '상대'} 트레쉬 (${trash.length}장)`;
  const listEl = document.getElementById('trashList');
  listEl.innerHTML = '';
  if (trash.length === 0) {
    listEl.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:20px;">트레쉬가 비어있습니다.</p>';
  } else {
    for (const c of trash) {
      const div = document.createElement('div');
      div.className = 'trash-card-item';
      const imgSrc = c.image ? `/image/${c.image}` : '/image/dummy.png';
      div.innerHTML = `<img src="${imgSrc}" alt="${c.name}" /><div><b>${c.name}</b><br/><span style="font-size:11px;color:var(--text-muted);">${c.type}</span></div>`;
      div.style.cursor = 'pointer';
      div.onclick = () => openCardDetail(c);
      listEl.appendChild(div);
    }
  }
  document.getElementById('trashModal').classList.add('active');
}
function closeTrash() { document.getElementById('trashModal').classList.remove('active'); }

// ===== 타겟 선택 취소 버튼 =====
function updateCancelButton() {
  let btn = document.getElementById('cancelTargetBtn');
  const isTargeting = pendingSkill || pendingAttach || (pendingConsumable && pendingConsumable.needsTarget) || predationState;

  if (isTargeting) {
    if (!btn) {
      btn = document.createElement('button');
      btn.id = 'cancelTargetBtn';
      btn.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:90;padding:12px 28px;background:#ef4444;color:#fff;font-weight:800;border-radius:12px;font-size:15px;box-shadow:0 6px 20px rgba(239,68,68,0.5);border:2px solid #fff;cursor:pointer;';
      document.body.appendChild(btn);
    }
    let targetMsg = '대상 선택 중...';
    if (pendingSkill) {
      if (pendingSkill.targetType === 'ally') targetMsg = `✨ [${pendingSkill.skillName}] 아군 카드 선택 중`;
      else targetMsg = `⚔️ [${pendingSkill.skillName}] 상대 카드 선택 중`;
    }
    else if (predationState) targetMsg = '🍽️ 포식할 아군 카드 선택 중';
    else if (pendingAttach) targetMsg = '🔗 장착할 아군 카드 선택 중';
    else if (pendingConsumable) targetMsg = `📦 [${pendingConsumable.cardName}] 대상 선택 중`;

    btn.textContent = `${targetMsg} (클릭하여 취소 ✕)`;
    btn.onclick = () => {
      cancelTargeting();
    };
  } else if (btn) {
    btn.remove();
  }
}

function cancelTargeting() {
  pendingSkill = null;
  pendingAttach = null;
  pendingConsumable = null;
  predationState = null;
  const noTargetBtn = document.getElementById('noTargetBtn');
  if (noTargetBtn) noTargetBtn.remove();
  updateCancelButton();
  render(lastState);
  log('ℹ️ 대상 선택을 취소했습니다.');
}

// ===== 렌더링 =====
function render(state) {
  document.getElementById('phase').textContent = state.phase;
  const turnBadge = document.getElementById('turnInfo');
  turnBadge.textContent = state.phase === 'battle'
    ? `${state.turnNumber}턴 (${state.isMyTurn ? '내 턴' : '상대 턴'})` : '-';

  if (state.isMyTurn) {
    turnBadge.style.color = '#10b981';
    turnBadge.style.textShadow = '0 0 10px rgba(16,185,129,0.8)';
  } else {
    turnBadge.style.color = '#f87171';
    turnBadge.style.textShadow = 'none';
  }

  document.getElementById('oppName').textContent = state.opponent ? state.opponent.nickname : '대기 중';
  document.getElementById('turnHint').textContent = state.isMyTurn
    ? (state.me.drawnThisTurn ? '드로우 완료 (스킬/아이템 사용 가능)' : '턴 시작: 카드 드로우를 진행하세요!') : '상대방의 행동을 기다리는 중...';

  document.getElementById('oppHandCount').textContent = state.opponent ? state.opponent.handCount : 0;
  if (document.getElementById('oppDeckCount')) {
    document.getElementById('oppDeckCount').textContent = state.opponent ? (state.opponent.deckCount || 0) : 0;
  }
  document.getElementById('oppTrashCount').textContent = state.opponent ? state.opponent.trash.length : 0;
  document.getElementById('myTrashCount').textContent = state.me.trash.length;
  if (document.getElementById('myDeckCount')) {
    document.getElementById('myDeckCount').textContent = state.me.deckCount !== undefined ? state.me.deckCount : 0;
  }

  // 배치 단계 UI 및 준비완료 피드백
  const placementView = document.getElementById('placementView');
  if (state.phase === 'placement') {
    placementView.style.display = 'block';

    const myBadge = document.getElementById('myPlacementBadge');
    const oppBadge = document.getElementById('oppPlacementBadge');
    const confirmBtn = document.getElementById('confirmPlacementBtn');

    if (state.me.placementReady) {
      myBadge.textContent = '내 상태: 준비 완료 ✔️';
      myBadge.className = 'ready-badge done';
      confirmBtn.disabled = true;
      confirmBtn.style.background = '#059669';
      confirmBtn.style.cursor = 'default';
      confirmBtn.textContent = '✔️ 준비 완료 (상대방 기다리는 중...)';
    } else {
      myBadge.textContent = '내 상태: 배치 중 ⏳';
      myBadge.className = 'ready-badge';
      confirmBtn.disabled = false;
      confirmBtn.style.background = 'var(--primary)';
      confirmBtn.style.cursor = 'pointer';
      confirmBtn.textContent = '✔️ 배치 완료 (준비)';
    }

    if (state.opponent) {
      if (state.opponent.placementReady) {
        oppBadge.textContent = '상대 상태: 준비 완료 ✔️';
        oppBadge.className = 'ready-badge done';
      } else {
        oppBadge.textContent = '상대 상태: 배치 중 ⏳';
        oppBadge.className = 'ready-badge';
      }
    } else {
      oppBadge.textContent = '상대 상태: 대기 중 ⏳';
      oppBadge.className = 'ready-badge';
    }

    renderPlacement(state);
  } else {
    placementView.style.display = 'none';
  }

  renderHand(state);
  renderField('myField', state.me.field, false, state);
  renderField('oppField', state.opponent ? state.opponent.field : [], true, state);

  // 설치형 필드 키워드 (전기장, 쾌청 등) 갱신
  const myFieldSection = document.getElementById('myFieldSection');
  const myKeywordBadge = document.getElementById('myFieldKeywordBadge');
  if (myFieldSection && myKeywordBadge) {
    const myHasElectric = state.me.fieldKeyword === 'electricField' || state.me.fieldKeyword === 'electric_field';
    const myHasSunny = state.me.fieldKeyword === 'sunny';
    if (myHasElectric) {
      myFieldSection.classList.add('electric-active');
      myKeywordBadge.textContent = '⚡ [전기장 가동 중: 과충전 2배]';
      myKeywordBadge.style.display = 'inline-flex';
    } else if (myHasSunny) {
      myFieldSection.classList.remove('electric-active');
      myKeywordBadge.textContent = '☀️ [쾌청 가동 중: 솔라빔 -1턴]';
      myKeywordBadge.style.display = 'inline-flex';
    } else {
      myFieldSection.classList.remove('electric-active');
      myKeywordBadge.style.display = 'none';
    }
  }

  const oppFieldSection = document.getElementById('oppFieldSection');
  const oppKeywordBadge = document.getElementById('oppFieldKeywordBadge');
  if (oppFieldSection && oppKeywordBadge) {
    const oppHasElectric = state.opponent && (state.opponent.fieldKeyword === 'electricField' || state.opponent.fieldKeyword === 'electric_field');
    const oppHasSunny = state.opponent && state.opponent.fieldKeyword === 'sunny';
    if (oppHasElectric) {
      oppFieldSection.classList.add('electric-active');
      oppKeywordBadge.textContent = '⚡ [전기장 가동 중: 과충전 2배]';
      oppKeywordBadge.style.display = 'inline-flex';
    } else if (oppHasSunny) {
      oppFieldSection.classList.remove('electric-active');
      oppKeywordBadge.textContent = '☀️ [쾌청 가동 중: 솔라빔 -1턴]';
      oppKeywordBadge.style.display = 'inline-flex';
    } else {
      oppFieldSection.classList.remove('electric-active');
      oppKeywordBadge.style.display = 'none';
    }
  }


  // 턴 스킵 버튼 활성화 여부
  const skipBtn = document.getElementById('skipTurnBtn');
  if (skipBtn) {
    const canSkip = state.isMyTurn && state.phase === 'battle';
    skipBtn.disabled = !canSkip;
    skipBtn.style.opacity = canSkip ? '1' : '0.4';
    skipBtn.style.cursor = canSkip ? 'pointer' : 'not-allowed';
  }

  updateCancelButton();
}

// ===== 카드 엘리먼트 생성 =====
function cardEl(card, isEnemy) {
  const div = document.createElement('div');
  const isDead = card && ((card.alive === false) || (card.hp <= 0));
  let statusClasses = '';
  if (card && card.statuses) {
    if (card.statuses.confusion) statusClasses += ' status-confusion';
    if (card.statuses.burn) statusClasses += ' status-burn';
    if (card.statuses.sleep) statusClasses += ' status-sleep';
  }

  div.className = 'card' + (isEnemy ? ' enemy' : '') + (isDead ? ' dead' : '') + statusClasses;
  if (!card) {
    div.textContent = '(빈 슬롯)';
    return div;
  }
  div.setAttribute('data-instance-id', card.instanceId);

  // 카드 클릭 처리
  div.addEventListener('click', (e) => {
    if (e.target.tagName === 'BUTTON') return;

    // 1. 스킬 타겟팅 상태일 때
    if (pendingSkill) {
      if (pendingSkill.targetType === 'enemy') {
        if (!isEnemy) {
          log('⚠️ 공격 스킬은 상대 카드만 대상으로 지정할 수 있습니다!');
          return;
        }
        onTargetPicked(card.instanceId, 'opponent');
        return;
      } else if (pendingSkill.targetType === 'ally') {
        if (isEnemy) {
          log('⚠️ 아군 지정 스킬은 아군 카드만 대상으로 지정할 수 있습니다!');
          return;
        }
        onTargetPicked(card.instanceId, 'self');
        return;
      }
    }

    // 2. 포식 타겟팅 상태일 때
    if (predationState) {
      if (isEnemy) {
        log('⚠️ 포식은 자신의 아군 카드만 대상으로 지정할 수 있습니다!');
        return;
      }
      if (card.instanceId === predationState.cardInstanceId) {
        log('⚠️ 자기 자신은 포식할 수 없습니다. 다른 아군 카드를 선택하세요.');
        return;
      }
      onTargetPicked(card.instanceId, 'self');
      return;
    }

    // 3. 부착 아이템 타겟팅 상태일 때
    if (pendingAttach) {
      if (isEnemy) {
        log('⚠️ 부착 아이템은 아군 카드에만 장착할 수 있습니다!');
        return;
      }
      onTargetPicked(card.instanceId, 'self');
      return;
    }

    // 4. 소모 아이템 타겟팅 상태일 때
    if (pendingConsumable && pendingConsumable.needsTarget) {
      onTargetPicked(card.instanceId, isEnemy ? 'opponent' : 'self');
      return;
    }

    // 일반 클릭: 카드 상세 모달
    openCardDetail(card);
  });

  if (card.type === 'mob') {
    const pct = Math.max(0, Math.round((card.hp / card.maxHp) * 100));
    const imgHtml = card.image ? `<img class="card-img" src="/image/${card.image}" alt="${card.name}" />` : '';

    // 특성 영역
    let traitSection = '';
    if (card.trait) {
      traitSection = `<div style="color:#8fd;font-size:11px;margin-top:2px;">[${card.trait.name}] ${card.trait.desc}</div>`;
      // 자연재해 포식: 특성 패시브 발동 버튼 분리
      if (!isEnemy && card.defId === 'card_jaeonjaehae') {
        const canPredate = lastState.isMyTurn && lastState.me.field.some(c => c && c.instanceId !== card.instanceId && (c.alive !== false) && c.hp > 0);
        traitSection += `
          <button style="margin-top:4px;width:100%;background:#059669;color:#fff;font-weight:700;padding:5px 8px;border-radius:6px;border:none;"
                  ${!canPredate ? 'disabled' : ''}
                  onclick="event.stopPropagation(); startPredation('${card.instanceId}')">
            🍽️ [특성] 아군 포식 (+100 HP, 턴 소모 없음)
          </button>
        `;
      }
    }

    const badgesHtml = renderStatusBadges(card);

    div.innerHTML = `
      ${imgHtml}
      <b>${card.name}</b>
      HP ${card.hp}/${card.maxHp}
      <div class="hpbar"><div style="width:${pct}%"></div></div>
      ${badgesHtml}
      ${traitSection}
      ${(card.attachedItems || []).map(i => `<div style="font-size:10px;color:#aaf;margin-top:2px;">🔗 ${i.name}</div>`).join('')}
    `;

    // 내 필드 카드의 스킬 버튼 줄
    if (!isEnemy && card.skills) {
      const btnRow = document.createElement('div');
      btnRow.className = 'skill-btn-row';
      for (const sk of card.skills) {
        if (sk.targetType === 'passive') continue;
        const b = document.createElement('button');
        const isSleeping = card.statuses && card.statuses.sleep;
        b.textContent = (sk.name.length > 10 ? sk.name.slice(0, 10) + '…' : sk.name) + (isSleeping ? ' 💤' : '');
        if (isSleeping) {
          b.title = `[수면 상태: 선택 시 동전 던지기 - 앞면이면 해제 후 발동, 뒷면이면 유지 및 턴 종료] ${sk.name}: ${sk.desc || ''}`;
        } else {
          b.title = `${sk.name}: ${sk.desc || ''}`;
        }
        b.disabled = !lastState.isMyTurn || card.blocked;
        b.onclick = (e) => {
          e.stopPropagation();
          selectSkill(card.instanceId, sk.id);
        };
        btnRow.appendChild(b);
      }
      div.appendChild(btnRow);
    }

    // 타겟 모드일 때 전용 액션 버튼
    if (pendingSkill) {
      if (pendingSkill.targetType === 'enemy' && isEnemy && (card.alive !== false) && card.hp > 0) {
        const tb = document.createElement('button');
        tb.textContent = '🎯 공격 대상으로 지정';
        tb.style.cssText = 'width:100%;margin-top:6px;background:#dc2626;color:#fff;font-weight:800;padding:8px;border-radius:6px;border:2px solid #fff;box-shadow:0 0 10px rgba(220,38,38,0.8);cursor:pointer;';
        tb.onclick = (e) => {
          e.stopPropagation();
          onTargetPicked(card.instanceId, 'opponent');
        };
        div.appendChild(tb);
      } else if (pendingSkill.targetType === 'ally' && !isEnemy && (card.alive !== false) && card.hp > 0) {
        const tb = document.createElement('button');
        tb.textContent = '✨ 아군 대상으로 지정';
        tb.style.cssText = 'width:100%;margin-top:6px;background:#10b981;color:#fff;font-weight:800;padding:8px;border-radius:6px;border:2px solid #fff;box-shadow:0 0 10px rgba(16,185,129,0.8);cursor:pointer;';
        tb.onclick = (e) => {
          e.stopPropagation();
          onTargetPicked(card.instanceId, 'self');
        };
        div.appendChild(tb);
      }
    } else if (predationState) {
      if (!isEnemy && card.instanceId !== predationState.cardInstanceId && (card.alive !== false) && card.hp > 0) {
        const tb = document.createElement('button');
        tb.textContent = '🍽️ 포식 대상으로 희생';
        tb.style.cssText = 'width:100%;margin-top:6px;background:#059669;color:#fff;font-weight:800;padding:8px;border-radius:6px;border:2px solid #fff;box-shadow:0 0 10px rgba(5,150,105,0.8);cursor:pointer;';
        tb.onclick = (e) => {
          e.stopPropagation();
          onTargetPicked(card.instanceId, 'self');
        };
        div.appendChild(tb);
      }
    } else if (pendingAttach) {
      if (!isEnemy && (card.alive !== false) && card.hp > 0) {
        const tb = document.createElement('button');
        tb.textContent = '🔗 장착 대상으로 지정';
        tb.style.cssText = 'width:100%;margin-top:6px;background:#2563eb;color:#fff;font-weight:800;padding:8px;border-radius:6px;border:2px solid #fff;cursor:pointer;';
        tb.onclick = (e) => {
          e.stopPropagation();
          onTargetPicked(card.instanceId, 'self');
        };
        div.appendChild(tb);
      }
    } else if (pendingConsumable && pendingConsumable.needsTarget) {
      let canTarget = false;
      const itemId = pendingConsumable.defId;
      if (itemId === 'item_ai_geumji') canTarget = isEnemy;
      else if (itemId === 'item_pos_neg') canTarget = true;
      else canTarget = !isEnemy;

      if (canTarget && (card.alive !== false) && card.hp > 0) {
        const tb = document.createElement('button');
        tb.textContent = isEnemy ? '🎯 대상으로 지정' : '🛡️ 대상으로 지정';
        tb.style.cssText = `width:100%;margin-top:6px;background:${isEnemy ? '#dc2626' : '#2563eb'};color:#fff;font-weight:800;padding:8px;border-radius:6px;border:2px solid #fff;cursor:pointer;`;
        tb.onclick = (e) => {
          e.stopPropagation();
          onTargetPicked(card.instanceId, isEnemy ? 'opponent' : 'self');
        };
        div.appendChild(tb);
      }
    }
  } else {
    const imgHtml = card.image ? `<img class="card-img" src="/image/${card.image}" alt="${card.name}" />` : '';
    div.innerHTML = `${imgHtml}<b>[아이템] ${card.name}</b><div style="font-size:10px;color:#ccc;">${card.desc || ''}</div>`;
  }
  return div;
}

function renderField(containerId, field, isEnemy, state) {
  const el = document.getElementById(containerId);
  el.innerHTML = '';
  for (let i = 0; i < 3; i++) {
    const c = field[i];
    if (c) {
      const cel = cardEl(c, isEnemy);
      cel.addEventListener('dragover', (e) => { e.preventDefault(); cel.classList.add('drag-over'); });
      cel.addEventListener('dragleave', () => cel.classList.remove('drag-over'));
      cel.addEventListener('drop', (e) => {
        e.preventDefault();
        cel.classList.remove('drag-over');
        handleDrop(c, isEnemy ? 'opponent' : 'self', i);
      });
      el.appendChild(cel);
    } else if (!isEnemy) {
      const slot = document.createElement('div');
      slot.className = 'field-slot';
      slot.textContent = `슬롯 ${i + 1}`;
      slot.addEventListener('dragover', (e) => { e.preventDefault(); slot.classList.add('drop-highlight'); });
      slot.addEventListener('dragleave', () => slot.classList.remove('drop-highlight'));
      slot.addEventListener('drop', (e) => {
        e.preventDefault();
        slot.classList.remove('drop-highlight');
        handleDropOnSlot(i);
      });
      el.appendChild(slot);
    } else {
      const slot = document.createElement('div');
      slot.className = 'field-slot';
      slot.textContent = '빈 슬롯';
      el.appendChild(slot);
    }
  }
}

function renderHand(state) {
  const el = document.getElementById('myHand');
  el.innerHTML = '';
  const hand = (state.me && state.me.hand) ? state.me.hand : [];
  const count = hand.length;

  hand.forEach((c, index) => {
    const div = document.createElement('div');
    div.className = 'card';
    div.setAttribute('data-instance-id', c.instanceId);
    div.setAttribute('draggable', 'true');
    div.setAttribute('data-card-type', c.type);
    div.setAttribute('data-hand-id', c.instanceId);

    // 부채꼴 팬아웃 각도 및 아치형 Y오프셋 계산
    if (count > 1) {
      const mid = (count - 1) / 2;
      const offset = index - mid;
      const deg = offset * Math.min(8, 28 / (count || 1));
      const yOffset = Math.abs(offset) * 5;
      div.style.transform = `rotate(${deg.toFixed(1)}deg) translateY(${yOffset.toFixed(1)}px)`;
      div.style.zIndex = index + 1;
    }

    const imgHtml = c.image ? `<img class="card-img" src="/image/${cardImage(c)}" alt="${c.name}" />` : '';
    div.innerHTML = `${imgHtml}<b>${c.name}</b><span style="font-size:11px">${c.type === 'mob' ? `몹 HP ${c.hp || ''}` : c.type === 'item_attach' ? '장착 아이템' : '소모 아이템'}</span>`;

    if (c.desc) {
      const descEl = document.createElement('div');
      descEl.style.cssText = 'font-size:10px;color:#ccc;';
      descEl.textContent = c.desc;
      div.appendChild(descEl);
    }

    div.addEventListener('click', (e) => {
      if (e.target.tagName === 'BUTTON') return;
      if (pendingSkill || pendingAttach || (pendingConsumable && pendingConsumable.needsTarget) || predationState) return;
      openCardDetail(c);
    });

    div.addEventListener('dragstart', (e) => {
      dragData = { instanceId: c.instanceId, type: c.type, defId: c.defId, name: c.name };
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', c.instanceId);
      div.style.opacity = '0.5';
    });
    div.addEventListener('dragend', () => {
      resetAllCardStyles();
    });
    div.addEventListener('touchend', () => {
      resetAllCardStyles();
    });
    div.addEventListener('touchcancel', () => {
      resetAllCardStyles();
    });

    const isMyTurn = lastState && (lastState.phase === 'placement' || lastState.isMyTurn);

    if (c.type === 'mob') {
      // 진화 카드는 직접 배치 불가 → "필드로 배치" 버튼 숨기고 진화 버튼만 표시
      if (c.evolvesFrom) {
        // 필드에 진화 base 카드가 있는지 + turnsOnField >= 2 인지 체크
        const baseOnField = lastState && lastState.me && lastState.me.field.find(f => f && f.defId === c.evolvesFrom);
        const canEvolve = baseOnField && (baseOnField.turnsOnField || 0) >= 2;

        const eb = document.createElement('button');
        eb.textContent = canEvolve ? '🌊 진화시키기' : '진화 (2턴 대기 필요)';
        eb.disabled = !canEvolve || !isMyTurn;
        eb.title = canEvolve
          ? `[${baseOnField.name}]을(를) ${c.name}(으)로 진화`
          : '인면어 전장연을 먼저 배치하고 2턴이 지나야 진화할 수 있습니다.';
        eb.style.background = (canEvolve && isMyTurn) ? 'linear-gradient(135deg,#0ea5e9,#0369a1)' : '#4b5563';
        eb.onclick = (e) => { e.stopPropagation(); tryEvolve(c.instanceId, c.defId); };
        div.appendChild(eb);

        // 진화 조건 안내 태그
        const tag = document.createElement('span');
        tag.textContent = canEvolve ? '✅ 진화 가능' : `⏳ ${baseOnField ? baseOnField.turnsOnField + '/2턴' : '인면어 필요'}`;
        tag.style.cssText = `display:block;font-size:10px;margin-top:4px;color:${canEvolve ? '#34d399' : '#f87171'};font-weight:700;`;
        div.appendChild(tag);
      } else {
        const b = document.createElement('button');
        b.textContent = '필드로 배치';
        b.disabled = !isMyTurn;
        b.onclick = (e) => { e.stopPropagation(); selectForPlacement(c.instanceId); };
        div.appendChild(b);
      }
    } else if (c.type === 'item_attach') {
      const b = document.createElement('button');
      b.textContent = '장착 대상 선택';
      b.disabled = !isMyTurn;
      b.onclick = (e) => {
        e.stopPropagation();
        if (!isMyTurn) return alert('상대방의 턴입니다. 내 턴에만 카드를 아이템을 사용할 수 있습니다.');
        pendingAttach = { handInstanceId: c.instanceId, cardName: c.name };
        log(`🔗 [${c.name}] 장착할 아군 카드를 클릭하세요.`);
        render(lastState);
      };
      div.appendChild(b);
    } else if (c.type === 'item_consume') {
      const b = document.createElement('button');
      b.textContent = '사용';
      b.disabled = !isMyTurn;
      b.onclick = (e) => {
        e.stopPropagation();
        if (!isMyTurn) return alert('상대방의 턴입니다. 내 턴에만 아이템을 사용할 수 있습니다.');
        useConsumable(c.instanceId, c.defId, c.name);
      };
      div.appendChild(b);
    }
    el.appendChild(div);
  });
}

// ===== 아이템 사용 연출 팝업 오버레이 =====
let itemUseTimeout = null;
function showItemUsePopup(payload) {
  const { userNickname, itemName, itemImage, itemDesc, targetName } = payload;
  const overlay = document.getElementById('itemUseOverlay');
  const userEl = document.getElementById('itemUseUser');
  const imgEl = document.getElementById('itemUseImg');
  const nameEl = document.getElementById('itemUseName');
  const effectEl = document.getElementById('itemUseEffect');
  const targetEl = document.getElementById('itemUseTarget');

  if (!overlay || !userEl || !imgEl || !nameEl) return;

  userEl.textContent = `⚡ [${userNickname || '플레이어'}]님이 아이템을 사용했습니다!`;
  imgEl.src = itemImage ? `/image/${itemImage}` : '/image/dummy.png';
  nameEl.textContent = itemName || '아이템';
  effectEl.textContent = itemDesc || '아이템 효과가 발동되었습니다.';

  if (targetName) {
    targetEl.style.display = 'block';
    targetEl.textContent = `🎯 적용 대상: [${targetName}]`;
  } else {
    targetEl.style.display = 'none';
  }

  playSkillSound('heal'); // 청량한 아이템 발동 사운드

  overlay.classList.remove('active');
  void overlay.offsetWidth;
  overlay.classList.add('active');

  if (itemUseTimeout) clearTimeout(itemUseTimeout);
  itemUseTimeout = setTimeout(() => {
    overlay.classList.remove('active');
  }, 2200);
}

// ===== 카드 드로우 효과음 =====
function playDrawCardSound() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    const now = ctx.currentTime;
    osc.type = 'sine';
    osc.frequency.setValueAtTime(440, now);
    osc.frequency.exponentialRampToValueAtTime(880, now + 0.12);
    gain.gain.setValueAtTime(0.2, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.12);
    osc.start(now);
    osc.stop(now + 0.12);
  } catch (err) {}
}

// ===== 턴 스킵 =====
function skipTurn() {
  if (!lastState || !lastState.isMyTurn) {
    alert('내 턴에만 턴을 넘길 수 있습니다.');
    return;
  }
  if (confirm('스킬을 사용하지 않고 턴을 넘기시겠습니까?')) {
    socket.emit('skipTurn');
    log('⏭️ 턴을 넘겼습니다 (스킵).');
  }
}

function cardImage(c) {
  return c.image || 'dummy.png';
}

// ===== 드래그 앤 드롭 핸들러 =====
function handleDropOnSlot(slotIndex) {
  if (!dragData) return;
  if (lastState && lastState.phase === 'battle' && !lastState.isMyTurn) {
    alert('상대방의 턴입니다. 내 턴에만 카드를 배치할 수 있습니다.');
    return;
  }
  if (dragData.type === 'mob') {
    socket.emit('placeMob', { handInstanceId: dragData.instanceId, slot: slotIndex });
    placingCard = null;
  }
}

function handleDrop(targetCard, targetOwner, slotIndex) {
  if (!dragData) return;
  if (lastState && lastState.phase === 'battle' && !lastState.isMyTurn) {
    alert('상대방의 턴입니다. 내 턴에만 아이템을 사용하거나 진화할 수 있습니다.');
    return;
  }

  if (dragData.type === 'item_attach') {
    if (targetOwner !== 'self') {
      return alert('부착 아이템은 아군 카드에만 장착할 수 있습니다.');
    }
    socket.emit('attachItem', { handInstanceId: dragData.instanceId, targetOwner: 'self', targetInstanceId: targetCard.instanceId });
  } else if (dragData.type === 'item_consume') {
    socket.emit('useConsumable', { handInstanceId: dragData.instanceId, payload: { targetOwner, targetInstanceId: targetCard.instanceId } });
  } else if (dragData.type === 'mob') {
    if (dragData.defId === 'card_garados' && targetCard.defId === 'card_inmyeoneo') {
      socket.emit('evolveCard', { handInstanceId: dragData.instanceId, targetFieldInstanceId: targetCard.instanceId });
    }
  }
}

// ===== 배치 단계 =====
function selectForPlacement(handInstanceId) {
  if (lastState && lastState.phase === 'battle' && !lastState.isMyTurn) {
    alert('상대방의 턴입니다. 내 턴에만 몹 카드를 배치할 수 있습니다.');
    return;
  }
  placingCard = handInstanceId;
  renderPlacement(lastState);
}

function renderPlacement(state) {
  const slotEl = document.getElementById('slotButtons');
  slotEl.innerHTML = '';
  if (placingCard) {
    const label = document.createElement('span');
    label.textContent = '배치할 슬롯을 누르세요: ';
    label.style.color = 'var(--primary)';
    label.style.fontWeight = '700';
    slotEl.appendChild(label);
  }
  for (let i = 0; i < 3; i++) {
    if (!state.me.field[i]) {
      const slot = document.createElement('div');
      slot.className = 'field-slot';
      slot.textContent = `슬롯 ${i + 1}`;
      slot.style.cursor = 'pointer';
      slot.onclick = () => {
        if (placingCard) {
          socket.emit('placeMob', { handInstanceId: placingCard, slot: i });
          placingCard = null;
        }
      };
      slot.addEventListener('dragover', (e) => { e.preventDefault(); slot.classList.add('drop-highlight'); });
      slot.addEventListener('dragleave', () => slot.classList.remove('drop-highlight'));
      slot.addEventListener('drop', (e) => {
        e.preventDefault();
        slot.classList.remove('drop-highlight');
        handleDropOnSlot(i);
      });
      slotEl.appendChild(slot);
    } else {
      const cel = cardEl(state.me.field[i], false);
      slotEl.appendChild(cel);
    }
  }
}

function confirmPlacement() {
  const hasMobOnField = lastState.me.field.some(c => c && c.type === 'mob');
  if (!hasMobOnField) {
    if (!confirm('필드에 몹 카드를 배치하지 않았습니다! 이대로 진행하시겠습니까?')) {
      return;
    }
  }

  // 즉각적인 버튼 UI 반응
  const confirmBtn = document.getElementById('confirmPlacementBtn');
  if (confirmBtn) {
    confirmBtn.disabled = true;
    confirmBtn.style.background = '#059669';
    confirmBtn.textContent = '✔️ 준비 완료 (상대방 기다리는 중...)';
  }
  const myBadge = document.getElementById('myPlacementBadge');
  if (myBadge) {
    myBadge.textContent = '내 상태: 준비 완료 ✔️';
    myBadge.className = 'ready-badge done';
  }

  socket.emit('confirmPlacement');
}

function drawCard() { socket.emit('drawCard'); }

// ===== 스킬 선택 및 사용 (공격 스킬 버그 수정 적용) =====
function selectSkill(cardInstanceId, skillId) {
  if (lastState && lastState.phase === 'battle' && !lastState.isMyTurn) {
    alert('상대방의 턴입니다. 내 턴에만 스킬을 사용할 수 있습니다.');
    return;
  }
  const card = lastState.me.field.find(c => c && c.instanceId === cardInstanceId);
  if (!card) return;
  const sk = (card.skills || []).find(s => s.id === skillId);
  if (!sk) return;

  if (sk.targetType === 'passive') {
    alert('패시브 스킬은 직접 사용할 수 없습니다.');
    return;
  }

  // 1. 대상이 필요 없는 스킬 (자가회복, 전체공격, 버프 등): 즉시 발동!
  if (sk.targetType === 'none') {
    socket.emit('useSkill', { cardInstanceId, skillId, targetOwner: 'none', targetInstanceId: null });
    log(`⚡ [${card.name}]이(가) [${sk.name}] 스킬을 시전했습니다!`);
    return;
  }

  // 2. 상대 1명 대상 공격 스킬: 살아있는 상대 몹 확인
  if (sk.targetType === 'enemy') {
    // 상대 필드에서 살아있는 몹 확인 (alive !== false && hp > 0)
    const oppMobs = (lastState.opponent ? lastState.opponent.field : []).filter(c => c && (c.alive !== false) && (c.hp > 0));
    if (oppMobs.length === 0) {
      alert('상대 필드에 공격할 살아있는 몹이 없습니다.');
      return;
    }

    pendingSkill = { cardInstanceId, skillId, targetType: 'enemy', skillName: sk.name };
    log(`⚔️ [${sk.name}] 공격 대상을 상대 필드에서 선택하세요.`);
    render(lastState);
  }

  // 3. 아군 1명 대상 지정 스킬 (targetType === 'ally')
  if (sk.targetType === 'ally') {
    const allyMobs = (lastState.me ? lastState.me.field : []).filter(c => c && (c.alive !== false) && (c.hp > 0));
    if (allyMobs.length === 0) {
      alert('필드에 살아있는 아군 몹이 없습니다.');
      return;
    }

    pendingSkill = { cardInstanceId, skillId, targetType: 'ally', skillName: sk.name };
    log(`✨ [${sk.name}] 적용 대상을 아군 필드에서 선택하세요.`);
    render(lastState);
  }
}

// ===== 자연재해 포식 (특성 패시브 자동 발동 안내) =====
function startPredation(cardInstanceId) {
  alert('자연재해 특성 [포식]은 턴 시작 시 아군 몹 1마리를 대상으로 자동 발동합니다.');
}

function tryEvolve(handInstanceId, defId) {
  if (lastState && lastState.phase === 'battle' && !lastState.isMyTurn) {
    alert('상대방의 턴입니다. 내 턴에만 진화할 수 있습니다.');
    return;
  }
  const evolvesFrom = defId === 'card_garados' ? 'card_inmyeoneo' : null;
  if (!evolvesFrom) return;
  const target = lastState.me.field.find(c => c && c.defId === evolvesFrom);
  if (!target) return alert('진화 대상(인면어 전장연)이 필드에 없습니다.');
  socket.emit('evolveCard', { handInstanceId, targetFieldInstanceId: target.instanceId });
}

function useConsumable(handInstanceId, defId, cardName) {
  const noTargetItems = ['item_ppa', 'item_chaekgabang', 'item_gisup', 'item_ahejang'];
  if (noTargetItems.includes(defId)) {
    socket.emit('useConsumable', { handInstanceId, payload: {} });
    return;
  }

  pendingConsumable = { handInstanceId, defId, cardName, needsTarget: true };
  log(`💡 [${cardName}] 효과를 적용할 카드를 클릭하세요.`);
  render(lastState);
  showNoTargetButton();
}

function showNoTargetButton() {
  let btn = document.getElementById('noTargetBtn');
  if (!btn) {
    btn = document.createElement('button');
    btn.id = 'noTargetBtn';
    btn.textContent = '대상 없이 바로 사용';
    btn.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:80;padding:12px 20px;background:var(--primary);color:#111;font-weight:800;border-radius:10px;font-size:14px;box-shadow:0 4px 15px rgba(0,0,0,0.5);border:2px solid #fff;cursor:pointer;';
    document.body.appendChild(btn);
  }
  btn.onclick = () => {
    if (pendingConsumable) {
      socket.emit('useConsumable', { handInstanceId: pendingConsumable.handInstanceId, payload: {} });
      pendingConsumable = null;
    }
    btn.remove();
    updateCancelButton();
    render(lastState);
  };
}

// ===== 타겟 선택 완료 처리 =====
function onTargetPicked(instanceId, owner) {
  // 1. 공격 / 아군 스킬
  if (pendingSkill) {
    if (pendingSkill.targetType === 'enemy' && owner === 'self') {
      log('⚠️ 공격 스킬은 아군을 대상으로 지정할 수 없습니다!');
      return;
    }
    if (pendingSkill.targetType === 'ally' && owner !== 'self') {
      log('⚠️ 아군 지정 스킬은 상대 카드를 대상으로 지정할 수 없습니다!');
      return;
    }
    socket.emit('useSkill', {
      cardInstanceId: pendingSkill.cardInstanceId,
      skillId: pendingSkill.skillId,
      targetOwner: owner,
      targetInstanceId: instanceId
    });
    pendingSkill = null;
  }
  // 2. 부착 아이템
  else if (pendingAttach) {
    if (owner !== 'self') {
      log('⚠️ 부착 아이템은 아군 카드에만 장착할 수 있습니다!');
      return;
    }
    socket.emit('attachItem', {
      handInstanceId: pendingAttach.handInstanceId,
      targetOwner: 'self',
      targetInstanceId: instanceId
    });
    pendingAttach = null;
  }
  // 3. 소모 아이템
  else if (pendingConsumable) {
    socket.emit('useConsumable', {
      handInstanceId: pendingConsumable.handInstanceId,
      payload: { targetOwner: owner, targetInstanceId: instanceId }
    });
    pendingConsumable = null;
    const btn = document.getElementById('noTargetBtn');
    if (btn) btn.remove();
  }
  // 4. 포식
  else if (predationState) {
    if (owner !== 'self' || instanceId === predationState.cardInstanceId) {
      log('⚠️ 포식은 자신의 다른 아군 몹만 대상으로 지정할 수 있습니다!');
      return;
    }
    socket.emit('usePredation', {
      cardInstanceId: predationState.cardInstanceId,
      sacrificeInstanceId: instanceId
    });
    predationState = null;
  }

  updateCancelButton();
  render(lastState);
}
