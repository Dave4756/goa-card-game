const assert = require('assert');
const { GameRoom } = require('../src/engine/GameRoom');
const { CardInstance } = require('../src/engine/CardInstance');
const { STATUS, STACK, FIELD_KEYWORD, PHASE } = require('../src/engine/constants');
const cardData = require('../src/data/cards.json');

console.log('🧪 [전장연 TCG 종합 엔진 & 스킬 테스트 시작]');

function findCardDef(id) {
  return cardData.mobs.find(m => m.id === id) || cardData.items.find(i => i.id === id);
}

// 헬퍼: 테스트용 룸 세팅
function createTestRoom() {
  const room = new GameRoom('TEST1');
  const p1 = room.addPlayer('sock1', '플레이어1');
  const p2 = room.addPlayer('sock2', '플레이어2');
  room.phase = PHASE.BATTLE;
  room.turnPlayerIndex = 0; // p1 턴
  room.turnNumber = 1;
  return { room, p1, p2 };
}

// 1. 공격 스킬 아군 지정 방지 테스트
console.log('\n--- Test 1: 공격 스킬 아군 대상 지정 차단 ---');
{
  const { room, p1, p2 } = createTestRoom();
  const j1 = new CardInstance(findCardDef('card_jeonjangyeon'));
  const ally = new CardInstance(findCardDef('card_inmyeoneo'));
  const enemy = new CardInstance(findCardDef('card_inmyeoneo'));
  p1.field[0] = j1;
  p1.field[1] = ally;
  p2.field[0] = enemy;

  // s1은 공격 스킬 (targetType: "enemy") -> 아군 ally를 지정하면 실패해야 함!
  const resSelf = room.useSkill(p1, j1.instanceId, 's1', { owner: 'self', instanceId: ally.instanceId });
  assert.strictEqual(resSelf.ok, false, '공격 스킬을 아군에게 쓰면 ok: false여야 함');
  console.log('✅ 공격 스킬 아군 지정 시도 차단 성공:', resSelf.error);

  // 적(전장연)을 지정하면 성공해야 함
  const enemyJ = new CardInstance(findCardDef('card_jeonjangyeon'));
  p2.field[0] = enemyJ;
  const resEnemy = room.useSkill(p1, j1.instanceId, 's1', { owner: 'opponent', instanceId: enemyJ.instanceId });
  assert.strictEqual(resEnemy.ok, true, '적을 지정하면 스킬 성공해야 함');
  assert.strictEqual(enemyJ.hp, 160, '전장연(HP 200)이 40 데미지를 입고 HP 160이 되어야 함');
  console.log('✅ 상대 공격 스킬 정상 작동: 적 HP ->', enemyJ.hp);
}

// 2. 자연재해 포식 특성 (턴 시작 시 아군 몹 1마리 자동 포식)
console.log('\n--- Test 2: 자연재해 포식 특성 (턴 시작 시 아군 몹 1마리 자동 포식) ---');
{
  const { room, p1, p2 } = createTestRoom();
  const disaster = new CardInstance(findCardDef('card_jaeonjaehae'));
  disaster.hp = 300; // 부상 상태
  const sacrifice = new CardInstance(findCardDef('card_inmyeoneo'));
  const attachItem = new CardInstance(findCardDef('item_innaeryeok'));
  sacrifice.attachedItems.push(attachItem);

  p1.field[0] = disaster;
  p1.field[1] = sacrifice;
  p2.field[0] = new CardInstance(findCardDef('card_jeonjangyeon'));

  room.turnPlayerIndex = 1; // P2 턴에서 endTurn 시 P1 턴 시작
  room.endTurn(); // P1 턴 시작 -> 자동 포식 실행

  assert.strictEqual(disaster.hp, 400, '자동 포식 후 HP 100 회복 (300 -> 400)');
  assert.strictEqual(p1.field[1], null, '희생된 카드는 필드에서 제거되어야 함');
  assert.strictEqual(p1.trash.includes(sacrifice), true, '희생된 카드는 트레쉬로 이동해야 함');
  assert.strictEqual(p1.trash.includes(attachItem), true, '부착되어 있던 아이템도 트레쉬로 이동해야 함');
  console.log('✅ 자연재해 자동 포식 정상 작동 (HP 회복, 아군 트레쉬, 부착물 트레쉬)');
}

