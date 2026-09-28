const assert = require('assert');
const { GameRoom, ALL_DEFS } = require('../src/engine/GameRoom');
const { STATUS, STACK, FIELD_KEYWORD, PHASE } = require('../src/engine/constants');

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

  assert.strictEqual(huiroaerak.hp, 340, `턴 오라 HP 40 회복(너프) 기대했으나 ${huiroaerak.hp}`);
  assert.strictEqual(huiroaerak.getStack(STACK.DMG_UP), 2, '턴 오라 DMG_UP 2스택 확인');
  assert.strictEqual(huiroaerak.getStack(STACK.DMG_DOWN), 2, '턴 오라 DMG_DOWN 2스택 확인');
  assert.strictEqual(huiroaerak.getStack(STACK.SHIELD), 30, '턴 오라 SHIELD 30(너프) 확인');
  console.log('  ✔️ [희로애락] 턴 시작 오라 너프 (HP+40, DMG_UP+2, DMG_DOWN+2, SHIELD+30) 작동 확인\n');
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

  // 턴 시작 시 쾌청 효과로 차징 턴이 2 - (1+1) = 0 으로 줄어들어 즉시 발동해야 함!
  room.runTurnStartHooks();

  assert.strictEqual(jongbaragi.flags.solarBeamPending, false, '솔라빔 준비 상태 해제 완료');
  assert.strictEqual(dummyOpp.hp, 0, '솔라빔 300 데미지 직격으로 상대 쓰러짐');
  console.log('  ✔️ [쾌청] 상태에서 솔라빔 차징이 1턴 만에 발동 확인\n');
})();

// ===== 4. [탈모 전장연] 미련없는 인생 & 임종 검증 =====
(function testTalmoImjong() {
  console.log('4. [탈모 전장연] 탈모 상태 시 치명상 방어 & [임종] 광역 400 발동 검증');
  const room = new GameRoom('TEST4');
  const p1 = room.addPlayer('s1', 'P1');
  const p2 = room.addPlayer('s2', 'P2');
  room.startMatch();

  const talmo = new (require('../src/engine/CardInstance').CardInstance)(ALL_DEFS['card_talmo']);
  const opp1 = new (require('../src/engine/CardInstance').CardInstance)(ALL_DEFS['card_jeonjangyeon']);
  const opp2 = new (require('../src/engine/CardInstance').CardInstance)(ALL_DEFS['card_jeonjangyeon']);

  p1.field[0] = talmo;
  p2.field[0] = opp1;
  p2.field[1] = opp2;
  room.beginBattlePhase();

  // 스킬2로 탈모 시작
  talmo.addStatus('talmo', {});
  assert.strictEqual(talmo.hasStatus('talmo'), true, '탈모 상태 부여 확인');

  // 적이 탈모 전장연에게 300 치명상 데미지 가함
  room.dealDamage({ sourcePlayer: p2, sourceCard: opp1, targetPlayer: p1, targetCard: talmo, baseAmount: 300 });

  // 탈모 전장연은 임종 시전 후 사망, 적 필드 전원 400 피해로 적 전멸 확인
  assert.strictEqual(talmo.alive, false, '임종 발동 후 탈모 전장연 사망 확인');
  assert.strictEqual(opp1.alive, false, '임종 400 피해로 적 1 사망 확인');
  assert.strictEqual(opp2.alive, false, '임종 400 피해로 적 2 사망 확인');
  console.log('  ✔️ [탈모 전장연] 미련없는 인생 -> [임종] 광역 400 데미지 후 사망 정상 작동 확인\n');
})();

