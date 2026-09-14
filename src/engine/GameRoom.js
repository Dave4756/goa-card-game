const { Player } = require('./Player');
const { CardInstance } = require('./CardInstance');
const { STATUS, STACK, FIELD_KEYWORD, PHASE } = require('./constants');
const keywordHandler = require('./keywordHandler');
const cardData = require('../data/cards.json');
const skillHandlers = require('./skills');

const ALL_DEFS = {};
for (const m of cardData.mobs) ALL_DEFS[m.id] = m;
for (const it of cardData.items) ALL_DEFS[it.id] = it;

function buildStandardDeck() {
  // 히든/제한 카드(각성/자연재해)는 기본 덱 구성에서 제외
  const deck = [];
  for (const m of cardData.mobs) {
    if (m.hidden) continue;
    if (m.evolvesFrom) continue; // 진화체는 별도 취급 (기본 1장만 소지)
    deck.push(new CardInstance(m));
    deck.push(new CardInstance(m));
  }
  // 진화체 1장씩
  for (const m of cardData.mobs) {
    if (m.evolvesFrom) deck.push(new CardInstance(m));
  }
  // 자연재해?? 덱당 1장 제한
  const jjh = cardData.mobs.find((m) => m.id === 'card_jaeonjaehae');
  if (jjh) deck.push(new CardInstance(jjh));

  for (const it of cardData.items) {
    deck.push(new CardInstance(it));
  }
  return deck;
}

class GameRoom {
  constructor(code) {
    this.code = code;
    this.players = []; // Player[2]
    this.phase = PHASE.WAITING;
    this.turnPlayerIndex = 0;
    this.turnNumber = 0;
    this.blockedThisTurn = new Set();
    this.events = []; // 이번 액션에서 발생한 이벤트 로그 (클라 애니메이션용)
    this.globalNoHealExceptCardId = null;
    this.winnerIndex = null;
  }

  addPlayer(socketId, nickname) {
    const p = new Player(socketId, nickname);
    p.fieldKeyword = null;
    this.players.push(p);
    return p;
  }

  getPlayerBySocket(socketId) {
    return this.players.find((p) => p.socketId === socketId) || null;
  }

  getOpponent(player) {
    return this.players.find((p) => p !== player);
  }

  isFull() {
    return this.players.length === 2;
  }

  // ---------- 이벤트/로그 ----------
  pushEvent(type, payload) {
    this.events.push({ type, payload, t: Date.now() });
  }

  flushEvents() {
    const ev = this.events;
    this.events = [];
    return ev;
  }

  coinFlip(reason) {
    const heads = Math.random() < 0.5;
    this.pushEvent('coinFlip', { reason, result: heads ? 'heads' : 'tails' });
    return heads;
  }

  // ---------- 게임 시작 ----------
  startMatch() {
    for (const p of this.players) {
      p.deck = buildStandardDeck();
      p.shuffleDeck();
      // 최소 1장 이상의 몹 카드를 포함해서 3장 드로우
      let hand = [];
      let guard = 0;
      do {
        // 되돌리고 다시 셔플 (간단한 재시도 방식)
        p.deck.unshift(...hand);
        p.hand = [];
        p.shuffleDeck();
        hand = p.draw(3);
        guard += 1;
      } while (!hand.some((c) => c.type === 'mob') && guard < 50);
      this.pushEvent('log', { message: `${p.nickname}이(가) 카드 3장을 뽑았습니다.` });
    }
    this.phase = PHASE.PLACEMENT;
  }

  bothReadyForPlacement() {
    return this.players.every((p) => p.placementReady);
  }

  beginBattlePhase() {
    const heads = this.coinFlip('선공 결정');
    this.turnPlayerIndex = heads ? 0 : 1;
    this.turnNumber = 1;
    this.phase = PHASE.BATTLE;
    const first = this.players[this.turnPlayerIndex];
    this.pushEvent('log', { message: `${first.nickname}이(가) 선공입니다.` });
    this.runTurnStartHooks();
  }

  currentPlayer() {
    return this.players[this.turnPlayerIndex];
  }

  runTurnStartHooks() {
    const player = this.currentPlayer();
    const opponent = this.getOpponent(player);
    player.drawnThisTurn = false;
    this.blockedThisTurn = keywordHandler.onTurnStart(this, player, opponent);
    this.checkWin();
  }

  endTurn() {
    if (this.phase !== PHASE.BATTLE) return;
    this.turnPlayerIndex = 1 - this.turnPlayerIndex;
    this.turnNumber += 1;
    this.runTurnStartHooks();
  }

