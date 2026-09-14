const { STATUS, STACK, MAX_OVERCHARGE, FIELD_KEYWORD } = require('./constants');

/** 전기장 적용해서 과충전 스택 부여 (전기장 있으면 획득량 *2) */
function addOverchargeWithField(room, player, card, amount) {
  const mult = player.fieldKeyword === FIELD_KEYWORD.ELECTRIC_FIELD ? 2 : 1;
  const gained = amount * mult;
  const before = card.getStack(STACK.OVERCHARGE);
  card.addStack(STACK.OVERCHARGE, gained, MAX_OVERCHARGE);
  const after = card.getStack(STACK.OVERCHARGE);
  if (after !== before) {
    room.pushEvent('stackGain', { instanceId: card.instanceId, stack: STACK.OVERCHARGE, value: after });
  }
}

/**
 * 특정 플레이어의 턴 시작 시 필드 위 모든 카드에 대해 처리해야 하는 것들:
 * - 화상 데미지 틱 + 제거 판정
 * - 수면 상태 소모
 * - 각 카드의 trait(패시브) 턴 시작 효과
 * - 종바라기 솔라빔 준비 카운트다운 및 발동
 * 반환: { blockedActions: Set<instanceId> } 이번 턴 스킬 사용 불가 카드 목록
 */
function onTurnStart(room, player, opponent) {
  const blocked = new Set();

  for (const card of player.fieldMobs()) {
    // 화상 틱
    if (card.hasStatus(STATUS.BURN)) {
      applyRawDamage(room, card, 20, 'burn');
      const heads = room.coinFlip('화상 제거 판정');
      if (heads) {
        card.removeStatus(STATUS.BURN);
        room.pushEvent('log', { message: `${card.name}의 [화상]이 사라졌습니다.` });
      }
    }

    // 수면 상태: 이번 턴 스킬 사용 불가, 소모 후 해제
    if (card.hasStatus(STATUS.SLEEP)) {
      blocked.add(card.instanceId);
      card.removeStatus(STATUS.SLEEP);
      room.pushEvent('log', { message: `${card.name}은(는) 잠들어 있어 행동할 수 없습니다.` });
    }

    // 트레잇: 전기쥐 (종연츄) - 자신 & 양옆 아군에게 과충전 1스택
    if (card.def.trait && card.def.trait.id === 'electric_rat') {
      const targets = [card, ...player.neighborsOf(card.instanceId)];
      for (const t of targets) addOverchargeWithField(room, player, t, 1);
    }

    // 트레잇: 베스트 드라이버 (폭주족) - 자신에게 과열된 연료 1스택
    if (card.def.trait && card.def.trait.id === 'best_driver') {
      card.addStack(STACK.HOT_FUEL, 1);
      room.pushEvent('stackGain', { instanceId: card.instanceId, stack: STACK.HOT_FUEL, value: card.getStack(STACK.HOT_FUEL) });
    }

    // 트레잇: 광합성 (종바라기)
    if (card.def.trait && card.def.trait.id === 'photosynthesis') {
      const healAmount = 50 + card.flags.photosynthesisBoost;
      card.maxHp += 10;
      room.heal(card, healAmount, { silent: false });
      card.flags.photosynthesisBoost += 10;
    }

    // 종바라기 솔라빔 준비 카운트다운
    if (card.flags.solarBeamPending) {
      blocked.add(card.instanceId);
      card.flags.skillLockTurns -= 1;
      room.pushEvent('log', { message: `${card.name}이(가) 빛을 모으고 있습니다... (남은 턴: ${card.flags.skillLockTurns})` });
      if (card.flags.skillLockTurns <= 0) {
        card.flags.solarBeamPending = false;
        fireSolarBeam(room, player, opponent, card);
        blocked.delete(card.instanceId); // 솔라빔 발동 후 이번 턴은 다시 행동 가능
      }
    }
  }

  return blocked;
}

function fireSolarBeam(room, player, opponent, sourceCard) {
  const enemies = opponent.fieldMobs();
  if (enemies.length === 0) return;
  let lowest = enemies[0];
  for (const e of enemies) if (e.hp < lowest.hp) lowest = e;
  room.pushEvent('log', { message: `${sourceCard.name}의 [솔라빔]이 ${lowest.name}에게 작렬합니다!` });
  room.dealDamage({
    sourcePlayer: player,
    sourceCard,
    targetPlayer: opponent,
    targetCard: lowest,
    baseAmount: 300,
    skipSourceBonuses: true, // 특수 스킬은 영구 강화 등 일반 보정 제외
  });
}

/** 방어 계산 없이 순수 고정 피해 (화상 틱 등) */
function applyRawDamage(room, card, amount, reason) {
  card.hp = Math.max(0, card.hp - amount);
  room.pushEvent('damage', { instanceId: card.instanceId, amount, hpAfter: card.hp, reason });
  room.checkDeath(card);
}

/** 혼란 판정: 공격 스킬 사용 시 호출. true 반환 시 스킬 취소(자해 발생) */
function checkConfusion(room, card) {
  if (!card.hasStatus(STATUS.CONFUSION)) return { cancelled: false };
  const heads = room.coinFlip(`${card.name} [혼란] 판정`);
  if (heads) {
    card.removeStatus(STATUS.CONFUSION);
    room.pushEvent('log', { message: `${card.name}의 [혼란]이 풀렸습니다.` });
    return { cancelled: false };
  }
  applyRawDamage(room, card, 20, 'confusion_selfhit');
  room.pushEvent('log', { message: `${card.name}이(가) [혼란]으로 인해 스킬을 실패하고 20 피해를 입었습니다.` });
  return { cancelled: true };
}

module.exports = { addOverchargeWithField, onTurnStart, applyRawDamage, checkConfusion, fireSolarBeam };
