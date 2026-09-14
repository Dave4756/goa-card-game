const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { RoomManager } = require('./src/rooms/RoomManager');
const { PHASE } = require('./src/engine/constants');
const cardData = require('./src/data/cards.json');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static(path.join(__dirname, 'public')));
app.get('/api/cards', (req, res) => res.json(cardData));
app.get('/healthz', (req, res) => res.send('ok'));

const manager = new RoomManager();

function broadcastState(room) {
  for (const p of room.players) {
    io.to(p.socketId).emit('state', room.serializeFor(p.socketId));
  }
}

function sendResult(socket, room, result) {
  if (!result.ok) {
    socket.emit('errorMsg', { error: result.error });
    return;
  }
  const events = result.events || room.flushEvents();
  io.to(room.code).emit('events', events);
  broadcastState(room);
  if (room.phase === PHASE.ENDED) {
    io.to(room.code).emit('gameOverFinal', { winner: room.winnerIndex !== null ? room.players[room.winnerIndex].nickname : null });
  }
}

io.on('connection', (socket) => {
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
      io.to(room.code).emit('events', room.flushEvents());
      broadcastState(room);
    } else {
      broadcastState(room);
    }
  });

  socket.on('findMatch', ({ nickname }) => {
    const res = manager.enqueueForMatch(socket.id, nickname);
    if (!res.matched) {
      socket.emit('waitingForOpponent');
      return;
    }
    const room = res.room;
    for (const p of room.players) {
      const s = io.sockets.sockets.get(p.socketId);
      if (s) s.join(room.code);
    }
    io.to(room.code).emit('roomJoined', { code: room.code });
    room.startMatch();
    io.to(room.code).emit('events', room.flushEvents());
    broadcastState(room);
  });

  socket.on('cancelFindMatch', () => manager.cancelQueue(socket.id));

  function withRoom(handlerFn) {
    return (payload) => {
      const room = manager.getRoomBySocket(socket.id);
      if (!room) return socket.emit('errorMsg', { error: '참여 중인 방이 없습니다.' });
      const player = room.getPlayerBySocket(socket.id);
      if (!player) return socket.emit('errorMsg', { error: '플레이어 정보를 찾을 수 없습니다.' });
      const result = handlerFn(room, player, payload || {});
      sendResult(socket, room, result);
    };
  }

  socket.on('placeMob', withRoom((room, player, { handInstanceId, slot }) => room.placeMobFromHand(player, handInstanceId, slot)));

  socket.on(
    'confirmPlacement',
    withRoom((room, player) => {
      player.placementReady = true;
      if (room.bothReadyForPlacement()) {
        room.beginBattlePhase();
      }
      return { ok: true, events: room.flushEvents() };
    })
  );

  socket.on('drawCard', withRoom((room, player) => room.drawCard(player)));

  socket.on(
    'useSkill',
    withRoom((room, player, { cardInstanceId, skillId, targetOwner, targetInstanceId }) =>
      room.useSkill(player, cardInstanceId, skillId, targetInstanceId ? { owner: targetOwner, instanceId: targetInstanceId } : null)
    )
  );

  socket.on(
    'attachItem',
    withRoom((room, player, { handInstanceId, targetOwner, targetInstanceId }) =>
      room.attachItem(player, handInstanceId, targetOwner, targetInstanceId)
    )
  );

  socket.on(
    'useConsumable',
    withRoom((room, player, { handInstanceId, payload }) => room.useConsumable(player, handInstanceId, payload))
  );

  socket.on(
    'evolveCard',
    withRoom((room, player, { handInstanceId, targetFieldInstanceId }) => room.evolveCard(player, handInstanceId, targetFieldInstanceId))
  );

  socket.on(
    'usePredation',
    withRoom((room, player, { cardInstanceId, sacrificeInstanceId }) => room.usePredation(player, cardInstanceId, sacrificeInstanceId))
  );

  socket.on(
    'returnToHand',
    withRoom((room, player, { instanceId }) => room.returnFieldCardToHand(player, instanceId))
  );

  socket.on('disconnect', () => {
    const room = manager.removeSocket(socket.id);
    if (room) {
      io.to(room.code).emit('opponentLeft');
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`전장연 카드게임 서버가 ${PORT}번 포트에서 실행 중입니다.`));