  // ---------- 전투 계산 ----------
  /** 공용 데미지 파이프라인. baseAmount 는 스킬 고유 계산이 끝난 "기본 피해량". */
  dealDamage({ sourcePlayer, sourceCard, targetPlayer, targetCard, baseAmount, skipSourceBonuses }) {
    if (!targetCard || !targetCard.alive) return 0;
    let amount = Math.max(0, baseAmount);

    // 공격자 보정 (영구 강화, 다음 공격 절반 디버프)
    if (sourceCard && !skipSourceBonuses) {
      amount += sourceCard.permanentDamageBonus || 0;
      if (sourceCard.hasStatus(STATUS.HALVE_NEXT_DAMAGE_DEALT)) {
        amount = Math.floor(amount / 2);
        sourceCard.removeStatus(STATUS.HALVE_NEXT_DAMAGE_DEALT);
        this.pushEvent('log', { message: `${sourceCard.name}의 공격이 약화되어 있습니다.` });
      }
      // 기사도 정신: 자신 필드에 몹이 1장뿐이면 주는 피해 2배
      if (sourceCard.def.trait && sourceCard.def.trait.id === 'chivalry' && sourcePlayer.fieldMobs().length === 1) {
        amount *= 2;
      }
    }

    // 방어자 보정
    // 하이퍼포커스: 다음 받는 피해 절반
    if (targetCard.hasStatus(STATUS.HALVE_NEXT_DAMAGE_TAKEN)) {
      amount = Math.floor(amount / 2);
      targetCard.removeStatus(STATUS.HALVE_NEXT_DAMAGE_TAKEN);
    }
    // 태권도 노란띠: 받는 피해 -50%
    if (targetCard.def.trait && targetCard.def.trait.id === 'yellow_belt') {
      amount = Math.floor(amount * 0.5);
    }
    // 기사도 정신: 자신 필드에 몹이 1장뿐이면 받는 피해 절반
    if (targetCard.def.trait && targetCard.def.trait.id === 'chivalry' && targetPlayer.fieldMobs().length === 1) {
      amount = Math.floor(amount * 0.5);
    }
    // 메카: 중국산 베터리 - 과충전 스택당 받는 피해 +10
    if (targetCard.def.trait && targetCard.def.trait.id === 'china_battery') {
      amount += targetCard.getStack(STACK.OVERCHARGE) * 10;
    }

    amount = Math.max(0, Math.round(amount));

    // 흘러내린 머리카락: 양옆 아군이 입는 피해의 절반을 대신 받음
    const hairNeighbor = targetPlayer
      .neighborsOf(targetCard.instanceId)
      .find((n) => n.def.trait && n.def.trait.id === 'hair_redirect');

    let dealtToTarget = amount;
    if (hairNeighbor && hairNeighbor.instanceId !== targetCard.instanceId) {
      const half = Math.floor(amount / 2);
      dealtToTarget = amount - half;
      this._applyHp(targetPlayer, targetCard, dealtToTarget);
      this._applyHp(targetPlayer, hairNeighbor, half);
      this.pushEvent('log', {
        message: `${hairNeighbor.name}이(가) ${targetCard.name}이(가) 입을 피해의 절반(${half})을 대신 받았습니다.`,
      });
    } else {
      this._applyHp(targetPlayer, targetCard, dealtToTarget);
    }

    // 생명흡수 트레잇 (연기력 / 아침 시간에 자습하자니까)
    if (sourceCard && sourceCard.def.trait) {
      const tid = sourceCard.def.trait.id;
      if (tid === 'acting' || tid === 'self_study') {
        const healAmount = Math.floor(amount * 0.3);
        if (healAmount > 0) this.heal(sourceCard, healAmount);
      }
    }

    return amount;
  }

  _applyHp(player, card, amount) {
    card.hp = Math.max(0, card.hp - amount);
    this.pushEvent('damage', { instanceId: card.instanceId, amount, hpAfter: card.hp });
    this.checkDeath(card);
  }

  /** 전체 필드 대상 데미지 (와도 일으키기, 세 가지 힘 등) */
  dealDamageAll({ sourcePlayer, sourceCard, targetPlayer, baseAmount }) {
    for (const t of [...targetPlayer.fieldMobs()]) {
      this.dealDamage({ sourcePlayer, sourceCard, targetPlayer, targetCard: t, baseAmount });
    }
  }

