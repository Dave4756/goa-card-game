const { STATUS, STACK, MAX_DMG_STACK, FIELD_KEYWORD } = require('./constants');
const { addOverchargeWithField } = require('./keywordHandler');

/** ctx = { room, player, opponent, card, target, targetInfo } */
const skillHandlers = {
  card_jeonjangyeon: {
    s1: ({ room, player, opponent, card, target }) => {
      room.dealDamage({ sourcePlayer: player, sourceCard: card, targetPlayer: opponent, targetCard: target, baseAmount: 40 });
    },
    s2: ({ room, card }) => {
      room.heal(card, 40);
    },
  },

  card_inmyeoneo: {
    s1: ({ room, player, opponent, card, target }) => {
      room.dealDamage({ sourcePlayer: player, sourceCard: card, targetPlayer: opponent, targetCard: target, baseAmount: 10 });
    },
    // s2 '회피'는 능동 스킬이 아니라 피격 시 자동 발동하는 반응형 방어이므로
    // dealDamage 파이프라인이 아니라 useSkill 이전 단계(별도 훅)에서 처리해야 함.
    // 확장 시 GameRoom.useSkill의 상대 공격 처리부에서 card_inmyeoneo 여부를 확인해 코인플립을 추가하세요.
  },

  card_garados: {
    s1: ({ room, player, opponent, card }) => {
      room.dealDamageAll({ sourcePlayer: player, sourceCard: card, targetPlayer: opponent, baseAmount: 50 });
    },
    s2: ({ room, player, opponent, card, target }) => {
      room.dealDamage({ sourcePlayer: player, sourceCard: card, targetPlayer: opponent, targetCard: target, baseAmount: 200 });
    },
  },

  card_jammanbo: {
    s1: ({ room, player, opponent, card, target }) => {
      room.dealDamage({ sourcePlayer: player, sourceCard: card, targetPlayer: opponent, targetCard: target, baseAmount: 60 });
    },
    s2: ({ room, target }) => {
      if (!target) return;
      target.addStatus(STATUS.SLEEP, { turnsLeft: 1 });
      room.pushEvent('log', { message: `${target.name}이(가) 잠들었습니다.` });
    },
  },

  card_meka: {
    s1: ({ room, player, card }) => {
      addOverchargeWithField(room, player, card, 1);
    },
    s2: ({ room, player, opponent, card, target }) => {
      const dmg = 80 + card.getStack(STACK.OVERCHARGE) * 40;
      room.dealDamage({ sourcePlayer: player, sourceCard: card, targetPlayer: opponent, targetCard: target, baseAmount: dmg });
    },
  },

  card_heoreonaerin: {
    s1: ({ room, target }) => {
      if (!target) return;
      const heads = room.coinFlip('넌 탈모 안걸릴거 같지?');
      if (heads) {
        target.addStatus(STATUS.CONFUSION, {});
        room.pushEvent('log', { message: `${target.name}이(가) [혼란]에 걸렸습니다.` });
      }
    },
    s2: ({ room, player, opponent, card, target }) => {
      room.dealDamage({ sourcePlayer: player, sourceCard: card, targetPlayer: opponent, targetCard: target, baseAmount: 40 });
    },
  },

  card_jongyeonchu: {
    s1: ({ room, player }) => {
      player.fieldKeyword = FIELD_KEYWORD.ELECTRIC_FIELD;
      room.pushEvent('fieldKeyword', { owner: player.nickname, keyword: FIELD_KEYWORD.ELECTRIC_FIELD });
      room.pushEvent('log', { message: `${player.nickname}의 필드에 [전기장]이 설치되었습니다.` });
    },
    s2: ({ room, player, opponent, card, target }) => {
      const totalOvercharge = player.fieldMobs().reduce((sum, c) => sum + c.getStack(STACK.OVERCHARGE), 0);
      let bonus = totalOvercharge * 20;
      if (player.fieldKeyword === FIELD_KEYWORD.ELECTRIC_FIELD) bonus *= 2;
      room.dealDamage({ sourcePlayer: player, sourceCard: card, targetPlayer: opponent, targetCard: target, baseAmount: 60 + bonus });
    },
  },

  card_pokjujok: {
    s1: ({ room, player, opponent, card, target }) => {
      room.dealDamage({ sourcePlayer: player, sourceCard: card, targetPlayer: opponent, targetCard: target, baseAmount: 30 });
      card.permanentDamageBonus += 40;
      const healAmount = Math.min(150, card.getStack(STACK.HOT_FUEL) * 15);
      room.heal(card, healAmount);
    },
    s2: ({ room, player, opponent, card, target }) => {
      const dmg = 60 + card.getStack(STACK.HOT_FUEL) * 20;
      room.dealDamage({ sourcePlayer: player, sourceCard: card, targetPlayer: opponent, targetCard: target, baseAmount: dmg });
    },
  },

  card_saurus: {
    s1: ({ room, player, opponent, card, target }) => {
      room.dealDamage({ sourcePlayer: player, sourceCard: card, targetPlayer: opponent, targetCard: target, baseAmount: 20 });
      if (target) {
        target.addStatus(STATUS.HALVE_NEXT_DAMAGE_DEALT, {});
        room.pushEvent('log', { message: `${target.name}의 다음 공격이 약화됩니다.` });
      }
    },
    s2: ({ room, player, opponent, card, target }) => {
      room.dealDamage({ sourcePlayer: player, sourceCard: card, targetPlayer: opponent, targetCard: target, baseAmount: 100 });
    },
  },

  card_jongbaragi: {
    s1: ({ room, player, opponent, card, target }) => {
      room.dealDamage({ sourcePlayer: player, sourceCard: card, targetPlayer: opponent, targetCard: target, baseAmount: 30 });
    },
    s2: ({ room, card }) => {
      card.flags.solarBeamPending = true;
      card.flags.skillLockTurns = 2;
      room.pushEvent('log', { message: `${card.name}이(가) [솔라빔]을 준비합니다.` });
    },
  },

  card_gisa: {
    s1: ({ room, player, opponent, card, target }) => {
      room.dealDamage({ sourcePlayer: player, sourceCard: card, targetPlayer: opponent, targetCard: target, baseAmount: 60 });
    },
  },

  card_gakseong: {
    s1: ({ room, player, opponent, card }) => {
      room.dealDamageAll({ sourcePlayer: player, sourceCard: card, targetPlayer: opponent, baseAmount: 60 });
    },
    s2: ({ room, player, opponent, card, target }) => {
      room.dealDamage({ sourcePlayer: player, sourceCard: card, targetPlayer: opponent, targetCard: target, baseAmount: 180 });
    },
  },

  card_jaeonjaehae: {
    s1: ({ room, player, opponent, card, target }) => {
      room.dealDamage({ sourcePlayer: player, sourceCard: card, targetPlayer: opponent, targetCard: target, baseAmount: 200 });
    },
    s2: ({ room, card }) => {
      room.dealPermanentDamageAll(50);
      room.globalNoHealExceptCardId = card.instanceId;
      room.pushEvent('log', { message: `${card.name} 외의 모든 카드는 더 이상 회복할 수 없습니다.` });
    },
  },

  card_running_man: {
    s1: ({ room, player, opponent, card, target }) => {
      const bonus = card.flags.lastSkillUsed === 's1' ? 40 : 0;
      room.dealDamage({ sourcePlayer: player, sourceCard: card, targetPlayer: opponent, targetCard: target, baseAmount: 20 + bonus });
    },
    s2: ({ room, card }) => {
      const bonus = card.flags.lastSkillUsed === 's2' ? 40 : 0;
      room.heal(card, 50 + bonus);
    },
  },

  card_taekwondo: {
    s1: ({ room, player, opponent, card, target }) => {
      room.dealDamage({ sourcePlayer: player, sourceCard: card, targetPlayer: opponent, targetCard: target, baseAmount: 30 });
    },
    s2: ({ room, player, opponent, card, target }) => {
      room.dealDamage({ sourcePlayer: player, sourceCard: card, targetPlayer: opponent, targetCard: target, baseAmount: 80 });
      const heads = room.coinFlip('뒤돌려차기 반동 판정');
      if (!heads) {
        card.addStatus(STATUS.CONFUSION, {});
        room.pushEvent('log', { message: `${card.name}이(가) 반동으로 [혼란]에 걸렸습니다.` });
      }
    },
  },

  card_menhera: {
    s1: ({ room, player, opponent, card, target }) => {
      room.dealDamage({ sourcePlayer: player, sourceCard: card, targetPlayer: opponent, targetCard: target, baseAmount: 50 });
      if (target) target.addStatus(STATUS.HALVE_NEXT_DAMAGE_DEALT, {});
    },
  },

  card_taeyang_jonghyeon: {
    s1: ({ room, player }) => {
      player.fieldKeyword = FIELD_KEYWORD.SUNNY;
      room.pushEvent('fieldKeyword', { owner: player.nickname, keyword: FIELD_KEYWORD.SUNNY });
      room.pushEvent('log', { message: `${player.nickname}의 필드에 [쾌청]이 설치되었습니다.` });
    },
    s2: ({ room, target }) => {
      if (!target) return;
      room.heal(target, 100);
      target.addStack(STACK.SHIELD, 50);
      room.pushEvent('stackGain', { instanceId: target.instanceId, stack: STACK.SHIELD, value: target.getStack(STACK.SHIELD) });
      room.pushEvent('log', { message: `${target.name}에게 100 회복 및 [보호막 50]을 부여했습니다.` });
    },
  },

  card_hui: {
    s1: ({ room, target }) => {
      if (!target) return;
      room.heal(target, 80);
      room.pushEvent('log', { message: `${target.name}에게 80 HP를 회복했습니다.` });
    },
    s2: ({ room, player, opponent, card, target }) => {
      room.dealDamage({ sourcePlayer: player, sourceCard: card, targetPlayer: opponent, targetCard: target, baseAmount: 60 });
    },
  },

  card_ro: {
    s1: ({ room, target }) => {
      if (!target) return;
      target.addStack(STACK.DMG_UP, 3, MAX_DMG_STACK);
      room.pushEvent('stackGain', { instanceId: target.instanceId, stack: STACK.DMG_UP, value: target.getStack(STACK.DMG_UP) });
      room.pushEvent('log', { message: `${target.name}에게 [피해량 증가] 3스택을 부여했습니다.` });
    },
    s2: ({ room, player, opponent, card, target }) => {
      room.dealDamage({ sourcePlayer: player, sourceCard: card, targetPlayer: opponent, targetCard: target, baseAmount: 60 });
    },
  },

  card_ae: {
    s1: ({ room, target }) => {
      if (!target) return;
      target.addStack(STACK.DMG_DOWN, 3, MAX_DMG_STACK);
      room.pushEvent('stackGain', { instanceId: target.instanceId, stack: STACK.DMG_DOWN, value: target.getStack(STACK.DMG_DOWN) });
      room.pushEvent('log', { message: `${target.name}에게 [받는 피해량 감소] 3스택을 부여했습니다.` });
    },
    s2: ({ room, player, opponent, card, target }) => {
      room.dealDamage({ sourcePlayer: player, sourceCard: card, targetPlayer: opponent, targetCard: target, baseAmount: 60 });
    },
  },

  card_rak: {
    s1: ({ room, target }) => {
      if (!target) return;
      target.addStack(STACK.SHIELD, 60);
      room.pushEvent('stackGain', { instanceId: target.instanceId, stack: STACK.SHIELD, value: target.getStack(STACK.SHIELD) });
      room.pushEvent('log', { message: `${target.name}에게 [보호막 60]을 부여했습니다.` });
    },
    s2: ({ room, player, opponent, card, target }) => {
      room.dealDamage({ sourcePlayer: player, sourceCard: card, targetPlayer: opponent, targetCard: target, baseAmount: 60 });
    },
  },

  card_huiroaerak: {
    s1: ({ room, player, opponent, card }) => {
      room.dealDamageAll({ sourcePlayer: player, sourceCard: card, targetPlayer: opponent, baseAmount: 60 });
    },
    s2: ({ room, player, opponent, card, target }) => {
      room.dealDamage({ sourcePlayer: player, sourceCard: card, targetPlayer: opponent, targetCard: target, baseAmount: 200 });
    },
  },
};

