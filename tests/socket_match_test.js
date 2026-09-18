const assert = require('assert');
const { EventEmitter } = require('events');
const { RoomManager } = require('../src/rooms/RoomManager');
const { PHASE } = require('../src/engine/constants');

console.log('🌐 [소켓 시뮬레이션 1:1 대전 통합 테스트 시작]');

class MockSocket extends EventEmitter {
  constructor(id) {
    super();
    this.id = id;
    this.peer = null;
    this.rooms = new Set();
  }

  join(roomCode) {
    this.rooms.add(roomCode);
  }

  leave(roomCode) {
    this.rooms.delete(roomCode);
  }

  // 상대편에게 이벤트 전송
  emit(event, ...args) {
    if (this.peer) {
      setImmediate(() => {
        EventEmitter.prototype.emit.call(this.peer, event, ...args);
      });
    }
  }
}

function createSocketPair(id) {
  const serverSide = new MockSocket(id);
  const clientSide = new MockSocket(id);
  serverSide.peer = clientSide;
  clientSide.peer = serverSide;
  return { serverSide, clientSide };
}

// 서버 환경 세팅
const manager = new RoomManager();
const serverSockets = new Map();

function broadcastToRoom(roomCode, event, data) {
  for (const s of serverSockets.values()) {
    if (s.rooms.has(roomCode)) {
      s.emit(event, data);
    }
  }
}

function broadcastState(room) {
  for (const p of room.players) {
    const s = serverSockets.get(p.socketId);
    if (s) s.emit('state', room.serializeFor(p.socketId));
  }
}

function sendResult(socket, room, result) {
  if (!result.ok) {
    socket.emit('errorMsg', { error: result.error });
    return;
  }
  const events = result.events || room.flushEvents();
  broadcastToRoom(room.code, 'events', events);
  broadcastState(room);
  if (room.phase === PHASE.ENDED) {
    broadcastToRoom(room.code, 'gameOverFinal', { winner: room.winnerIndex !== null ? room.players[room.winnerIndex].nickname : null });
  }
}

function registerServerHandlers(socket) {
  serverSockets.set(socket.id, socket);

  socket.on('createRoom', ({ nickname }) => {
    const room = manager.createRoom(socket.id, nickname);
    socket.join(room.code);
    socket.emit('roomJoined', { code: room.code });
    broadcastState(room);
  });

  socket.on('joinRoom', ({ code, nickname }) => {
    const res = manager.joinRoom((code || '').toUpperCase(), socket.id, nickname);
    if (res.error) return socket.emit('errorMsg', { error: res.error });
    const room = res.room;
    socket.join(room.code);
    socket.emit('roomJoined', { code: room.code });
    if (room.isFull()) {
      room.startMatch();
      broadcastToRoom(room.code, 'events', room.flushEvents());
      broadcastState(room);
    }
  });

  function withRoom(handlerFn) {
    return (payload) => {
      const room = manager.getRoomBySocket(socket.id);
      if (!room) return socket.emit('errorMsg', { error: '방 없음' });
      const player = room.getPlayerBySocket(socket.id);
      if (!player) return socket.emit('errorMsg', { error: '플레이어 없음' });
      const result = handlerFn(room, player, payload || {});
      sendResult(socket, room, result);
    };
  }

  socket.on('placeMob', withRoom((room, player, { handInstanceId, slot }) => room.placeMobFromHand(player, handInstanceId, slot)));
  socket.on('confirmPlacement', withRoom((room, player) => {
    player.placementReady = true;
    if (room.bothReadyForPlacement()) room.beginBattlePhase();
    return { ok: true, events: room.flushEvents() };
  }));
  socket.on('drawCard', withRoom((room, player) => room.drawCard(player)));
  socket.on('useSkill', withRoom((room, player, { cardInstanceId, skillId, targetOwner, targetInstanceId }) =>
    room.useSkill(player, cardInstanceId, skillId, targetInstanceId ? { owner: targetOwner, instanceId: targetInstanceId } : null)
  ));
  socket.on('usePredation', withRoom((room, player, { cardInstanceId, sacrificeInstanceId }) =>
    room.usePredation(player, cardInstanceId, sacrificeInstanceId)
  ));
  socket.on('skipTurn', withRoom((room, player) => room.skipTurn(player)));
  socket.on('attachItem', withRoom((room, player, { handInstanceId, targetOwner, targetInstanceId }) =>
    room.attachItem(player, handInstanceId, { owner: targetOwner, instanceId: targetInstanceId })
  ));
}