  /** 영구 데미지 (자연재해 스킬2): 최대체력도 함께 깎음 */
  dealPermanentDamageAll(baseAmount) {
    for (const player of this.players) {
      for (const c of [...player.fieldMobs()]) {
        c.maxHp = Math.max(0, c.maxHp - baseAmount);
        c.hp = Math.max(0, c.hp - baseAmount);
        this.pushEvent('damage', { instanceId: c.instanceId, amount: baseAmount, hpAfter: c.hp, reason: 'permanent' });
        this.checkDeath(c);
      }
    }
  }

  heal(card, amount) {
    if (amount <= 0) return 0;
    if (this.globalNoHealExceptCardId && this.globalNoHealExceptCardId !== card.instanceId) {
      this.pushEvent('log', { message: `${card.name}은(는) 더 이상 회복할 수 없습니다.` });
      return 0;
    }
    const before = card.hp;
    card.hp = Math.min(card.maxHp, card.hp + amount);
    const healed = card.hp - before;
    if (healed > 0) this.pushEvent('heal', { instanceId: card.instanceId, amount: healed, hpAfter: card.hp });
    return healed;
  }

  checkDeath(card) {
    if (card.hp <= 0 && card.alive) {
      card.alive = false;
      for (const player of this.players) {
        const idx = player.fieldSlotOf(card.instanceId);
        if (idx !== -1) {
          player.field[idx] = null;
          for (const item of card.attachedItems) player.trash.push(item);
          card.attachedItems = [];
          player.trash.push(card);
          this.pushEvent('death', { instanceId: card.instanceId, name: card.name });
          this.pushEvent('log', { message: `${card.name}이(가) 쓰러졌습니다.` });
        }
      }
    }
  }

  checkWin() {
    for (const p of this.players) {
      if (!p.hasAliveMob() && p.deck.length === 0 && !p.hand.some((c) => c.type === 'mob')) {
        // 필드도 비고, 낼 수 있는 몹카드도 전혀 없으면 패배
        const winner = this.getOpponent(p);
        this.phase = PHASE.ENDED;
        this.winnerIndex = this.players.indexOf(winner);
        this.pushEvent('gameOver', { winner: winner.nickname });
        return true;
      }
      if (!p.hasAliveMob() && p.field.every((s) => s === null)) {
        // 필드에 낼 몹이 아예 없는 상태에서 필드가 완전히 비면 즉시 패배 처리 (룰: 필드 몹 0 = 패배)
        const winner = this.getOpponent(p);
        this.phase = PHASE.ENDED;
        this.winnerIndex = this.players.indexOf(winner);
        this.pushEvent('gameOver', { winner: winner.nickname });
        return true;
      }
    }
    return false;
  }

  // ---------- 액션 처리 ----------
  isCardActionBlocked(instanceId) {
    return this.blockedThisTurn.has(instanceId);
  }

  useSkill(player, cardInstanceId, skillId, targetInfo) {
    if (this.phase !== PHASE.BATTLE) return { ok: false, error: '전투 페이즈가 아닙니다.' };
    if (player !== this.currentPlayer()) return { ok: false, error: '당신의 턴이 아닙니다.' };
    const card = player.findOnField(cardInstanceId);
    if (!card) return { ok: false, error: '해당 카드를 필드에서 찾을 수 없습니다.' };
    if (this.isCardActionBlocked(card.instanceId)) return { ok: false, error: '이 카드는 이번 턴 행동할 수 없습니다.' };
    if (card.flags.solarBeamPending) return { ok: false, error: '이 카드는 빛을 모으는 중입니다.' };

    const opponent = this.getOpponent(player);

    // 혼란 판정 (모든 능동 스킬 사용 시 적용)
    const confusion = keywordHandler.checkConfusion(this, card);
    if (confusion.cancelled) {
      this.endTurn();
      return { ok: true, events: this.flushEvents() };
    }

    const handlerGroup = skillHandlers[card.defId];
    if (!handlerGroup || !handlerGroup[skillId]) {
      return { ok: false, error: '사용할 수 없는 스킬입니다.' };
    }

    const target = this._resolveTarget(player, opponent, targetInfo);
    handlerGroup[skillId]({ room: this, player, opponent, card, target, targetInfo });

    card.flags.lastSkillUsedPrev = card.flags.lastSkillUsed;
    card.flags.lastSkillUsed = skillId;

    this.checkWin();
    if (this.phase === PHASE.BATTLE) this.endTurn();
    return { ok: true, events: this.flushEvents() };
  }

