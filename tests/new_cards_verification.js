const assert = require('assert');
const { GameRoom, ALL_DEFS } = require('../src/engine/GameRoom');
const { STACK, FIELD_KEYWORD, PHASE } = require('../src/engine/constants');

console.log('🧪 [테스트 시작] 신규 카드 6종 및 키워드 4종 자동화 검증...\n');

// ===== 1. 스택형 키워드 데미지 보정 & 보호막 흡수 검증 =====
(function testStacksAndShield() {
  console.log('1. 스택형 키워드 (DMG_UP, DMG_DOWN, SHIELD) 검증');
  const room = new GameRoom('TEST1');
  const p1 = room.addPlayer('s1', 'P1');
  const p2 = room.addPlayer('s2', 'P2');
  room.startMatch();
  room.beginBattlePhase();

  // P1: 로(怒) 배치 (60 데미지 스킬 보유), P2: 전장연 배치 (HP 200)
  const roDef = ALL_DEFS['card_ro'];
  const p2MobDef = ALL_DEFS['card_jeonjangyeon'];

  const attacker = new (require('../src/engine/CardInstance').CardInstance)(roDef);
  const defender = new (require('../src/engine/CardInstance').CardInstance)(p2MobDef);

  p1.field[0] = attacker;
  p2.field[0] = defender;

  // (1) DMG_UP 3스택 적용 (60 데미지 + 30% = 78 데미지)
  attacker.addStack(STACK.DMG_UP, 3, 10);
  assert.strictEqual(attacker.getStack(STACK.DMG_UP), 3, 'DMG_UP 3스택 부여 실패');

  const initialDefenderHp = defender.hp; // 200
  const dealt = room.dealDamage({
    sourcePlayer: p1,
    sourceCard: attacker,
    targetPlayer: p2,
    targetCard: defender,
    baseAmount: 60,
  });

  assert.strictEqual(dealt, 78, `피해량 78 기대했으나 ${dealt} 수령`);
  assert.strictEqual(defender.hp, initialDefenderHp - 78, `방어자 HP ${initialDefenderHp - 78} 기대했으나 ${defender.hp}`);
  assert.strictEqual(attacker.getStack(STACK.DMG_UP), 0, '공격 후 DMG_UP 스택 소실 실패');
  console.log('  ✔️ DMG_UP 3스택 (+30%) 데미지증가 및 스택 소실 확인');

  // (2) DMG_DOWN 2스택 적용 (60 데미지 - 20% = 48 데미지)
  defender.addStack(STACK.DMG_DOWN, 2, 10);
  assert.strictEqual(defender.getStack(STACK.DMG_DOWN), 2, 'DMG_DOWN 2스택 부여 실패');

  const hpBeforeDmgDown = defender.hp;
  const dealt2 = room.dealDamage({
    sourcePlayer: p1,
    sourceCard: attacker,
    targetPlayer: p2,
    targetCard: defender,
    baseAmount: 60,
  });

  assert.strictEqual(dealt2, 48, `피해량 48 기대했으나 ${dealt2} 수령`);
  assert.strictEqual(defender.hp, hpBeforeDmgDown - 48, 'DMG_DOWN 감면 피해 HP 반영 실패');
  assert.strictEqual(defender.getStack(STACK.DMG_DOWN), 0, '피격 후 DMG_DOWN 스택 소실 실패');
  console.log('  ✔️ DMG_DOWN 2스택 (-20%) 데미지감소 및 스택 소실 확인');

  // (3) SHIELD 60 부여 후 80 피해 피격 (보호막 60 모두 흡수, 실제 HP 피해 20)
  defender.addStack(STACK.SHIELD, 60);
  assert.strictEqual(defender.getStack(STACK.SHIELD), 60, '보호막 60 부여 실패');

  const hpBeforeShield = defender.hp;
  const dealt3 = room.dealDamage({
    sourcePlayer: p1,
    sourceCard: attacker,
    targetPlayer: p2,
    targetCard: defender,
    baseAmount: 80,
  });

  assert.strictEqual(dealt3, 20, `보호막 차감 후 피해량 20 기대했으나 ${dealt3} 수령`);
  assert.strictEqual(defender.hp, hpBeforeShield - 20, '보호막 차감 후 잔여 피해 HP 반영 실패');
  assert.strictEqual(defender.getStack(STACK.SHIELD), 0, '보호막 소실 실패');
  console.log('  ✔️ SHIELD 60 보호막 흡수 및 잔여 피해 차감 확인\n');
})();