// 3. 부착 아이템 효과 (학습력 +10 데미지, 인내력 -15 피해)
console.log('\n--- Test 3: 부착 아이템 효과 (학습력 +10, 인내력 -15) ---');
{
  const { room, p1, p2 } = createTestRoom();
  const attacker = new CardInstance(findCardDef('card_jeonjangyeon'));
  const defender = new CardInstance(findCardDef('card_jeonjangyeon'));
  
  // 공격자에게 학습력 장착
  attacker.attachedItems.push(new CardInstance(findCardDef('item_hakseupryeok')));
  // 방어자에게 인내력 장착
  defender.attachedItems.push(new CardInstance(findCardDef('item_innaeryeok')));
  p1.field[0] = attacker;
  p2.field[0] = defender;

  // s1 기본 데미지 40 + 학습력 10 - 인내력 15 = 35 데미지
  const dmg = room.dealDamage({
    sourcePlayer: p1,
    sourceCard: attacker,
    targetPlayer: p2,
    targetCard: defender,
    baseAmount: 40
  });
  assert.strictEqual(dmg, 35, '40 + 10(학습력) - 15(인내력) = 35');
  assert.strictEqual(defender.hp, 200 - 35, '방어자 체력 165 확인');
  console.log('✅ 학습력(+10) 및 인내력(-15) 데미지 계산 정확');
}

// 4. 과열된 연료 보유 카드가 공격 시 [화상] 부여 및 턴 시작 시 화상 틱 데미지
console.log('\n--- Test 4: 과열된 연료 공격 시 [화상] 부여 & 화상 틱 ---');
{
  const { room, p1, p2 } = createTestRoom();
  const driver = new CardInstance(findCardDef('card_pokjujok'));
  const target = new CardInstance(findCardDef('card_jeonjangyeon'));
  p1.field[0] = driver;
  p2.field[0] = target;

  driver.addStack(STACK.HOT_FUEL, 1); // 과열된 연료 1스택
  room.dealDamage({
    sourcePlayer: p1,
    sourceCard: driver,
    targetPlayer: p2,
    targetCard: target,
    baseAmount: 30
  });

  assert.strictEqual(target.hasStatus(STATUS.BURN), true, '과열된 연료 보유 카드가 데미지를 주면 대상에게 화상 부여');
  console.log('✅ 과열된 연료 공격 시 대상에게 [화상] 정상 부여');

  // p2 턴 시작 시 화상 틱 데미지 20 확인
  const hpBefore = target.hp;
  room.endTurn(); // p2 턴 시작
  // 화상 틱 20 발생했는지 확인 (동전 앞면이면 화상 제거, 뒷면이면 유지)
  assert.strictEqual(target.hp, hpBefore - 20, '화상 틱 20 데미지 발생 확인');
  console.log('✅ 턴 시작 시 [화상] 20 데미지 틱 정상 발동');
}

// 5. 혼란 (공격 시 자해 20 & 스킬 캔슬) 테스트
console.log('\n--- Test 5: 혼란 상태이상 (코인플립 뒷면 시 자해 20 및 스킬 캔슬) ---');
{
  const { room, p1, p2 } = createTestRoom();
  const confused = new CardInstance(findCardDef('card_jeonjangyeon'));
  confused.addStatus(STATUS.CONFUSION);
  const enemy = new CardInstance(findCardDef('card_inmyeoneo'));
  p1.field[0] = confused;
  p2.field[0] = enemy;

  // 동전 결과를 강제로 뒷면(false)으로 고정하여 테스트
  const origFlip = room.coinFlip;
  room.coinFlip = () => false;

  const hpBefore = confused.hp;
  const res = room.useSkill(p1, confused.instanceId, 's1', { owner: 'opponent', instanceId: enemy.instanceId });
  assert.strictEqual(confused.hp, hpBefore - 20, '혼란으로 스킬 실패 시 20 자해');
  assert.strictEqual(enemy.hp, 50, '스킬 캔슬로 적은 데미지를 입지 않아야 함');
  console.log('✅ [혼란] 판정 실패 시 20 자해 및 스킬 취소 정상');

  room.coinFlip = origFlip;
}