  _resolveTarget(player, opponent, targetInfo) {
    // 이 칠판 지우개를 봐: 상대(공격자) 입장에서 지정된 카드가 있으면 강제 고정
    const fixed = opponent.fieldMobs().find((c) => c.hasStatus(STATUS.FIXED_TARGET));
    if (fixed) {
      fixed.removeStatus(STATUS.FIXED_TARGET);
      return fixed;
    }
    if (!targetInfo) return null;
    const pool = targetInfo.owner === 'self' ? player : opponent;
    return pool.findOnField(targetInfo.instanceId) || null;
  }

  drawCard(player) {
    if (this.phase !== PHASE.BATTLE) return { ok: false, error: '전투 페이즈가 아닙니다.' };
    if (player !== this.currentPlayer()) return { ok: false, error: '당신의 턴이 아닙니다.' };
    if (player.drawnThisTurn) return { ok: false, error: '이번 턴에 이미 드로우했습니다.' };
    const drawn = player.draw(1);
    player.drawnThisTurn = true;
    if (drawn.length > 0) {
      this.pushEvent('log', { message: `${player.nickname}이(가) 카드를 드로우했습니다.` });
    } else {
      this.pushEvent('log', { message: `${player.nickname}의 덱에 카드가 없습니다.` });
    }
    return { ok: true, events: this.flushEvents() };
  }

  placeMobFromHand(player, handInstanceId, slot) {
    const card = player.findInHand(handInstanceId);
    if (!card || card.type !== 'mob') return { ok: false, error: '몹 카드가 아닙니다.' };
    if (slot < 0 || slot > 2 || player.field[slot]) return { ok: false, error: '해당 슬롯에 배치할 수 없습니다.' };
    player.removeFromHand(handInstanceId);
    player.field[slot] = card;
    this.pushEvent('log', { message: `${player.nickname}이(가) ${card.name}을(를) 필드에 배치했습니다.` });
    return { ok: true, events: this.flushEvents() };
  }

  returnFieldCardToHand(player, instanceId) {
    const card = player.removeFromField(instanceId);
    if (!card) return { ok: false, error: '카드를 찾을 수 없습니다.' };
    for (const item of card.attachedItems) player.trash.push(item);
    card.attachedItems = [];
    player.hand.push(card);
    return { ok: true, events: this.flushEvents() };
  }

  attachItem(player, handInstanceId, targetOwner, targetInstanceId) {
    const item = player.findInHand(handInstanceId);
    if (!item || item.type !== 'item_attach') return { ok: false, error: '부착형 아이템이 아닙니다.' };
    const targetPlayer = targetOwner === 'self' ? player : this.getOpponent(player);
    const target = targetPlayer.findOnField(targetInstanceId);
    if (!target) return { ok: false, error: '대상 카드를 찾을 수 없습니다.' };
    player.removeFromHand(handInstanceId);
    target.attachedItems.push(item);
    this.pushEvent('log', { message: `${target.name}에게 [${item.name}]을(를) 장착했습니다.` });

    this._checkAwakenEvolution(targetPlayer, target);
    return { ok: true, events: this.flushEvents() };
  }

  _checkAwakenEvolution(owner, card) {
    if (card.defId !== 'card_jeonjangyeon') return;
    const names = card.attachedItems.map((i) => i.defId);
    const need = ['item_innaeryeok', 'item_hakseupryeok', 'item_sahoechinhwaryeok'];
    if (need.every((n) => names.includes(n))) {
      const def = ALL_DEFS['card_gakseong'];
      const hpRatio = card.hp / card.maxHp;
      card.defId = def.id;
      card.def = def;
      card.name = def.name;
      card.maxHp = def.hp;
      card.hp = Math.round(def.hp * hpRatio) || def.hp;
      this.pushEvent('specialEvolution', { instanceId: card.instanceId, name: card.name, kind: 'gakseong_awaken' });
      this.pushEvent('log', { message: `⚡ ${card.name}이(가) 각성했습니다!` });
    }
  }

  evolveCard(player, handInstanceId, targetFieldInstanceId) {
    const evoCard = player.findInHand(handInstanceId);
    if (!evoCard) return { ok: false, error: '카드를 찾을 수 없습니다.' };
    const base = player.findOnField(targetFieldInstanceId);
    if (!base) return { ok: false, error: '진화 대상을 찾을 수 없습니다.' };
    if (evoCard.def.evolvesFrom !== base.defId) return { ok: false, error: '진화 조건이 맞지 않습니다.' };

    player.removeFromHand(handInstanceId);
    const slot = player.fieldSlotOf(base.instanceId);
    const hpRatio = base.hp / base.maxHp;
    evoCard.hp = Math.round(evoCard.maxHp * hpRatio) || evoCard.maxHp;
    evoCard.attachedItems = base.attachedItems;
    player.field[slot] = evoCard;
    player.trash.push(base);

    this.pushEvent('specialEvolution', { instanceId: evoCard.instanceId, name: evoCard.name, kind: 'garados_evolve' });
    this.pushEvent('log', { message: `🌊 ${base.name}이(가) ${evoCard.name}(으)로 진화했습니다!` });
    return { ok: true, events: this.flushEvents() };
  }

