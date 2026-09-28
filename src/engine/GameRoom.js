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

function buildCustomDeck(cardIds) {
  if (!Array.isArray(cardIds) || cardIds.length !== 20) {
    return buildStandardDeck();
  }
  const counts = {};
  const deck = [];
  for (const id of cardIds) {
    const def = ALL_DEFS[id];
    if (!def || def.hidden) return buildStandardDeck();
    counts[id] = (counts[id] || 0) + 1;
    const maxLimit = def.deckLimit || 2;
    if (counts[id] > maxLimit) return buildStandardDeck();
    deck.push(new CardInstance(def));
  }
  if (!deck.some((c) => c.type === 'mob')) return buildStandardDeck();
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

  addPlayer(socketId, nickname, customDeck = null) {
    const p = new Player(socketId, nickname, customDeck);
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
      p.deck = buildCustomDeck(p.customDeck);
      p.shuffleDeck();
      // 최소 1장 이상의 직접 배치 가능한 기본 몹 카드를 포함해서 3장 드로우 (진화 전용 몹 제외)
      let hand = [];
      let guard = 0;
      do {
        // 되돌리고 다시 셔플 (간단한 재시도 방식)
        p.deck.unshift(...hand);
        p.hand = [];
        p.shuffleDeck();
        hand = p.draw(3);
        guard += 1;
      } while (!hand.some((c) => c.type === 'mob' && !c.def.evolvesFrom) && guard < 50);
      this.pushEvent('log', { message: `${p.nickname}이(가) 카드 3장을 뽑았습니다.` });
    }
    this.phase = PHASE.PLACEMENT;
  }

  bothReadyForPlacement() {
    return this.players.every((p) => p.placementReady);
  }

  beginBattlePhase() {
    const heads = Math.random() < 0.5;
    this.turnPlayerIndex = heads ? 0 : 1;
    this.turnNumber = 1;
    this.phase = PHASE.BATTLE;
    const first = this.players[this.turnPlayerIndex];
    this.pushEvent('coinFlip', {
      reason: '선공 결정',
      result: heads ? 'heads' : 'tails',
      isInitiative: true,
      firstPlayerSocketId: first.socketId,
      firstPlayerNickname: first.nickname,
    });
    this.pushEvent('log', { message: `${first.nickname}이(가) 선공입니다.` });
    this.pushEvent('turnChange', { nickname: first.nickname, turnNumber: 1, playerIndex: this.turnPlayerIndex, socketId: first.socketId });
    this.runTurnStartHooks();
  }

  currentPlayer() {
    return this.players[this.turnPlayerIndex];
  }

  runTurnStartHooks() {
    const player = this.currentPlayer();
    const opponent = this.getOpponent(player);
    player.drawnThisTurn = false;
    player.usedItemDefsThisTurn = [];

    // 필드의 각 몹 카드의 필드 경과 턴 수 증가
    for (const card of player.field) {
      if (card && card.alive) card.turnsOnField = (card.turnsOnField || 0) + 1;
    }

    // 자연재해 특성 [포식]: 매 턴 시작 시 다른 아군 몹 1마리 자동 포식
    const jaeonjaehaeCard = player.field.find(c => c && c.alive && c.defId === 'card_jaeonjaehae');
    if (jaeonjaehaeCard) {
      const preyCandidates = player.field.filter(c => c && c.alive && c.instanceId !== jaeonjaehaeCard.instanceId);
      if (preyCandidates.length > 0) {
        const target = preyCandidates[Math.floor(Math.random() * preyCandidates.length)];
        this._executePredation(player, jaeonjaehaeCard, target);
      }
    }

    // 매 턴 시작 시 자동 1장 드로우
    const drawn = player.draw(1);
    if (drawn.length > 0) {
      player.drawnThisTurn = true;
      this.pushEvent('cardDrawn', {
        playerSocketId: player.socketId,
        nickname: player.nickname,
        count: drawn.length,
      });
      this.pushEvent('log', { message: `🎴 ${player.nickname}이(가) 카드를 1장 드로우했습니다.` });
    }

    this.blockedThisTurn = keywordHandler.onTurnStart(this, player, opponent);
    this._updatePartyPassives(player);
    this._updatePartyPassives(opponent);
    this.checkWin();
  }



  skipTurn(player) {
    if (this.phase !== PHASE.BATTLE) return { ok: false, error: '전투 페이즈가 아닙니다.' };
    if (player !== this.currentPlayer()) return { ok: false, error: '당신의 턴이 아닙니다.' };
    this.pushEvent('log', { message: `⏭️ ${player.nickname}이(가) 턴을 넘겼습니다.` });
    this.endTurn();
    return { ok: true, events: this.flushEvents() };
  }

  endTurn() {
    if (this.phase !== PHASE.BATTLE) return;
    this.turnPlayerIndex = 1 - this.turnPlayerIndex;
    this.turnNumber += 1;
    const next = this.currentPlayer();
    this.pushEvent('turnChange', { nickname: next.nickname, turnNumber: this.turnNumber, playerIndex: this.turnPlayerIndex, socketId: next.socketId });
    this.runTurnStartHooks();
  }

  // ---------- 전투 계산 ----------
  /** 공용 데미지 파이프라인. baseAmount 는 스킬 고유 계산이 끝난 "기본 피해량". */
  dealDamage({ sourcePlayer, sourceCard, targetPlayer, targetCard, baseAmount, skipSourceBonuses }) {
    if (!targetCard || !targetCard.alive) return 0;
    let amount = Math.max(0, baseAmount);

    // 공격자 보정 (영구 강화, 다음 공격 절반 디버프, DMG_UP 스택)
    if (sourceCard && !skipSourceBonuses) {
      amount += sourceCard.permanentDamageBonus || 0;

      // DMG_UP 스택: 스택당 +10% 피해
      const dmgUpStack = sourceCard.getStack(STACK.DMG_UP);
      if (dmgUpStack > 0) {
        amount *= (1 + dmgUpStack * 0.1);
        sourceCard.setStack(STACK.DMG_UP, 0); // 공격 시전 후 소실
      }

      // [활시위 당기기] 다음 주는 피해 +50%
      if (sourceCard.hasStatus(STATUS.NEXT_DMG_BOOST_50)) {
        amount = Math.floor(amount * 1.5);
        sourceCard.removeStatus(STATUS.NEXT_DMG_BOOST_50);
        this.pushEvent('log', { message: `🏹 ${sourceCard.name}의 [활시위 당기기]로 피해가 50% 증가했습니다!` });
      }

      // [선택 받은 용사] 주는 피해 +30
      if (sourceCard.hasStatus(STATUS.CHOSEN_HERO)) {
        amount += 30;
      }

      // 부착 아이템: 학습력 - 주는 피해 +10
      for (const item of sourceCard.attachedItems || []) {
        if (item.defId === 'item_hakseupryeok') amount += 10;
      }
      if (sourceCard.hasStatus(STATUS.HALVE_NEXT_DAMAGE_DEALT)) {
        amount = Math.floor(amount / 2);
        sourceCard.removeStatus(STATUS.HALVE_NEXT_DAMAGE_DEALT);
        this.pushEvent('log', { message: `${sourceCard.name}의 공격이 약화되어 있습니다.` });
      }
      // 기사도 정신 / 내겐 고통 밖에 없습니다: 몹 1장이거나 [믿을 만한 동료] 보유 시 주는 피해 2배
      const isChivalryAttacker = sourceCard.def.trait && (sourceCard.def.trait.id === 'chivalry' || sourceCard.def.trait.id === 'only_pain');
      if (isChivalryAttacker && (sourcePlayer.fieldMobs().length === 1 || sourceCard.hasStatus(STATUS.TRUSTED_COMRADE))) {
        amount *= 2;
      }
    }

    // 방어자 보정
    // DMG_DOWN 스택: 스택당 -10% 피해 감소
    const dmgDownStack = targetCard.getStack(STACK.DMG_DOWN);
    if (dmgDownStack > 0) {
      amount *= (1 - Math.min(1.0, dmgDownStack * 0.1));
      targetCard.setStack(STACK.DMG_DOWN, 0); // 피격 적용 후 소실
    }

    // 부착 아이템: 인내력 - 받는 피해 -15
    for (const item of targetCard.attachedItems || []) {
      if (item.defId === 'item_innaeryeok') amount -= 15;
    }
    // 하이퍼포커스: 다음 받는 피해 절반
    if (targetCard.hasStatus(STATUS.HALVE_NEXT_DAMAGE_TAKEN)) {
      amount = Math.floor(amount / 2);
      targetCard.removeStatus(STATUS.HALVE_NEXT_DAMAGE_TAKEN);
    }
    // 태권도 노란띠: 받는 피해 -50%
    if (targetCard.def.trait && targetCard.def.trait.id === 'yellow_belt') {
      amount = Math.floor(amount * 0.5);
    }
    // 기사도 정신 / 내겐 고통 밖에 없습니다: 몹 1장이거나 [믿을 만한 동료] 보유 시 받는 피해 절반
    const isChivalryDefender = targetCard.def.trait && (targetCard.def.trait.id === 'chivalry' || targetCard.def.trait.id === 'only_pain');
    if (isChivalryDefender && (targetPlayer.fieldMobs().length === 1 || targetCard.hasStatus(STATUS.TRUSTED_COMRADE))) {
      amount = Math.floor(amount * 0.5);
    }
    // 메카: 중국산 베터리 - 과충전 스택당 받는 피해 +10
    if (targetCard.def.trait && targetCard.def.trait.id === 'china_battery') {
      amount += targetCard.getStack(STACK.OVERCHARGE) * 10;
    }

    amount = Math.max(0, Math.round(amount));

    // 보호막(SHIELD) 감면 파이프라인
    const shieldStack = targetCard.getStack(STACK.SHIELD);
    if (shieldStack > 0 && amount > 0) {
      if (amount <= shieldStack) {
        const remainingShield = shieldStack - amount;
        targetCard.setStack(STACK.SHIELD, remainingShield);
        this.pushEvent('log', { message: `🛡️ ${targetCard.name}의 보호막이 ${amount} 피해를 모두 흡수했습니다. (남은 보호막: ${remainingShield})` });
        amount = 0;
      } else {
        const absorbed = shieldStack;
        amount -= absorbed;
        targetCard.setStack(STACK.SHIELD, 0);
        this.pushEvent('log', { message: `🛡️ ${targetCard.name}의 보호막이 ${absorbed} 피해를 흡수하고 소실되었습니다.` });
      }
    }

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

    // 생명흡수 트레잇 (연기력 50% 버프 / 내겐 고통 밖에 없습니다 50% / 아침 시간에 자습하자니까 30%)
    if (sourceCard && sourceCard.def.trait) {
      const tid = sourceCard.def.trait.id;
      if (tid === 'acting' || tid === 'only_pain') {
        const healAmount = Math.floor(amount * 0.5);
        if (healAmount > 0) this.heal(sourceCard, healAmount);
      } else if (tid === 'self_study') {
        const healAmount = Math.floor(amount * 0.3);
        if (healAmount > 0) this.heal(sourceCard, healAmount);
      }
    }

    // 과열된 연료 보유 카드: 데미지 시 대상에게 [화상] 부여
    if (sourceCard && sourceCard.getStack && sourceCard.getStack(STACK.HOT_FUEL) > 0 && targetCard.alive) {
      if (!targetCard.hasStatus(STATUS.BURN)) {
        targetCard.addStatus(STATUS.BURN, {});
        this.pushEvent('log', { message: `${targetCard.name}이(가) [화상]에 걸렸습니다!` });
      }
    }

    return amount;
  }

  _applyHp(player, card, amount) {
    if (!card || !card.alive) return;

    // 1. [탈모 전장연] - [미련없는 인생]: [탈모] 부여 상태 시 치명상 피해를 받아도 HP 1 고정 & 특수 스킬 [임종] 광역 400 시전 후 사망
    if (card.defId === 'card_talmo' && card.hasStatus(STATUS.TALMO) && !card.flags.imjongTriggered) {
      if (card.hp - amount <= 0) {
        card.hp = 1;
        card.flags.imjongTriggered = true;
        card.removeStatus(STATUS.TALMO);
        this.pushEvent('damage', { instanceId: card.instanceId, amount, hpAfter: 1 });
        this.pushEvent('log', {
          message: `💥 [탈모 전장연] 특성 [미련없는 인생] 발동! HP가 1로 고정되고 특수 스킬 [임종]이 발동됩니다!`,
        });
        const opponent = this.getOpponent(player);
        this.pushEvent('skillCast', {
          sourceCardId: card.instanceId,
          sourceCardName: card.name,
          targetCardId: null,
          targetCardName: '상대 필드 전원',
          skillId: 'imjong',
          skillName: '임종',
          defId: 'card_talmo',
          motion: 'imjong_blast',
          isAoE: true,
        });
        this.dealDamageAll({ sourcePlayer: player, sourceCard: card, targetPlayer: opponent, baseAmount: 400 });
        card.hp = 0;
        card.alive = false;
        this.checkDeath(card);
        return;
      }
    }

    // 2. [마지막 불씨]: 치명상을 입어도 HP 1로 생존, 다음 턴 [마지막 발악] 준비
    const lastEmberStack = (card.getStack && card.getStack(STACK.LAST_EMBER)) || (card.flags && card.flags.lastEmber ? 1 : 0);
    if (lastEmberStack > 0 && (card.hp - amount <= 0) && !card.flags.pendingLastStruggle) {
      card.hp = 1;
      if (card.setStack) card.setStack(STACK.LAST_EMBER, 0);
      if (card.flags) {
        card.flags.lastEmber = 0;
        card.flags.pendingLastStruggle = true;
      }
      this.pushEvent('damage', { instanceId: card.instanceId, amount, hpAfter: 1 });
      this.pushEvent('log', {
        message: `🔥 [${card.name}]이(가) [마지막 불씨] 효과로 쓰러지지 않고 HP 1로 버텨냈습니다! 다음 턴 [마지막 발악]이 발동됩니다.`,
      });
      return;
    }

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
          this._updatePartyPassives(player);
        }
      }
      this.checkWin();
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

    // 수면 판정: 잠들어 있는 카드는 동전 던져서 앞면이면 깨어나서 스킬 시전, 뒷면이면 수면 유지 및 턴 종료!
    if (card.hasStatus(STATUS.SLEEP)) {
      const awake = this.coinFlip(`${card.name} 잠듦 해제 판정`);
      if (awake) {
        card.removeStatus(STATUS.SLEEP);
        this.pushEvent('log', { message: `✨ ${card.name}이(가) 잠에서 깨어났습니다!` });
      } else {
        this.pushEvent('log', { message: `💤 ${card.name}은(는) 여전히 깊은 잠에 빠져 있어 스킬을 시전하지 못했습니다.` });
        this.endTurn();
        return { ok: true, events: this.flushEvents() };
      }
    }

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

    // 스킬 targetType 검증
    const skillDef = card.def.skills ? card.def.skills.find(s => s.id === skillId) : null;
    if (skillDef && skillDef.targetType === 'passive') {
      return { ok: false, error: '패시브 스킬은 직접 사용할 수 없습니다.' };
    }
    if (skillDef && skillDef.targetType === 'enemy') {
      if (targetInfo && targetInfo.owner === 'self') {
        return { ok: false, error: '공격 스킬은 상대 카드만 대상으로 지정할 수 있습니다.' };
      }
    }

    let target = this._resolveTarget(player, opponent, targetInfo);

    // 상대 1명 대상 공격 스킬인데 타겟이 없는 경우, 상대 필드에 몹이 1마리뿐이면 자동 지정
    if (skillDef && skillDef.targetType === 'enemy' && !target) {
      const oppMobs = opponent.fieldMobs();
      if (oppMobs.length === 1) {
        target = oppMobs[0];
      } else if (oppMobs.length > 1) {
        return { ok: false, error: '공격할 상대 카드를 지정해주세요.' };
      }
    }

    // 인면어 회피 판정: 대상이 인면어이고 공격 스킬일 경우 동전 던져서 앞면이면 무효
    if (target && target.defId === 'card_inmyeoneo' && target.alive) {
      const heads = this.coinFlip(`${target.name} 회피 판정`);
      if (heads) {
        this.pushEvent('log', { message: `${target.name}이(가) 공격을 회피했습니다!` });
        card.flags.lastSkillUsedPrev = card.flags.lastSkillUsed;
        card.flags.lastSkillUsed = skillId;
        this.endTurn();
        return { ok: true, events: this.flushEvents() };
      }
    }

    // 스킬 시전 애니메이션 이벤트 발행 (양측 동기화)
    this.pushEvent('skillCast', {
      sourceCardId: card.instanceId,
      sourceCardName: card.name,
      targetCardId: target ? target.instanceId : null,
      targetCardName: target ? target.name : null,
      skillId,
      skillName: skillDef ? skillDef.name : skillId,
      defId: card.defId,
      motion: skillDef ? (skillDef.motion || 'slash') : 'slash',
      targetType: skillDef ? skillDef.targetType : 'none',
      isAoE: (skillId === 's1' && ['card_garados', 'card_gakseong'].includes(card.defId)) || (skillId === 's2' && card.defId === 'card_jaeonjaehae'),
    });

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
    if (this.phase === PHASE.BATTLE && player !== this.currentPlayer()) {
      return { ok: false, error: '당신의 턴이 아닙니다.' };
    }
    const card = player.findInHand(handInstanceId);
    if (!card || card.type !== 'mob') return { ok: false, error: '몹 카드가 아닙니다.' };

    // 희로애락 4장 합체 소환 가능 판정 (필드 3장 + 손패 4번째 1장)
    if (this._canAwakenHuiRoAeRak(player, card)) {
      return this._executeHuiRoAeRakAwaken(player, card);
    }

    if (slot < 0 || slot > 2 || player.field[slot]) return { ok: false, error: '해당 슬롯에 배치할 수 없습니다.' };

    // 진화 카드는 직접 배치 불가 — 반드시 evolveCard로만 필드에 나올 수 있음
    if (card.def.evolvesFrom) {
      return { ok: false, error: `[${card.name}]은(는) 직접 배치할 수 없습니다. 진화 특성 카드입니다.` };
    }

    player.removeFromHand(handInstanceId);
    player.field[slot] = card;
    this.pushEvent('log', { message: `${player.nickname}이(가) ${card.name}을(를) 필드에 배치했습니다.` });
    this._updatePartyPassives(player);
    return { ok: true, events: this.flushEvents() };
  }

  _updatePartyPassives(player) {
    if (!player) return;
    const fieldMobs = player.fieldMobs();
    const hasMage = fieldMobs.some(c => c.defId === 'card_mage');
    const hasCleric = fieldMobs.some(c => c.defId === 'card_cleric');
    const hasArcher = fieldMobs.some(c => c.defId === 'card_archer');

    for (const mob of fieldMobs) {
      if (mob.defId === 'card_gisa') {
        if (hasMage && !mob.hasStatus(STATUS.ISEKAI_HERO)) {
          mob.addStatus(STATUS.ISEKAI_HERO, {});
          this.pushEvent('log', { message: `🧙‍♂️ [마법사 전장연] 패시브: [기사 전장연]에게 [이세계 용사] 상태를 부여했습니다.` });
        }
        if (hasCleric && !mob.hasStatus(STATUS.CHOSEN_HERO)) {
          mob.addStatus(STATUS.CHOSEN_HERO, {});
          mob.maxHp = 523;
          mob.hp = Math.max(mob.hp, 523);
          this.pushEvent('log', { message: `✨ [성직자 전장연] 패시브: [기사 전장연]에게 [선택 받은 용사]를 부여했습니다. (최대 HP 523 조정, 주는 피해 +30)` });
        }
        if (hasArcher && !mob.hasStatus(STATUS.TRUSTED_COMRADE)) {
          mob.addStatus(STATUS.TRUSTED_COMRADE, {});
          this.pushEvent('log', { message: `🏹 [궁수 전장연] 패시브: [기사 전장연]에게 [믿을 만한 동료]를 부여했습니다. (기사도 정신 상시 발동)` });
        }
      }
    }

    this._checkCorruptedHeroEvolution(player);
  }

  _checkCorruptedHeroEvolution(player) {
    if (!player) return false;
    const gisa = player.fieldMobs().find(c => c.defId === 'card_gisa' && c.hasStatus(STATUS.ISEKAI_HERO));
    if (!gisa) return false;

    const partyDefIds = ['card_archer', 'card_cleric', 'card_mage'];
    const trashDefIds = player.trash.map(c => c.defId);
    const allInTrash = partyDefIds.every(id => trashDefIds.includes(id));
    if (!allInTrash) return false;

    const inHand = player.hand.some(c => partyDefIds.includes(c.defId));
    const inDeck = player.deck.some(c => partyDefIds.includes(c.defId));
    if (inHand || inDeck) return false;

    const def = ALL_DEFS['card_corrupted_hero'];
    if (!def) return false;

    gisa.defId = def.id;
    gisa.def = def;
    gisa.name = def.name;
    gisa.maxHp = 523;
    gisa.hp = 523;
    gisa.addStack(STACK.LAST_EMBER, 1);
    gisa.flags.lastEmber = 1;
    gisa.addStatus(STATUS.TRUSTED_COMRADE, {});

    this.pushEvent('specialEvolution', {
      instanceId: gisa.instanceId,
      name: gisa.name,
      kind: 'corrupted_hero_summon',
      videoUrl: '/image/dark_knight_spowon.mp4',
    });
    this.pushEvent('log', {
      message: `💀 모든 동료를 잃은 [기사 전장연]이 분노하여 [모든 것을 잃어 타락해버린 이세계 용사 전장연]으로 각성 진화했습니다! (HP: 523, [마지막 불씨] 1스택 획득)`,
    });
    return true;
  }

  _canAwakenHuiRoAeRak(player, handCard) {
    if (!handCard || handCard.type !== 'mob') return false;
    const componentIds = ['card_hui', 'card_ro', 'card_ae', 'card_rak'];
    if (!componentIds.includes(handCard.defId)) return false;

    const fieldMobs = player.fieldMobs();
    if (fieldMobs.length !== 3) return false;

    const presentComponents = new Set();
    for (const mob of fieldMobs) {
      if (componentIds.includes(mob.defId)) {
        presentComponents.add(mob.defId);
      }
    }

    return presentComponents.size === 3 && !presentComponents.has(handCard.defId);
  }

  _executeHuiRoAeRakAwaken(player, handCard) {
    const fieldMobs = player.fieldMobs();

    // 1. 손패의 4번째 희로애락 재료 카드 제거 후 트레쉬로
    player.removeFromHand(handCard.instanceId);
    player.trash.push(handCard);

    // 2. 필드의 3장 카드의 부착 아이템 및 카드 모두 제거 후 트레쉬로
    for (const mob of fieldMobs) {
      for (const item of mob.attachedItems || []) {
        player.trash.push(item);
      }
      mob.attachedItems = [];
      player.trash.push(mob);
    }
    player.field = [null, null, null];

    // 3. 희로애락(喜怒哀樂) 소환 (중앙 슬롯 1)
    const huiroaerakDef = ALL_DEFS['card_huiroaerak'];
    const huiroaerakCard = new CardInstance(huiroaerakDef);
    player.field[1] = huiroaerakCard;

    this.pushEvent('specialEvolution', {
      instanceId: huiroaerakCard.instanceId,
      name: huiroaerakCard.name,
      kind: 'huiroaerak_awaken',
    });
    this.pushEvent('log', {
      message: `✨ 아군의 [희(喜), 로(怒), 애(哀), 락(樂)] 4가지 기운이 모두 모여 [희로애락(喜怒哀樂)]으로 합체 강림 소환되었습니다! (총 4장 희생, HP: ${huiroaerakCard.hp})`,
    });

    return { ok: true, events: this.flushEvents() };
  }

  awakenHuiRoAeRak(player, handInstanceId) {
    if (this.phase === PHASE.BATTLE && player !== this.currentPlayer()) {
      return { ok: false, error: '당신의 턴이 아닙니다.' };
    }
    const handCard = player.findInHand(handInstanceId);
    if (!handCard) return { ok: false, error: '카드를 찾을 수 없습니다.' };
    if (!this._canAwakenHuiRoAeRak(player, handCard)) {
      return { ok: false, error: '희, 로, 애, 락 4가지 서로 다른 기운이 필드 3장 + 손패 1장에 모두 모여야 소환할 수 있습니다.' };
    }
    return this._executeHuiRoAeRakAwaken(player, handCard);
  }

  returnFieldCardToHand(player, instanceId) {
    const card = player.removeFromField(instanceId);
    if (!card) return { ok: false, error: '카드를 찾을 수 없습니다.' };
    
    // 💡 [버그 수정] 4조 C 나와 카드로 몹 회수 시 부착 아이템도 카드에 그대로 보존하여 회수!
    // (다시 필드에 배치하였을 때 회수 전 부착한 아이템이 유지됨)
    player.hand.push(card);
    this.pushEvent('log', { message: `📦 [${card.name}]이(가) 부착된 아이템과 함께 손패로 회수되었습니다.` });
    return { ok: true, events: this.flushEvents() };
  }

  attachItem(player, handInstanceId, targetOwner, targetInstanceId) {
    if (this.phase !== PHASE.BATTLE) return { ok: false, error: '전투 페이즈가 아닙니다.' };
    if (player !== this.currentPlayer()) return { ok: false, error: '당신의 턴이 아닙니다.' };

    const item = player.findInHand(handInstanceId);
    if (!item || item.type !== 'item_attach') return { ok: false, error: '부착형 아이템이 아닙니다.' };

    if (player.usedItemDefsThisTurn && player.usedItemDefsThisTurn.includes(item.defId)) {
      return { ok: false, error: `[${item.name}]은(는) 이번 턴에 이미 사용하셨습니다. (같은 종류의 아이템은 턴당 1회만 사용 가능)` };
    }

    const targetPlayer = targetOwner === 'self' ? player : this.getOpponent(player);
    const target = targetPlayer.findOnField(targetInstanceId);
    if (!target) return { ok: false, error: '대상 카드를 찾을 수 없습니다.' };

    // 같은 종류의 아이템 중복 부착 방지
    const alreadyAttached = target.attachedItems.some(a => a.defId === item.defId);
    if (alreadyAttached) return { ok: false, error: `이미 [${item.name}]이(가) 장착되어 있습니다.` };

    player.removeFromHand(handInstanceId);
    target.attachedItems.push(item);
    if (!player.usedItemDefsThisTurn) player.usedItemDefsThisTurn = [];
    player.usedItemDefsThisTurn.push(item.defId);

    this.pushEvent('itemUsed', {
      userSocketId: player.socketId,
      userNickname: player.nickname,
      itemDefId: item.defId,
      itemName: item.name,
      itemDesc: item.def.desc || item.desc || '',
      itemImage: item.def.image,
      itemType: item.type,
      targetInstanceId: target.instanceId,
      targetName: target.name,
    });
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
    if (this.phase !== PHASE.BATTLE) return { ok: false, error: '전투 페이즈가 아닙니다.' };
    if (player !== this.currentPlayer()) return { ok: false, error: '당신의 턴이 아닙니다.' };

    const evoCard = player.findInHand(handInstanceId);
    if (!evoCard) return { ok: false, error: '카드를 찾을 수 없습니다.' };
    const base = player.findOnField(targetFieldInstanceId);
    if (!base) return { ok: false, error: '진화 대상을 찾을 수 없습니다.' };
    if (evoCard.def.evolvesFrom !== base.defId) return { ok: false, error: '진화 조건이 맞지 않습니다.' };

    // 진화 조건: 2턴 이상 필드에 있어야 함
    if ((base.turnsOnField || 0) < 2) {
      return { ok: false, error: `[${base.name}]을(를) 배치한 다음 2턴이 지난 후부터 진화할 수 있습니다. (현재 ${base.turnsOnField || 0}/2턴 경과)` };
    }

    player.removeFromHand(handInstanceId);
    const slot = player.fieldSlotOf(base.instanceId);
    const hpRatio = base.hp / base.maxHp;
    evoCard.hp = Math.round(evoCard.maxHp * hpRatio) || evoCard.maxHp;
    evoCard.attachedItems = base.attachedItems;
    evoCard.turnsOnField = base.turnsOnField; // 진화 후에도 필드 경과 턴 유지
    player.field[slot] = evoCard;
    player.trash.push(base);

    this.pushEvent('specialEvolution', { instanceId: evoCard.instanceId, name: evoCard.name, kind: 'garados_evolve' });
    this.pushEvent('log', { message: `🌊 ${base.name}이(가) ${evoCard.name}(으)로 진화했습니다!` });
    return { ok: true, events: this.flushEvents() };
  }

  useConsumable(player, handInstanceId, payload) {
    if (this.phase !== PHASE.BATTLE) return { ok: false, error: '전투 페이즈가 아닙니다.' };
    if (player !== this.currentPlayer()) return { ok: false, error: '당신의 턴이 아닙니다.' };

    const item = player.findInHand(handInstanceId);
    if (!item || item.type !== 'item_consume') return { ok: false, error: '소모형 아이템이 아닙니다.' };

    if (player.usedItemDefsThisTurn && player.usedItemDefsThisTurn.includes(item.defId)) {
      return { ok: false, error: `[${item.name}]은(는) 이번 턴에 이미 사용하셨습니다. (같은 종류의 아이템은 턴당 1회만 사용 가능)` };
    }

    const opponent = this.getOpponent(player);
    const targetCard = payload && payload.targetInstanceId
      ? (payload.targetOwner === 'self' ? player : opponent).findOnField(payload.targetInstanceId)
      : null;

    // 아이템 연출 팝업을 효과 발동(동전 모션 등) 전에 먼저 발행
    this.pushEvent('itemUsed', {
      userSocketId: player.socketId,
      userNickname: player.nickname,
      itemDefId: item.defId,
      itemName: item.name,
      itemDesc: item.def.desc || item.desc || '',
      itemImage: item.def.image,
      itemType: item.type,
      targetInstanceId: targetCard ? targetCard.instanceId : null,
      targetName: targetCard ? targetCard.name : null,
    });

    const result = require('./skills').consumables[item.defId]?.({ room: this, player, opponent, payload });
    if (result && result.error) return { ok: false, error: result.error };

    player.removeFromHand(handInstanceId);
    player.trash.push(item);
    if (!player.usedItemDefsThisTurn) player.usedItemDefsThisTurn = [];
    player.usedItemDefsThisTurn.push(item.defId);

    this.checkWin();
    return { ok: true, events: this.flushEvents() };
  }

  _executePredation(player, card, target) {
    for (const item of target.attachedItems || []) {
      player.trash.push(item);
    }
    target.attachedItems = [];
    player.removeFromField(target.instanceId);
    player.trash.push(target);
    this.heal(card, 100);
    this.pushEvent('log', { message: `💀 ${card.name}이(가) 특성 [포식]으로 아군 ${target.name}을(를) 자동 포식하고 HP 100을 회복했습니다!` });
    this.checkWin();
  }

  usePredation(player, cardInstanceId, sacrificeInstanceId) {
    return { ok: false, error: '포식은 턴 시작 시 자동으로 발동합니다.' };
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
      image: card.def.image || null,
    };
    if (card.type === 'mob') {
      return {
        ...base,
        hp: card.hp,
        maxHp: card.maxHp,
        alive: card.alive !== false && card.hp > 0,
        trait: card.def.trait,
        skills: card.def.skills,
        statuses: card.statuses,
        stacks: card.stacks,
        attachedItems: card.attachedItems.map((i) => ({ instanceId: i.instanceId, defId: i.defId, name: i.name, desc: i.def.desc })),
        permanentDamageBonus: card.permanentDamageBonus,
        flags: { solarBeamPending: card.flags.solarBeamPending, skillLockTurns: card.flags.skillLockTurns },
        blocked: this.isCardActionBlocked(card.instanceId),
        turnsOnField: card.turnsOnField || 0,
        evolvesFrom: card.def.evolvesFrom || null,
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
