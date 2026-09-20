let counter = 0;
function nextId() {
  counter += 1;
  return `c${Date.now().toString(36)}${counter}`;
}

class CardInstance {
  constructor(def) {
    this.instanceId = nextId();
    this.defId = def.id;
    this.def = def; // 원본 카드 정의 (읽기 전용으로 취급)
    this.name = def.name;
    this.type = def.type; // 'mob' | 'item_attach' | 'item_consume'

    if (def.type === 'mob') {
      this.maxHp = def.hp;
      this.hp = def.hp;
      this.statuses = {};       // { [STATUS]: { turns?, meta? } }
      this.stacks = {};         // { [STACK]: number }
      this.attachedItems = [];  // CardInstance[] (item_attach)
      this.permanentDamageBonus = 0; // 폭주족 시동걸기 영구 강화 등
      this.turnsOnField = 0;    // 필드에 배치된 후 경과한 턴 수 (진화 조건 등에 사용)
      this.flags = {
        lastSkillUsed: null,     // 직전 자신 턴에 사용한 스킬 id (런닝맨용)
        skillLockTurns: 0,       // 종바라기 솔라빔 준비 중 락
        solarBeamPending: false,
        photosynthesisBoost: 0,  // 종바라기 누적 보정치
        cannotHealExceptSelf: false, // 자연재해 스킬2 사용 후 전역 플래그(방 단위로 별도 관리)
      };
      this.alive = true;
    }

  }

  isMob() {
    return this.type === 'mob';
  }

  hasStatus(status) {
    return !!this.statuses[status];
  }

  addStatus(status, meta = {}) {
    this.statuses[status] = { ...meta };
  }

  removeStatus(status) {
    delete this.statuses[status];
  }

  addStack(stack, amount, max = Infinity) {
    const cur = this.stacks[stack] || 0;
    this.stacks[stack] = Math.min(max, cur + amount);
    return this.stacks[stack];
  }

  setStack(stack, amount) {
    this.stacks[stack] = Math.max(0, amount);
    return this.stacks[stack];
  }

  getStack(stack) {
    return this.stacks[stack] || 0;
  }
}

module.exports = { CardInstance };