// 6. 잠만보 하품(수면) -> 수면 유지 및 스킬 시전 시 코인 플립(앞면 해제/뒷면 실패) 테스트
console.log('\n--- Test 6: 잠만보 수면 -> 스킬 시전 시 코인 플립 판정 ---');
{
  const { room, p1, p2 } = createTestRoom();
  const snorlax = new CardInstance(findCardDef('card_jammanbo'));
  const victim = new CardInstance(findCardDef('card_jeonjangyeon'));
  p1.field[0] = snorlax;
  p2.field[0] = victim;

  // 잠만보 s2 하품 시전 (victim에게 수면 부여 후 p1 턴 종료 -> p2 턴)
  room.useSkill(p1, snorlax.instanceId, 's2', { owner: 'opponent', instanceId: victim.instanceId });
  assert.strictEqual(victim.hasStatus(STATUS.SLEEP), true, '턴 시작 후에도 수면 상태가 지속되어야 함');

  // Case A: 코인 뒷면(false) -> 수면 유지, 스킬 취소, 턴 종료
  const origFlip = room.coinFlip;
  room.coinFlip = () => false;
  const resTails = room.useSkill(p2, victim.instanceId, 's1', { owner: 'opponent', instanceId: snorlax.instanceId });
  assert.strictEqual(resTails.ok, true, '액션 자체는 정상 소화');
  assert.strictEqual(victim.hasStatus(STATUS.SLEEP), true, '뒷면이면 수면 유지');
  assert.strictEqual(room.currentTurnPlayerId, p1.id, '실패 후 턴이 넘어가야 함');

  // p1 턴 스킵하여 다시 p2 턴으로
  room.skipTurn(p1);
  assert.strictEqual(room.currentTurnPlayerId, p2.id);

  // Case B: 코인 앞면(true) -> 수면 해제 후 스킬 발동!
  room.coinFlip = () => true;
  const resHeads = room.useSkill(p2, victim.instanceId, 's1', { owner: 'opponent', instanceId: snorlax.instanceId });
  assert.strictEqual(resHeads.ok, true, '앞면이면 수면 해제 후 스킬 성공');
  assert.strictEqual(victim.hasStatus(STATUS.SLEEP), false, '수면 상태 해제됨');
  console.log('✅ [수면] 개편 룰 (수면 상태 유지, 코인 앞면 시 해제&스킬, 뒷면 시 유지&턴종료) 정상 검증');

  room.flipCoin = origFlip;
}

// 7. 메카 전장연 과충전 스택 및 중국산 배터리 패시브
console.log('\n--- Test 7: 메카 과충전 및 중국산 배터리 피격 증가 ---');
{
  const { room, p1, p2 } = createTestRoom();
  const meka = new CardInstance(findCardDef('card_meka'));
  const enemy = new CardInstance(findCardDef('card_jeonjangyeon'));
  p1.field[0] = meka;
  p2.field[0] = enemy;

  // 과충전 3스택 부여
  meka.addStack(STACK.OVERCHARGE, 3);
  // 중국산 배터리: 과충전 스택당 받는 피해 +10 (기본 40 + 3*10 = 70 피해)
  const dmg = room.dealDamage({
    sourcePlayer: p2,
    sourceCard: enemy,
    targetPlayer: p1,
    targetCard: meka,
    baseAmount: 40
  });
  assert.strictEqual(dmg, 70, '기본 40 + 3스택*10 = 70 데미지');
  console.log('✅ 중국산 배터리 과충전 스택당 피격 데미지 증가 정상 (40 -> 70)');
}

// 8. 3개 아이템 장착 시 각성 리즈시절 전장연 진화 트리거
console.log('\n--- Test 8: 각성 리즈시절 전장연 진화 트리거 ---');
{
  const { room, p1, p2 } = createTestRoom();
  const j = new CardInstance(findCardDef('card_jeonjangyeon'));
  p1.field[0] = j;

  const item1 = new CardInstance(findCardDef('item_innaeryeok'));
  const item2 = new CardInstance(findCardDef('item_hakseupryeok'));
  const item3 = new CardInstance(findCardDef('item_sahoechinhwaryeok'));
  p1.hand.push(item1, item2, item3);

  room.attachItem(p1, item1.instanceId, 'self', j.instanceId);
  room.attachItem(p1, item2.instanceId, 'self', j.instanceId);
  assert.strictEqual(j.defId, 'card_jeonjangyeon', '2개 아이템일 때는 전장연 유지');

  // 3번째 아이템 장착 시 각성!
  room.attachItem(p1, item3.instanceId, 'self', j.instanceId);
  assert.strictEqual(j.defId, 'card_gakseong', '세 가지 힘 아이템 장착 시 각성 리즈시절 전장연으로 진화');
  assert.strictEqual(j.name, '각성 리즈시절 전장연');
  console.log('✅ 각성 리즈시절 전장연 진화 트리거 정상 완료 (HP:', j.hp, '/', j.maxHp, ')');
}

