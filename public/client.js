const socket = io();
let lastState = null;
let pendingSkill = null; // { cardInstanceId, skillId }
let pendingAttach = null; // { handInstanceId }
let pendingConsumable = null; // { handInstanceId, needsTarget }
let placingCard = null; // handInstanceId selected for placement

function log(msg) {
  const el = document.getElementById('log');
  const d = document.createElement('div');
  d.textContent = msg;
  el.appendChild(d);
  el.scrollTop = el.scrollHeight;
}

function createRoom() {
  socket.emit('createRoom', { nickname: document.getElementById('nickname').value || '플레이어' });
}
function joinRoom() {
  socket.emit('joinRoom', { code: document.getElementById('joinCode').value, nickname: document.getElementById('nickname').value || '플레이어' });
}
function findMatch() {
  socket.emit('findMatch', { nickname: document.getElementById('nickname').value || '플레이어' });
  document.getElementById('loginStatus').textContent = '상대를 찾는 중...';
}

socket.on('roomJoined', ({ code }) => {
  document.getElementById('loginView').style.display = 'none';
  document.getElementById('gameView').style.display = 'block';
  document.getElementById('roomCode').textContent = code;
});

socket.on('waitingForOpponent', () => {
  document.getElementById('loginStatus').textContent = '상대를 기다리는 중...';
});

socket.on('errorMsg', ({ error }) => alert(error));
socket.on('opponentLeft', () => alert('상대방이 게임을 나갔습니다.'));
socket.on('gameOverFinal', ({ winner }) => log(`=== 게임 종료: ${winner} 승리! ===`));

socket.on('events', (events) => {
  for (const e of events) {
    if (e.type === 'log') log(e.payload.message);
    else if (e.type === 'coinFlip') log(`🪙 동전 던지기 (${e.payload.reason}) -> ${e.payload.result === 'heads' ? '앞면' : '뒷면'}`);
    else if (e.type === 'damage') log(`💥 ${e.payload.amount} 피해 (hp -> ${e.payload.hpAfter})`);
    else if (e.type === 'heal') log(`💚 ${e.payload.amount} 회복 (hp -> ${e.payload.hpAfter})`);
    else if (e.type === 'death') log(`☠ ${e.payload.name} 쓰러짐`);
    else if (e.type === 'specialEvolution') log(`✨ 특수 연출: ${e.payload.name}`);
  }
});

socket.on('state', (state) => {
  lastState = state;
  render(state);
});

function render(state) {
  document.getElementById('phase').textContent = state.phase;
  document.getElementById('turnInfo').textContent = state.phase === 'battle' ? `${state.turnNumber}턴 (${state.isMyTurn ? '내 턴' : '상대 턴'})` : '-';
  document.getElementById('oppName').textContent = state.opponent ? state.opponent.nickname : '대기 중';
  document.getElementById('turnHint').textContent = state.isMyTurn ? (state.me.drawnThisTurn ? '드로우 완료' : '드로우 가능') : '';

  document.getElementById('placementView').style.display = state.phase === 'placement' ? 'block' : 'none';

  renderHand(state);
  renderField('myField', state.me.field, false, state);
  renderField('oppField', state.opponent ? state.opponent.field : [], true, state);

  if (state.phase === 'placement') renderPlacement(state);
}

function cardEl(card, isEnemy) {
  const div = document.createElement('div');
  div.className = 'card' + (isEnemy ? ' enemy' : '') + (card && card.hp === 0 ? ' dead' : '');
  if (!card) {
    div.textContent = '(빈 슬롯)';
    return div;
  }
  if (card.type === 'mob') {
    const pct = Math.max(0, Math.round((card.hp / card.maxHp) * 100));
    div.innerHTML = `
      <b>${card.name}</b><br/>
      HP ${card.hp}/${card.maxHp}
      <div class="hpbar"><div style="width:${pct}%"></div></div>
      ${card.trait ? `<div style="color:#8fd;font-size:11px">[${card.trait.name}]</div>` : ''}
      ${Object.keys(card.statuses || {}).length ? `<div style="color:#f88;font-size:11px">${Object.keys(card.statuses).join(', ')}</div>` : ''}
      ${Object.entries(card.stacks || {}).map(([k, v]) => `<div style="font-size:11px">${k}: ${v}</div>`).join('')}
      ${(card.attachedItems || []).map((i) => `<div style="font-size:10px;color:#aaf">🔗${i.name}</div>`).join('')}
    `;
    if (!isEnemy && card.skills) {
      const btnRow = document.createElement('div');
      for (const sk of card.skills) {
        const b = document.createElement('button');
        b.textContent = sk.name.length > 10 ? sk.name.slice(0, 10) + '…' : sk.name;
        b.title = sk.desc || '';
        b.disabled = !lastState.isMyTurn || card.blocked;
        b.onclick = () => selectSkill(card.instanceId, sk.id);
        btnRow.appendChild(b);
      }
      if (card.defId === 'card_jaeonjaehae') {
        const pb = document.createElement('button');
        pb.textContent = '포식';
        pb.disabled = !lastState.isMyTurn;
        pb.onclick = () => startPredation(card.instanceId);
        btnRow.appendChild(pb);
      }
      div.appendChild(btnRow);
    }
    if (pendingSkill || pendingAttach || (pendingConsumable && pendingConsumable.needsTarget) || predationState) {
      const tb = document.createElement('button');
      tb.textContent = isEnemy ? '적으로 지정' : '아군으로 지정';
      tb.onclick = () => onTargetPicked(card.instanceId, isEnemy ? 'opponent' : 'self');
      div.appendChild(tb);
    }
  } else {
    div.textContent = `[아이템] ${card.name}`;
  }
  return div;
}