// 테스트 실행
async function runTest() {
  const p1 = createSocketPair('socket_p1');
  const p2 = createSocketPair('socket_p2');
  registerServerHandlers(p1.serverSide);
  registerServerHandlers(p2.serverSide);

  let roomCode = null;
  let p1State = null;
  let p2State = null;
  let turnChanges = [];

  p1.clientSide.on('roomJoined', ({ code }) => { roomCode = code; });
  p1.clientSide.on('state', (s) => { p1State = s; });
  p2.clientSide.on('state', (s) => { p2State = s; });
  p1.clientSide.on('events', (evs) => {
    evs.filter(e => e.type === 'turnChange').forEach(e => turnChanges.push(e));
  });

  // 1. 방 생성
  p1.clientSide.emit('createRoom', { nickname: '유저1' });
  await new Promise(r => setTimeout(r, 60));
  assert.ok(roomCode, '방 코드 발급 완료');
  console.log('✅ P1 방 생성 완료: 코드 =', roomCode);

  // 2. 방 참가
  p2.clientSide.emit('joinRoom', { code: roomCode, nickname: '유저2' });
  await new Promise(r => setTimeout(r, 60));
  assert.strictEqual(p1State.phase, 'placement', '2인 입장 후 PLACEMENT 페이즈 진입');
  console.log('✅ P2 방 입장 및 배치 페이즈 시작');

  // 3. 몹 배치
  const p1Mob = p1State.me.hand.find(c => c.type === 'mob');
  const p2Mob = p2State.me.hand.find(c => c.type === 'mob');
  p1.clientSide.emit('placeMob', { handInstanceId: p1Mob.instanceId, slot: 0 });
  p2.clientSide.emit('placeMob', { handInstanceId: p2Mob.instanceId, slot: 0 });
  await new Promise(r => setTimeout(r, 60));

  // 4. 배치 완료 (준비)
  p1.clientSide.emit('confirmPlacement');
  p2.clientSide.emit('confirmPlacement');
  await new Promise(r => setTimeout(r, 60));
  assert.strictEqual(p1State.phase, 'battle', '배치 완료 후 BATTLE 페이즈 진입');
  assert.ok(turnChanges.length > 0, '선공 코인플립 후 turnChange 이벤트 발생');
  console.log('✅ BATTLE 페이즈 시작 & 선공 turnChange 이벤트 수신 (선공:', turnChanges[0].payload.nickname, ')');

  // 5. 선공 플레이어 턴
  const getActiveClient = () => p1State.isMyTurn ? p1.clientSide : p2.clientSide;
  const getActiveState = () => p1State.isMyTurn ? p1State : p2State;
  const getOppState = () => p1State.isMyTurn ? p2State : p1State;

  // 드로우
  getActiveClient().emit('drawCard');
  await new Promise(r => setTimeout(r, 60));
  assert.strictEqual(getActiveState().me.drawnThisTurn, true, '턴 1회 드로우 확인');
  console.log('✅ 선공 플레이어 카드 드로우 완료');

  // 스킬 사용
  const myCard = getActiveState().me.field[0];
  const oppCard = getOppState().me.field[0];
  const sk = myCard.skills[0];

  getActiveClient().emit('useSkill', {
    cardInstanceId: myCard.instanceId,
    skillId: sk.id,
    targetOwner: 'opponent',
    targetInstanceId: oppCard.instanceId
  });

  await new Promise(r => setTimeout(r, 80));
  assert.strictEqual(turnChanges.length, 2, '스킬 시전 후 상대방으로 턴 자동 전환 확인');
  console.log('✅ 스킬 시전 및 턴 전환 완료 (다음 턴:', turnChanges[1].payload.nickname, ')');

  // 6. 턴 넘기기 (스킵) 테스트
  const nextClient = getActiveClient();
  nextClient.emit('skipTurn');
  await new Promise(r => setTimeout(r, 80));
  assert.strictEqual(turnChanges.length, 3, 'skipTurn 후 다음 플레이어로 턴 전환 확인');
  console.log('✅ 턴 넘기기(스킵) 정상 작동 및 턴 전환 완료 (다음 턴:', turnChanges[2].payload.nickname, ')');

  // 7. 아이템 사용 시 itemUsed 브로드캐스트 이벤트 테스트
  let itemUsedEvents = [];
  p1.clientSide.on('events', (evs) => {
    evs.filter(e => e.type === 'itemUsed').forEach(e => itemUsedEvents.push(e));
  });
  p2.clientSide.on('events', (evs) => {
    evs.filter(e => e.type === 'itemUsed').forEach(e => itemUsedEvents.push(e));
  });

  const curActiveClient = getActiveClient();
  const curState = getActiveState();
  const itemInHand = curState.me.hand.find(c => c.type === 'item_attach');
  if (itemInHand) {
    curActiveClient.emit('attachItem', {
      handInstanceId: itemInHand.instanceId,
      targetOwner: 'self',
      targetInstanceId: curState.me.field[0].instanceId
    });
    await new Promise(r => setTimeout(r, 600));
    assert.ok(itemUsedEvents.length > 0, '아이템 사용 시 itemUsed 이벤트 수신');
    console.log('✅ 아이템 카드 사용 시 양측 화면 연출용 itemUsed 이벤트 브로드캐스트 정상 검증');
  } else {
    console.log('ℹ️  현재 손패에 장착 아이템 없어서 itemUsed 테스트 스킵 (정상)');
  }


  console.log('\n🎉 [소켓 시뮬레이션 실시간 1:1 대전 테스트 ALL PASS!]');
}

runTest().catch(err => {
  console.error('❌ 테스트 에러:', err);
  process.exit(1);
});
