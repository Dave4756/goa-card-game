const { GameRoom } = require('../engine/GameRoom');

function genCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

class RoomManager {
  constructor() {
    this.rooms = new Map(); // code -> GameRoom
    this.matchQueue = []; // [{socketId, nickname}]
    this.socketToRoom = new Map(); // socketId -> code
  }

  createRoom(socketId, nickname) {
    let code;
    do {
      code = genCode();
    } while (this.rooms.has(code));
    const room = new GameRoom(code);
    room.addPlayer(socketId, nickname);
    this.rooms.set(code, room);
    this.socketToRoom.set(socketId, code);
    return room;
  }

  joinRoom(code, socketId, nickname) {
    const room = this.rooms.get(code);
    if (!room) return { error: '존재하지 않는 방 코드입니다.' };
    if (room.isFull()) return { error: '이미 인원이 가득 찬 방입니다.' };
    room.addPlayer(socketId, nickname);
    this.socketToRoom.set(socketId, code);
    return { room };
  }

  enqueueForMatch(socketId, nickname) {
    // 대기열에 이미 있는 상대가 있으면 즉시 매칭
    if (this.matchQueue.length > 0) {
      const opponent = this.matchQueue.shift();
      const room = this.createRoom(opponent.socketId, opponent.nickname);
      this.joinRoom(room.code, socketId, nickname);
      return { room, matched: true };
    }
    this.matchQueue.push({ socketId, nickname });
    return { matched: false };
  }

  cancelQueue(socketId) {
    this.matchQueue = this.matchQueue.filter((q) => q.socketId !== socketId);
  }

  getRoomBySocket(socketId) {
    const code = this.socketToRoom.get(socketId);
    if (!code) return null;
    return this.rooms.get(code) || null;
  }

  removeSocket(socketId) {
    this.cancelQueue(socketId);
    const code = this.socketToRoom.get(socketId);
    this.socketToRoom.delete(socketId);
    return code ? this.rooms.get(code) : null;
  }

  deleteRoom(code) {
    this.rooms.delete(code);
  }
}

module.exports = { RoomManager };
