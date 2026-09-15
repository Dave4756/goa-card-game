class Player {
  constructor(socketId, nickname, customDeck = null) {
    this.socketId = socketId;
    this.nickname = nickname || '이름없음';
    this.customDeck = customDeck;
    this.deck = [];   // CardInstance[]
    this.hand = [];   // CardInstance[]
    this.field = [null, null, null]; // 최대 3슬롯, CardInstance | null
    this.trash = [];  // CardInstance[]
    this.drawnThisTurn = false;
    this.placementReady = false;
    this.noHealExceptCardId = null; // 자연재해 스킬2 사용 시 전역 제한
  }

  shuffleDeck() {
    for (let i = this.deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.deck[i], this.deck[j]] = [this.deck[j], this.deck[i]];
    }
  }

  draw(n = 1) {
    const drawn = [];
    for (let i = 0; i < n; i++) {
      if (this.deck.length === 0) break;
      const c = this.deck.shift();
      this.hand.push(c);
      drawn.push(c);
    }
    return drawn;
  }

  fieldMobs() {
    return this.field.filter(Boolean);
  }

  hasAliveMob() {
    return this.fieldMobs().length > 0;
  }

  findOnField(instanceId) {
    return this.field.find((c) => c && c.instanceId === instanceId) || null;
  }

  fieldSlotOf(instanceId) {
    return this.field.findIndex((c) => c && c.instanceId === instanceId);
  }

  findInHand(instanceId) {
    return this.hand.find((c) => c.instanceId === instanceId) || null;
  }

  removeFromHand(instanceId) {
    const idx = this.hand.findIndex((c) => c.instanceId === instanceId);
    if (idx === -1) return null;
    return this.hand.splice(idx, 1)[0];
  }

  removeFromField(instanceId) {
    const idx = this.field.findIndex((c) => c && c.instanceId === instanceId);
    if (idx === -1) return null;
    const c = this.field[idx];
    this.field[idx] = null;
    return c;
  }

  neighborsOf(instanceId) {
    const idx = this.fieldSlotOf(instanceId);
    if (idx === -1) return [];
    const result = [];
    if (idx - 1 >= 0 && this.field[idx - 1]) result.push(this.field[idx - 1]);
    if (idx + 1 < this.field.length && this.field[idx + 1]) result.push(this.field[idx + 1]);
    return result;
  }
}

module.exports = { Player };