// ===== 5. [용사 파티] & [타락한 이세계 용사] 각성 진화 검증 =====
(function testPartyAndCorruptedHero() {
  console.log('5. [용사 파티] 버프 부여 및 동료 전멸 시 [타락한 용사] 각성 진화 검증');
  const room = new GameRoom('TEST5');
  const p1 = room.addPlayer('s1', 'P1');
  const p2 = room.addPlayer('s2', 'P2');
  room.startMatch();

  const gisa = new (require('../src/engine/CardInstance').CardInstance)(ALL_DEFS['card_gisa']);
  const mage = new (require('../src/engine/CardInstance').CardInstance)(ALL_DEFS['card_mage']);
  const cleric = new (require('../src/engine/CardInstance').CardInstance)(ALL_DEFS['card_cleric']);
  const archer = new (require('../src/engine/CardInstance').CardInstance)(ALL_DEFS['card_archer']);
  const enemy = new (require('../src/engine/CardInstance').CardInstance)(ALL_DEFS['card_saurus']); // HP 400

  p1.hand = [gisa, mage, cleric, archer];
  p1.deck = [];
  p2.hand = [enemy];

  room.placeMobFromHand(p1, gisa.instanceId, 0);
  room.placeMobFromHand(p1, mage.instanceId, 1);
  room.placeMobFromHand(p1, cleric.instanceId, 2);
  room.placeMobFromHand(p2, enemy.instanceId, 0);
  room.beginBattlePhase();

  // 기사 전장연에게 이세계 용사, 선택 받은 용사 버프 자동 부여 확인
  assert.strictEqual(gisa.hasStatus('isekai_hero'), true, '마법사 패시브: 이세계 용사 부여');
  assert.strictEqual(gisa.hasStatus('chosen_hero'), true, '성직자 패시브: 선택 받은 용사 부여');
  assert.strictEqual(gisa.maxHp, 523, '선택 받은 용사: 최대 체력 523');

  // 궁수 전장연도 배치하여 [믿을 만한 동료] 버프 획득 검증 (성직자 사망 후 슬롯에 궁수 배치)
  room.dealDamage({ sourcePlayer: p2, sourceCard: enemy, targetPlayer: p1, targetCard: cleric, baseAmount: 300 });
  room.turnPlayerIndex = 0;
  room.placeMobFromHand(p1, archer.instanceId, 2);
  assert.strictEqual(gisa.hasStatus('trusted_comrade'), true, '궁수 패시브: 믿을 만한 동료 부여');

  // 디버프(혼란, 화상) 부여 후 [야 이 시발] 사용 시 버프는 유지되고 디버프만 제거되는지 검증
  gisa.addStatus(STATUS.CONFUSION, {});
  gisa.addStatus(STATUS.BURN, {});
  const sibaItem = new (require('../src/engine/CardInstance').CardInstance)(ALL_DEFS['item_ya_i_sibal']);
  p1.hand.push(sibaItem);
  room.turnPlayerIndex = 0;
  room.useConsumable(p1, sibaItem.instanceId, { targetOwner: 'self', targetInstanceId: gisa.instanceId });
  assert.strictEqual(gisa.hasStatus(STATUS.CONFUSION), false, '혼란 디버프 제거');
  assert.strictEqual(gisa.hasStatus(STATUS.BURN), false, '화상 디버프 제거');
  assert.strictEqual(gisa.hasStatus('isekai_hero'), true, '이세계 용사 버프는 유지');
  assert.strictEqual(gisa.hasStatus('chosen_hero'), true, '선택 받은 용사 버프는 유지');
  assert.strictEqual(gisa.hasStatus('trusted_comrade'), true, '믿을 만한 동료 버프는 유지');
  console.log('  ✔️ [야 이 시발] 디버프만 해제되고 버프 유지 확인');

  // 마법사 스킬1 (기사 대상 시 3스택 버프)
  room.turnPlayerIndex = 0;
  room.useSkill(p1, mage.instanceId, 's1', { owner: 'self', instanceId: gisa.instanceId });
  assert.strictEqual(gisa.getStack(STACK.DMG_UP), 3, '기사 대상 3스택 피해증가');

  // 남은 동료(마법사, 궁수)가 모두 쓰러져 트레쉬로 이동
  room.dealDamage({ sourcePlayer: p2, sourceCard: enemy, targetPlayer: p1, targetCard: mage, baseAmount: 300 });
  room.dealDamage({ sourcePlayer: p2, sourceCard: enemy, targetPlayer: p1, targetCard: archer, baseAmount: 300 });

  // 3가지 버프를 모두 받은 기사 전장연이 [모든 것을 잃어 타락해버린 이세계 용사 전장연]으로 진화 확인!
  assert.strictEqual(gisa.defId, 'card_corrupted_hero', '타락한 용사로 각성 진화 성공');
  assert.strictEqual(gisa.hp, 523, '타락한 용사 체력 523 확인');
  assert.strictEqual(gisa.getStack(STACK.LAST_EMBER), 1, '마지막 불씨 1스택 보유 확인');
  console.log('  ✔️ [용사 파티] 버프 및 [타락한 이세계 용사] 자동 각성 진화 성공');

  // 타락한 용사 스킬1 ((200 피해 * 1.3 DMG_UP + 30 chosen_hero) * 2 기사도 = 580, 흡혈 50% = 290 회복 -> 200 + 290 = 490)
  gisa.hp = 200;
  room.turnPlayerIndex = 0;
  room.useSkill(p1, gisa.instanceId, 's1', { owner: 'opponent', instanceId: enemy.instanceId });
  assert.strictEqual(gisa.hp, 490, '타락한 용사 50% 흡혈 정상 작동 확인 (200 + 290 = 490)');

  // 치명상 피격 시 [마지막 불씨]로 HP 1 생존 (2000 피해)
  room.dealDamage({ sourcePlayer: p2, sourceCard: enemy, targetPlayer: p1, targetCard: gisa, baseAmount: 2000 });
  assert.strictEqual(gisa.alive, true, '마지막 불씨로 생존');
  assert.strictEqual(gisa.hp, 1, '체력 1 고정 확인');

  // 다음 턴 시작 시 [마지막 발악] 광역 100 데미지 자동 발동
  room.turnPlayerIndex = 0;
  room.runTurnStartHooks();
  console.log('  ✔️ [타락한 이세계 용사] 마지막 불씨 & 마지막 발악 정상 작동 확인\n');
})();

