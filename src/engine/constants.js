// 상태이상 (디버프형)
const STATUS = {
  CONFUSION: 'confusion', // 혼란
  BURN: 'burn',           // 화상
  SLEEP: 'sleep',         // 수면 (하품)
  FIXED_TARGET: 'fixedTarget', // 이 칠판 지우개를 봐 - 상대의 다음 공격 대상 고정
  HALVE_NEXT_DAMAGE_TAKEN: 'halveNextDamageTaken', // 하이퍼포커스
  HALVE_NEXT_DAMAGE_DEALT: 'halveNextDamageDealt', // 친한척하기 / 포효
};

// 스택형 키워드
const STACK = {
  OVERCHARGE: 'overcharge',   // 과충전 (최대 10)
  HOT_FUEL: 'hotFuel',        // 과열된 연료
  SHIELD: 'shield',           // 보호막
  DMG_UP: 'dmgUp',            // 피해량 증가 (최대 10)
  DMG_DOWN: 'dmgDown',        // 받는 피해량 감소 (최대 10)
};

const MAX_OVERCHARGE = 10;
const MAX_DMG_STACK = 10;

// 필드형 키워드 (필드당 1개)
const FIELD_KEYWORD = {
  ELECTRIC_FIELD: 'electricField', // 전기장 - 과충전 획득량 *2
  SUNNY: 'sunny',                  // 쾌청 - 솔라빔 턴 -1
};

const PHASE = {
  WAITING: 'waiting',
  PLACEMENT: 'placement',
  BATTLE: 'battle',
  ENDED: 'ended',
};

module.exports = { STATUS, STACK, MAX_OVERCHARGE, FIELD_KEYWORD, PHASE };