// ===== 2. 희로애락 합체 강림 소환 (필드 3장 + 손패 1장 = 4장 희생) & 턴 시작 오라 검증 =====
(function testHuiRoAeRakAwakening() {
  console.log('2. 필드 3장 (희, 로, 애) + 손패 4번째 1장 (락) 사용으로 총 4장 희생 후 [희로애락] 합체 소환 및 오라 검증');
  const room = new GameRoom('TEST2');
  const p1 = room.addPlayer('s1', 'P1');
  const p2 = room.addPlayer('s2', 'P2');
  room.startMatch();
  room.beginBattlePhase();

  const hui = new (require('../src/engine/CardInstance').CardInstance)(ALL_DEFS['card_hui']);
  const ro = new (require('../src/engine/CardInstance').CardInstance)(ALL_DEFS['card_ro']);
  const ae = new (require('../src/engine/CardInstance').CardInstance)(ALL_DEFS['card_ae']);
  const rak = new (require('../src/engine/CardInstance').CardInstance)(ALL_DEFS['card_rak']);

  // P1 필드에 희, 로, 애 3장 배치
  p1.hand.push(hui, ro, ae, rak);

  room.placeMobFromHand(p1, hui.instanceId, 0);
  room.placeMobFromHand(p1, ro.instanceId, 1);
  room.placeMobFromHand(p1, ae.instanceId, 2);
  assert.strictEqual(p1.fieldMobs().length, 3, '필드에 희, 로, 애 3장 배치 완료');

  // 4번째 카드 (락) 손패에서 사용하여 4장 합체 소환 발동!
  const resAwaken = room.placeMobFromHand(p1, rak.instanceId, 0);
  assert.strictEqual(resAwaken.ok, true, `희로애락 소환 실패: ${resAwaken.error}`);

  assert.strictEqual(p1.fieldMobs().length, 1, '합체 후 희로애락 1장만 필드에 존재해야 함');
  assert.strictEqual(p1.trash.length, 4, '손패 1장 + 필드 3장 = 총 4장이 트레쉬로 이동해야 함');

  const huiroaerak = p1.field[1];
  assert.notStrictEqual(huiroaerak, null, '중앙 슬롯에 희로애락 소환');
  assert.strictEqual(huiroaerak.defId, 'card_huiroaerak', 'defId card_huiroaerak 확인');
  assert.strictEqual(huiroaerak.hp, 523, '희로애락 체력 523 확인');
  console.log('  ✔️ 필드 3장 + 손패 1장 (총 4장 희생)으로 [희로애락] (HP 523) 합체 강림 소환 성공');

  // 턴 시작 오라 검증 (HP 80 회복, DMG_UP 2, DMG_DOWN 2, SHIELD 60)
  huiroaerak.hp = 300; // HP 300으로 깎아놓음
  room.turnPlayerIndex = 0; // P1 턴 시작
  room.runTurnStartHooks();

  assert.strictEqual(huiroaerak.hp, 380, `턴 오라 HP 80 회복 기대했으나 ${huiroaerak.hp}`);
  assert.strictEqual(huiroaerak.getStack(STACK.DMG_UP), 2, '턴 오라 DMG_UP 2스택 확인');
  assert.strictEqual(huiroaerak.getStack(STACK.DMG_DOWN), 2, '턴 오라 DMG_DOWN 2스택 확인');
  assert.strictEqual(huiroaerak.getStack(STACK.SHIELD), 60, '턴 오라 SHIELD 60 확인');
  console.log('  ✔️ [희로애락] 턴 시작 오라 (HP+80, DMG_UP+2, DMG_DOWN+2, SHIELD+60) 작동 확인\n');
})();

// ===== 3. [쾌청] 필드 키워드 & 솔라빔 턴 감축 검증 =====
(function testSunnySolarBeam() {
  console.log('3. [쾌청] 필드 키워드 및 솔라빔 차징 턴 -1감축 검증');
  const room = new GameRoom('TEST3');
  const p1 = room.addPlayer('s1', 'P1');
  const p2 = room.addPlayer('s2', 'P2');
  room.startMatch();
  room.beginBattlePhase();

  // P1 필드에 태양 종현 & 종바라기 배치, P2 필드에 피격 대상 몹 배치
  const taeyang = new (require('../src/engine/CardInstance').CardInstance)(ALL_DEFS['card_taeyang_jonghyeon']);
  const jongbaragi = new (require('../src/engine/CardInstance').CardInstance)(ALL_DEFS['card_jongbaragi']);
  const dummyOpp = new (require('../src/engine/CardInstance').CardInstance)(ALL_DEFS['card_jeonjangyeon']);

  p1.field[0] = taeyang;
  p1.field[1] = jongbaragi;
  p2.field[0] = dummyOpp;

  // P1 턴 세팅 후 태양 종현 1스킬 사용 -> P1 필드에 [쾌청] 설치
  room.phase = PHASE.BATTLE;
  room.turnPlayerIndex = 0;
  const resSkill = room.useSkill(p1, taeyang.instanceId, 's1', null);
  assert.strictEqual(resSkill.ok, true, `스킬 사용 실패: ${resSkill.error}`);
  assert.strictEqual(p1.fieldKeyword, FIELD_KEYWORD.SUNNY, '[쾌청] 필드 키워드 설치 실패');
  console.log('  ✔️ 태양 종현 1스킬로 [쾌청] 필드 설치 성공');

  // 종바라기 솔라빔 준비 시전
  room.turnPlayerIndex = 0; // P1 턴으로 강제 세팅
  jongbaragi.flags.solarBeamPending = true;
  jongbaragi.flags.skillLockTurns = 2; // 원래 2턴 차징

  const initialOppHp = dummyOpp.hp; // 200

  // 턴 시작 시 쾌청 효과로 차징 턴이 2 - (1+1) = 0 으로 줄어들어 즉시 발동해야 함!
  room.runTurnStartHooks();

  assert.strictEqual(jongbaragi.flags.solarBeamPending, false, '솔라빔 준비 상태 해제 완료');
  assert.strictEqual(dummyOpp.hp, 0, '솔라빔 300 데미지 직격으로 상대 쓰러짐');
  console.log('  ✔️ [쾌청] 상태에서 솔라빔 차징이 1턴 만에 발동 확인\n');
})();

console.log('✅ 모든 신규 카드 6종 및 키워드 4종 테스트 성공!');