function renderField(containerId, field, isEnemy, state) {
  const el = document.getElementById(containerId);
  el.innerHTML = '';
  for (const c of field) el.appendChild(cardEl(c, isEnemy));
}

function renderHand(state) {
  const el = document.getElementById('myHand');
  el.innerHTML = '';
  for (const c of state.me.hand) {
    const div = document.createElement('div');
    div.className = 'card';
    div.innerHTML = `<b>${c.name}</b><br/><span style="font-size:11px">${c.type}</span>`;
    if (c.type === 'mob') {
      const b = document.createElement('button');
      b.textContent = '필드로';
      b.onclick = () => selectForPlacement(c.instanceId);
      div.appendChild(b);
      const evoDefId = evolvesFromMap()[c.defId];
      if (evoDefId) {
        const eb = document.createElement('button');
        eb.textContent = '진화시키기';
        eb.onclick = () => tryEvolve(c.instanceId);
        div.appendChild(eb);
      }
    } else if (c.type === 'item_attach') {
      const b = document.createElement('button');
      b.textContent = '장착 대상 선택';
      b.onclick = () => { pendingAttach = { handInstanceId: c.instanceId }; alert('장착할 대상 카드를 클릭하세요.'); render(lastState); };
      div.appendChild(b);
    } else if (c.type === 'item_consume') {
      const b = document.createElement('button');
      b.textContent = '사용';
      b.onclick = () => useConsumable(c.instanceId);
      div.appendChild(b);
    }
    el.appendChild(div);
  }
}

let evoMapCache = null;
function evolvesFromMap() {
  if (evoMapCache) return evoMapCache;
  evoMapCache = {}; // 실제로는 /api/cards 로 조회하지만 여기선 하드코딩된 진화 관계만 표기
  evoMapCache['card_inmyeoneo'] = 'card_garados';
  return evoMapCache;
}

function selectForPlacement(handInstanceId) {
  placingCard = handInstanceId;
  renderPlacement(lastState);
}

function renderPlacement(state) {
  const slotEl = document.getElementById('slotButtons');
  slotEl.innerHTML = placingCard ? '슬롯 선택: ' : '';
  if (!placingCard) return;
  for (let i = 0; i < 3; i++) {
    const b = document.createElement('button');
    b.textContent = `슬롯 ${i + 1}`;
    b.disabled = !!state.me.field[i];
    b.onclick = () => {
      socket.emit('placeMob', { handInstanceId: placingCard, slot: i });
      placingCard = null;
    };
    slotEl.appendChild(b);
  }
}

function confirmPlacement() {
  socket.emit('confirmPlacement');
}

function drawCard() {
  socket.emit('drawCard');
}

function selectSkill(cardInstanceId, skillId) {
  pendingSkill = { cardInstanceId, skillId };
  alert('대상을 클릭하세요 (대상이 필요 없는 스킬이면 자기 자신 카드를 클릭해도 됩니다).');
  render(lastState);
}

let predationState = null;
function startPredation(cardInstanceId) {
  predationState = { cardInstanceId };
  alert('포식할 자신의 다른 카드를 클릭하세요.');
  render(lastState);
}

function tryEvolve(handInstanceId) {
  const targetDefId = 'card_inmyeoneo';
  const target = lastState.me.field.find((c) => c && c.defId === targetDefId);
  if (!target) return alert('진화 대상이 필드에 없습니다.');
  socket.emit('evolveCard', { handInstanceId, targetFieldInstanceId: target.instanceId });
}

function useConsumable(handInstanceId) {
  pendingConsumable = { handInstanceId, needsTarget: true };
  alert('대상이 필요하면 카드를 클릭하세요. 대상이 필요 없다면 아래 "대상 없이 사용" 버튼을 누르세요.');
  render(lastState);
  showNoTargetButton();
}

function showNoTargetButton() {
  let btn = document.getElementById('noTargetBtn');
  if (!btn) {
    btn = document.createElement('button');
    btn.id = 'noTargetBtn';
    btn.textContent = '대상 없이 사용';
    document.body.appendChild(btn);
  }
  btn.onclick = () => {
    if (pendingConsumable) {
      socket.emit('useConsumable', { handInstanceId: pendingConsumable.handInstanceId, payload: {} });
      pendingConsumable = null;
    }
    btn.remove();
  };
}

function onTargetPicked(instanceId, owner) {
  if (pendingSkill) {
    socket.emit('useSkill', { cardInstanceId: pendingSkill.cardInstanceId, skillId: pendingSkill.skillId, targetOwner: owner, targetInstanceId: instanceId });
    pendingSkill = null;
  } else if (pendingAttach) {
    socket.emit('attachItem', { handInstanceId: pendingAttach.handInstanceId, targetOwner: owner, targetInstanceId: instanceId });
    pendingAttach = null;
  } else if (pendingConsumable) {
    socket.emit('useConsumable', { handInstanceId: pendingConsumable.handInstanceId, payload: { targetOwner: owner, targetInstanceId: instanceId } });
    pendingConsumable = null;
    const btn = document.getElementById('noTargetBtn');
    if (btn) btn.remove();
  } else if (predationState) {
    socket.emit('usePredation', { cardInstanceId: predationState.cardInstanceId, sacrificeInstanceId: instanceId });
    predationState = null;
  }
  render(lastState);
}
