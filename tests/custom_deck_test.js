const assert = require('assert');
const { GameRoom } = require('../src/engine/GameRoom');
const { PHASE } = require('../src/engine/constants');

console.log('🃏 [커스텀 덱 20장 빌더 단위 테스트 시작]');

const room = new GameRoom('CUST1');
// 20장 커스텀 덱 준비 (자연재해 1장, 전장연 2장, 메카 2장, 인내력 2장 등)
const customDeck20 = [
  'card_jeonjangyeon', 'card_jeonjangyeon',
  'card_inmyeoneo', 'card_inmyeoneo',
  'card_garados',
  'card_jammanbo', 'card_jammanbo',
  'card_meka', 'card_meka',
  'card_jongyeonchu', 'card_jongyeonchu',
  'card_jaeonjaehae', // 1장 제한
  'item_innaeryeok', 'item_innaeryeok',
  'item_hakseupryeok', 'item_hakseupryeok',
  'item_sahoechinhwaryeok', 'item_sahoechinhwaryeok',
  'item_ppa', 'item_chaekgabang'
];

const p1 = room.addPlayer('sock1', '커스텀유저', customDeck20);
const p2 = room.addPlayer('sock2', '기본유저'); // customDeck 없음 -> 표준 덱

room.startMatch();

// 1. P1의 총 카드 수가 20장인지 확인 (손패 3장 + 덱 17장 = 20장)
const p1TotalCards = p1.deck.length + p1.hand.length;
assert.strictEqual(p1TotalCards, 20, 'P1 커스텀 덱 총 20장 보장');
console.log('✅ P1 커스텀 덱 20장 생성 완료 (손패:', p1.hand.length, ', 덱:', p1.deck.length, ')');

// 2. 덱 안에 자연재해가 정확히 1장만 들어있는지 확인
const jjhCount = [...p1.deck, ...p1.hand].filter(c => c.defId === 'card_jaeonjaehae').length;
assert.strictEqual(jjhCount, 1, '자연재해 1장 제한 준수');
console.log('✅ 자연재해 1장 제한 규칙 검증 통과');

// 3. P2 기본 유저도 정상 덱 생성 확인
const p2TotalCards = p2.deck.length + p2.hand.length;
assert.ok(p2TotalCards >= 20, 'P2 표준 덱 정상 생성');
console.log('✅ P2 표준 덱 정상 생성 완료');

console.log('🎉 [커스텀 덱 단위 테스트 ALL PASS!]');