/** 소모형 아이템 효과. payload는 클라이언트가 보낸 대상 정보 { targetOwner, targetInstanceId, targetOwner2, targetInstanceId2 } 등 */
const consumables = {
  item_ppa: ({ room, player }) => {
    const mobIdx = player.deck.findIndex((c) => c.type === 'mob');
    if (mobIdx === -1) return { error: '덱에 몹 카드가 없습니다.' };
    const [card] = player.deck.splice(mobIdx, 1);
    player.hand.push(card);
    room.pushEvent('log', { message: `${player.nickname}이(가) [뽑아]로 몹 카드를 드로우했습니다.` });
  },
  item_chaekgabang: ({ room, player }) => {
    const drawn = player.draw(2);
    room.pushEvent('log', { message: `${player.nickname}이(가) [책가방]으로 ${drawn.length}장을 드로우했습니다.` });
  },
  item_ai_geumji: ({ room, opponent, payload }) => {
    const target = opponent.findOnField(payload?.targetInstanceId);
    if (!target) return { error: '대상을 지정해주세요.' };
    for (const it of target.attachedItems) opponent.trash.push(it);
    target.attachedItems = [];
    room.pushEvent('log', { message: `${target.name}의 부착 아이템이 모두 제거되었습니다.` });
  },
  item_ya_i_sibal: ({ room, player, payload }) => {
    const target = player.findOnField(payload?.targetInstanceId);
    if (!target) return { error: '대상을 지정해주세요.' };
    target.statuses = {};
    room.pushEvent('log', { message: `${target.name}의 모든 상태이상이 해제되었습니다.` });
  },
  item_pos_neg: ({ room, player, opponent, payload }) => {
    const owner = payload?.targetOwner === 'opponent' ? opponent : player;
    const target = owner.findOnField(payload?.targetInstanceId);
    if (!target) return { error: '대상을 지정해주세요.' };
    const heads = room.coinFlip('positive negative');
    if (heads) room.heal(target, 100);
    else room.dealDamage({ sourcePlayer: null, sourceCard: null, targetPlayer: owner, targetCard: target, baseAmount: 100 });
  },
  item_4jo: ({ room, player, payload }) => {
    const res = room.returnFieldCardToHand(player, payload?.targetInstanceId);
    if (!res.ok) return { error: res.error };
  },
  item_chilpan: ({ room, player, payload }) => {
    const target = player.findOnField(payload?.targetInstanceId);
    if (!target) return { error: '대상을 지정해주세요.' };
    target.addStatus(STATUS.FIXED_TARGET, {});
    room.pushEvent('log', { message: `${target.name}이(가) 상대의 다음 공격 대상으로 고정되었습니다.` });
  },
  item_hyperfocus: ({ room, player, payload }) => {
    const target = player.findOnField(payload?.targetInstanceId);
    if (!target) return { error: '대상을 지정해주세요.' };
    target.addStatus(STATUS.HALVE_NEXT_DAMAGE_TAKEN, {});
    room.pushEvent('log', { message: `${target.name}의 다음 받는 피해가 절반이 됩니다.` });
  },
  item_gisup: ({ room, opponent }) => {
    for (const c of opponent.fieldMobs()) c.addStatus(STATUS.CONFUSION, {});
    room.pushEvent('log', { message: `상대 필드 전체가 [혼란]에 걸렸습니다.` });
  },
  item_ahejang: ({ room }) => {
    room.pushEvent('log', { message: `...효과가 없습니다. 그냥 기분이 좆같다.` });
  },
};

module.exports = skillHandlers;
module.exports.consumables = consumables;