// 9. 머리 흘러내린 전장연: 양옆 피해 절반 대신 받기
console.log('\n--- Test 9: 흘러내린 머리카락 (양옆 피해 절반 대신 받음) ---');
{
  const { room, p1, p2 } = createTestRoom();
  const center = new CardInstance(findCardDef('card_heoreonaerin')); // 슬롯 1
  const left = new CardInstance(findCardDef('card_jeonjangyeon'));    // 슬롯 0
  p1.field[0] = left;
  p1.field[1] = center;

  const enemy = new CardInstance(findCardDef('card_jeonjangyeon'));
  p2.field[0] = enemy;

  // left에게 100 데미지를 주면: center가 절반(50)을 대신 받고, left는 50만 입음
  const hpLeftBefore = left.hp;
  const hpCenterBefore = center.hp;
  room.dealDamage({
    sourcePlayer: p2,
    sourceCard: enemy,
    targetPlayer: p1,
    targetCard: left,
    baseAmount: 100
  });

  assert.strictEqual(left.hp, hpLeftBefore - 50, '양옆 아군은 피해의 절반(50)만 입음');
  assert.strictEqual(center.hp, hpCenterBefore - 50, '흘러내린 머리카락 카드가 50을 대신 받음');
  console.log('✅ 흘러내린 머리카락 피해 절반 분담 정상 작동');
}

// 10. 기사 전장연: 필드에 1장뿐일 때 데미지 2배 및 받는 피해 절반
console.log('\n--- Test 10: 기사도 정신 (단독 1장일 때 공격 x2, 방어 절반) ---');
{
  const { room, p1, p2 } = createTestRoom();
  const knight = new CardInstance(findCardDef('card_gisa'));
  const enemy = new CardInstance(findCardDef('card_jeonjangyeon'));
  p1.field[0] = knight; // p1 필드엔 기사 1마리만 존재
  p2.field[0] = enemy;

  // 기본 스킬 피해 60 -> 기사도 정신 x2 = 120 데미지
  const dmgDealt = room.dealDamage({
    sourcePlayer: p1,
    sourceCard: knight,
    targetPlayer: p2,
    targetCard: enemy,
    baseAmount: 60
  });
  assert.strictEqual(dmgDealt, 120, '단독 존재 시 주는 피해 2배 (60 -> 120)');

  // 피격 시 100 데미지 -> 기사도 정신 50% 감소 = 50 데미지
  const dmgTaken = room.dealDamage({
    sourcePlayer: p2,
    sourceCard: enemy,
    targetPlayer: p1,
    targetCard: knight,
    baseAmount: 100
  });
  assert.strictEqual(dmgTaken, 50, '단독 존재 시 받는 피해 절반 (100 -> 50)');
  console.log('✅ 기사도 정신 공격 2배 / 받는 피해 절반 정상 작동');
}

// 11. 승리 조건 판정 (필드 몹 전멸 시 패배)
console.log('\n--- Test 11: 승리 및 패배 조건 (필드 몹 0마리 시 패배) ---');
{
  const { room, p1, p2 } = createTestRoom();
  const victim = new CardInstance(findCardDef('card_inmyeoneo')); // HP 50
  p2.field[0] = victim;
  const attacker = new CardInstance(findCardDef('card_garados'));
  p1.field[0] = attacker;

  // victim 처치 (HP 50 -> 0)
  room.dealDamage({
    sourcePlayer: p1,
    sourceCard: attacker,
    targetPlayer: p2,
    targetCard: victim,
    baseAmount: 100
  });

  assert.strictEqual(victim.alive, false, 'victim 사망');
  assert.strictEqual(p2.hasAliveMob(), false, 'p2 필드 몹 전멸');
  assert.strictEqual(room.phase, PHASE.ENDED, '게임 페이즈가 ENDED여야 함');
  assert.strictEqual(room.winnerIndex, 0, '승자는 p1(index 0)');
  console.log('✅ 필드 몹 전멸 시 즉시 게임 종료 및 승자 판정 정상');
}

console.log('\n🎉 [모든 11개 엔진/스킬/버프/디버프 통합 테스트 ALL PASS!]');
