const assert = require('assert');
const { GameRoom, ALL_DEFS } = require('../src/engine/GameRoom');
const { CardInstance } = require('../src/engine/CardInstance');

function findDef(id) { return ALL_DEFS[id]; }

console.log('🧪 [6가지 버그 수정 & 밸런스 패치 검증 테스트 시작]\n');

// 1. 갸라도스 2턴 대기 검증
console.log('--- Test 1: 갸라도스 2턴 대기 조건 검증 ---');
const room1 = new GameRoom('ROOM1');
const p1 = room1.addPlayer('sock1', 'Player1');
const p2 = room1.addPlayer('sock2', 'Player2');

const inmyeoneo = new CardInstance(findDef('card_inmyeoneo'));
p1.field[0] = inmyeoneo;
const garados = new CardInstance(findDef('card_garados'));
p1.hand.push(garados);
room1.phase = 'battle';
room1.turnPlayerIndex = 0; // p1 턴

inmyeoneo.turnsOnField = 0;
let resEvo = room1.evolveCard(p1, garados.instanceId, inmyeoneo.instanceId);
assert.strictEqual(resEvo.ok, false, '0턴일 때 진화 차단');
console.log('  ✅ 0턴 진화 차단 성공:', resEvo.error);

inmyeoneo.turnsOnField = 1;
resEvo = room1.evolveCard(p1, garados.instanceId, inmyeoneo.instanceId);
assert.strictEqual(resEvo.ok, false, '1턴일 때 진화 차단');
console.log('  ✅ 1턴 진화 차단 성공:', resEvo.error);

inmyeoneo.turnsOnField = 2;
resEvo = room1.evolveCard(p1, garados.instanceId, inmyeoneo.instanceId);
assert.strictEqual(resEvo.ok, true, '2턴일 때 진화 성공');
console.log('  ✅ 2턴 진화 성공!');

// 2. 자연재해 포식 자동 발동 검증
console.log('\n--- Test 2: 자연재해 [포식] 턴 시작 시 자동 발동 검증 ---');
const room2 = new GameRoom('ROOM2');
const p2_1 = room2.addPlayer('sock1', 'P1');
const p2_2 = room2.addPlayer('sock2', 'P2');

const jaeonjaehae = new CardInstance(findDef('card_jaeonjaehae'));
jaeonjaehae.hp = 100;
const victim = new CardInstance(findDef('card_jeonjangyeon'));
p2_1.field[0] = jaeonjaehae;
p2_1.field[1] = victim;

room2.phase = 'battle';
room2.turnPlayerIndex = 1; // p2_2 턴에서 endTurn으로 p2_1 턴으로 변경
room2.endTurn(); // p2_1 턴 시작 -> runTurnStartHooks 실행

assert.strictEqual(p2_1.field[1], null, '아군 몹이 자동으로 포식되어 필드에서 제거됨');
assert.strictEqual(jaeonjaehae.hp, 200, '자연재해 체력 100 자동 회복');
console.log('  ✅ 자연재해 턴 시작 시 아군 몹 자동 포식 및 체력 회복 완료!');

// 3. 동일 아이템 턴당 1회 제한 검증
console.log('\n--- Test 3: 동일 아이템 한 턴에 1회 제한 검증 ---');
const room3 = new GameRoom('ROOM3');
const p3_1 = room3.addPlayer('sock1', 'P1');
const p3_2 = room3.addPlayer('sock2', 'P2');

const targetMob = new CardInstance(findDef('card_jeonjangyeon'));
p3_1.field[0] = targetMob;

const itemA1 = new CardInstance(findDef('item_hakseupryeok'));
const itemA2 = new CardInstance(findDef('item_hakseupryeok'));
const itemB = new CardInstance(findDef('item_innaeryeok'));
p3_1.hand.push(itemA1, itemA2, itemB);

const oppMob = new CardInstance(findDef('card_jeonjangyeon'));
p3_2.field[0] = oppMob;

room3.phase = 'battle';
room3.turnPlayerIndex = 0;

let att1 = room3.attachItem(p3_1, itemA1.instanceId, 'self', targetMob.instanceId);
assert.strictEqual(att1.ok, true, '첫 번째 학습력 아이템 장착 성공');

let att2 = room3.attachItem(p3_1, itemA2.instanceId, 'self', targetMob.instanceId);
assert.strictEqual(att2.ok, false, '동일 턴 두 번째 학습력 아이템 사용 차단');
console.log('  ✅ 동일 아이템 2번째 사용 차단 성공:', att2.error);

let att3 = room3.attachItem(p3_1, itemB.instanceId, 'self', targetMob.instanceId);
assert.strictEqual(att3.ok, true, '다른 아이템(인내력) 장착 성공');

room3.endTurn(); // 상대 턴
room3.endTurn(); // 다시 P1 턴 (턴 리셋)

const itemA3 = new CardInstance(findDef('item_hakseupryeok'));
p3_1.hand.push(itemA3);

const targetMob2 = new CardInstance(findDef('card_jammanbo'));
p3_1.field[1] = targetMob2;
let att5 = room3.attachItem(p3_1, itemA3.instanceId, 'self', targetMob2.instanceId);
if (!att5.ok) console.log('att5 실패 사유:', att5.error);
assert.strictEqual(att5.ok, true, '다음 턴에서는 동일 아이템 재사용 가능');
console.log('  ✅ 다음 턴 아이템 턴 리셋 정상 동작!');

// 4. 상대 턴 액션 차단 검증
console.log('\n--- Test 4: 상대 턴 액션 차단 검증 ---');
const room4 = new GameRoom('ROOM4');
const p4_1 = room4.addPlayer('sock1', 'P1');
const p4_2 = room4.addPlayer('sock2', 'P2');

const handMob = new CardInstance(findDef('card_jammanbo'));
p4_2.hand.push(handMob);
const handItem = new CardInstance(findDef('item_ppa'));
p4_2.hand.push(handItem);

room4.phase = 'battle';
room4.turnPlayerIndex = 0; // P1 턴

let oppPlace = room4.placeMobFromHand(p4_2, handMob.instanceId, 0);
assert.strictEqual(oppPlace.ok, false, '상대 턴 몹 배치 차단');
console.log('  ✅ 상대 턴 몹 배치 차단 성공:', oppPlace.error);

let oppItem = room4.useConsumable(p4_2, handItem.instanceId, {});
assert.strictEqual(oppItem.ok, false, '상대 턴 아이템 사용 차단');
console.log('  ✅ 상대 턴 아이템 사용 차단 성공:', oppItem.error);

console.log('\n🎉 [모든 6가지 버그 수정 및 패치 검증 테스트 ALL PASS!]');