  useConsumable(player, handInstanceId, payload) {
    const item = player.findInHand(handInstanceId);
    if (!item || item.type !== 'item_consume') return { ok: false, error: '소모형 아이템이 아닙니다.' };
    const opponent = this.getOpponent(player);
    const result = require('./skills').consumables[item.defId]?.({ room: this, player, opponent, payload });
    if (result && result.error) return { ok: false, error: result.error };
    player.removeFromHand(handInstanceId);
    player.trash.push(item);
    this.checkWin();
    return { ok: true, events: this.flushEvents() };
  }

  usePredation(player, cardInstanceId, sacrificeInstanceId) {
    const card = player.findOnField(cardInstanceId);
    if (!card || card.defId !== 'card_jaeonjaehae') return { ok: false, error: '해당 카드는 포식을 사용할 수 없습니다.' };
    if (player !== this.currentPlayer()) return { ok: false, error: '당신의 턴이 아닙니다.' };
    const target = player.findOnField(sacrificeInstanceId);
    if (!target || target.instanceId === card.instanceId) return { ok: false, error: '포식할 대상이 올바르지 않습니다.' };
    player.removeFromField(target.instanceId);
    player.trash.push(target);
    this.heal(card, 100);
    this.pushEvent('log', { message: `${card.name}이(가) ${target.name}을(를) 포식하고 hp 100을 회복했습니다.` });
    this.endTurn();
    return { ok: true, events: this.flushEvents() };
  }

  // ---------- 상태 스냅샷 (플레이어 시점) ----------
  serializeCard(card, hidden) {
    if (!card) return null;
    if (hidden) {
      return { hidden: true, instanceId: card.instanceId, type: card.type };
    }
    const base = {
      instanceId: card.instanceId,
      defId: card.defId,
      name: card.name,
      type: card.type,
    };
    if (card.type === 'mob') {
      return {
        ...base,
        hp: card.hp,
        maxHp: card.maxHp,
        trait: card.def.trait,
        skills: card.def.skills,
        statuses: card.statuses,
        stacks: card.stacks,
        attachedItems: card.attachedItems.map((i) => ({ instanceId: i.instanceId, defId: i.defId, name: i.name, desc: i.def.desc })),
        permanentDamageBonus: card.permanentDamageBonus,
        flags: { solarBeamPending: card.flags.solarBeamPending, skillLockTurns: card.flags.skillLockTurns },
        blocked: this.isCardActionBlocked(card.instanceId),
      };
    }
    return { ...base, desc: card.def.desc };
  }

  serializeFor(socketId) {
    const me = this.getPlayerBySocket(socketId);
    if (!me) return null;
    const opp = this.getOpponent(me);
    return {
      code: this.code,
      phase: this.phase,
      turnNumber: this.turnNumber,
      isMyTurn: this.phase === PHASE.BATTLE && this.currentPlayer() === me,
      globalNoHealExceptCardId: this.globalNoHealExceptCardId,
      me: {
        nickname: me.nickname,
        hand: me.hand.map((c) => this.serializeCard(c, false)),
        field: me.field.map((c) => this.serializeCard(c, false)),
        trash: me.trash.map((c) => this.serializeCard(c, false)),
        deckCount: me.deck.length,
        drawnThisTurn: me.drawnThisTurn,
        fieldKeyword: me.fieldKeyword,
        placementReady: me.placementReady,
      },
      opponent: opp
        ? {
            nickname: opp.nickname,
            handCount: opp.hand.length,
            field: opp.field.map((c) => this.serializeCard(c, false)),
            trash: opp.trash.map((c) => this.serializeCard(c, false)),
            deckCount: opp.deck.length,
            fieldKeyword: opp.fieldKeyword,
            placementReady: opp.placementReady,
          }
        : null,
      winner: this.winnerIndex !== null ? this.players[this.winnerIndex].nickname : null,
    };
  }
}

module.exports = { GameRoom, ALL_DEFS };