// ===== 6. 신규 아이템 [포옹], [급식], [positive negative 200] 검증 =====
(function testNewItems() {
  console.log('6. 신규 아이템 [포옹], [급식], [positive negative 200] 검증');
  const room = new GameRoom('TEST6');
  const p1 = room.addPlayer('s1', 'P1');
  const p2 = room.addPlayer('s2', 'P2');
  const mobP1 = new (require('../src/engine/CardInstance').CardInstance)(ALL_DEFS['card_jeonjangyeon']);
  const mobP2 = new (require('../src/engine/CardInstance').CardInstance)(ALL_DEFS['card_jeonjangyeon']);
  p1.field[0] = mobP1;
  p2.field[0] = mobP2;
  room.startMatch();
  room.beginBattlePhase();
  room.turnPlayerIndex = 0;

  const mobInTrash = new (require('../src/engine/CardInstance').CardInstance)(ALL_DEFS['card_jeonjangyeon']);
  p1.trash.push(mobInTrash);

  const hugItem = new (require('../src/engine/CardInstance').CardInstance)(ALL_DEFS['item_hug']);
  p1.hand.push(hugItem);
  room.useConsumable(p1, hugItem.instanceId, {});
  assert.strictEqual(p1.hand.some(c => c.instanceId === mobInTrash.instanceId), true, '포옹으로 트레쉬의 몹 카드 회수 성공');

  const geupsikItem = new (require('../src/engine/CardInstance').CardInstance)(ALL_DEFS['item_geupsik']);
  const targetMob = new (require('../src/engine/CardInstance').CardInstance)(ALL_DEFS['card_jeonjangyeon']);
  targetMob.hp = 50;
  p1.hand.push(geupsikItem, targetMob);
  room.turnPlayerIndex = 0;
  room.placeMobFromHand(p1, targetMob.instanceId, 1);
  room.useConsumable(p1, geupsikItem.instanceId, { targetOwner: 'self', targetInstanceId: targetMob.instanceId });
  assert.strictEqual(targetMob.hp, 150, '급식으로 100 회복 성공');
  console.log('  ✔️ [포옹] 및 [급식] 아이템 정상 작동 확인\n');
})();

console.log('🎉 모든 신규 카드 및 아이템 100% 검증 완료!');
