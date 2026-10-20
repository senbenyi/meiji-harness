const ACTIONS = ['generate', 'review', 'revise'];

function invalid(path, message) {
  throw Object.assign(new TypeError(`${path}：${message}`), { code: 'INVALID_RULES', path });
}

function object(value, path, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    invalid(path, '需为普通对象');
  }
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) invalid(`${path}.${key}`, '未知字段');
  }
}

function text(value, path) {
  if (typeof value !== 'string') invalid(path, '需为文本');
  return value;
}

/** 只承载规则数据；base 为快照，执行规则由 resolve 的调用方提供。 */
export class RulesModel {
  #data;

  constructor(input = {}) {
    object(input, 'model', ['supports_supplement', 'rules']);
    const supports = Object.hasOwn(input, 'supports_supplement') ? input.supports_supplement : false;
    if (typeof supports !== 'boolean') invalid('supports_supplement', '需为布尔值');
    const rules = Object.hasOwn(input, 'rules') ? input.rules : {};
    object(rules, 'rules', ACTIONS);
    const normalized = {};
    for (const action of ACTIONS) {
      const rule = Object.hasOwn(rules, action) ? rules[action] : {};
      object(rule, `rules.${action}`, ['base', 'supplement']);
      normalized[action] = {
        base: Object.hasOwn(rule, 'base') ? text(rule.base, `rules.${action}.base`) : '',
        supplement: Object.hasOwn(rule, 'supplement') ? text(rule.supplement, `rules.${action}.supplement`) : '',
      };
    }
    this.#data = { supports_supplement: supports, rules: normalized };
  }

  get supports_supplement() {
    return this.#data.supports_supplement;
  }

  get rules() {
    return structuredClone(this.#data.rules);
  }

  toJSON() {
    return structuredClone(this.#data);
  }

  /** 由接入方在保存成功后调用；显式更新同一实例，不开放基础快照编辑。 */
  setSupplement(action, value) {
    if (!ACTIONS.includes(action)) invalid('action', '需为 generate、review 或 revise');
    if (!this.#data.supports_supplement) invalid('supports_supplement', '当前模型不支持补充规则');
    this.#data.rules[action].supplement = text(value, `rules.${action}.supplement`);
    return this;
  }

  /** 仅解析选中的动作；必须提供当前基础规则，不回退到保存的快照。 */
  resolve(action, currentBase) {
    if (!ACTIONS.includes(action)) invalid('action', '需为 generate、review 或 revise');
    return {
      base: text(currentBase, 'currentBase'),
      supplement: this.#data.supports_supplement ? this.#data.rules[action].supplement : '',
    };
  }
}
