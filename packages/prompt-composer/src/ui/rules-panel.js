import { RulesModel } from '../rules-model.js';
import { styles } from './rules-styles.js';

const ACTIONS = [['generate', '生成规则'], ['revise', '修订规则'], ['review', '审核规则']];

/** 原规则面板交互；保存通过回调提交，组件不隐式修改传入 Model。 */
export function renderRulesPanel(model, {
  title = '规则', currentBases, loadCurrentBases, onBack, copyText, onNotify,
  onSave, onChange, opinion, onOpinionSave, baseLabel, ruleNote, document = globalThis.document,
} = {}) {
  const data = model instanceof RulesModel ? model : new RulesModel(model);
  const savedData = data.toJSON();
  const validateBases = bases => {
    if (!bases || typeof bases !== 'object' || Array.isArray(bases)) throw new TypeError('currentBases 需为三动作当前基础规则对象');
    for (const [action] of ACTIONS) data.resolve(action, Object.hasOwn(bases, action) ? bases[action] : undefined);
    return structuredClone(bases);
  };
  if (currentBases !== undefined) currentBases = validateBases(currentBases);
  for (const [name, callback] of Object.entries({ onSave, onChange, onOpinionSave, loadCurrentBases })) {
    if (callback !== undefined && typeof callback !== 'function') throw new TypeError(`${name} 需为函数`);
  }
  if (opinion !== undefined && typeof opinion !== 'string') throw new TypeError('opinion 需为文本');
  if (!document?.createElement) throw new TypeError('规则面板需要浏览器 document');

  const element = (tag, text = '', className) => {
    const node = document.createElement(tag); node.textContent = text;
    if (className) node.className = className;
    return node;
  };
  const button = (label, click) => {
    const node = element('button', label); node.type = 'button'; node.onclick = click; return node;
  };
  const host = element('div'), root = host.attachShadow({ mode: 'open' });
  const page = element('section', '', 'settings-page skill-detail skill-detail-page');
  page.setAttribute('aria-label', title);
  root.append(element('style', styles), page);
  const write = copyText ?? (text => document.defaultView.navigator.clipboard.writeText(text));
  const header = () => {
    const head = element('header', '', 'skill-page-head');
    if (onBack) head.append(button('← 返回', onBack));
    head.append(element('h2', title)); return head;
  };
  function ruleCard(label, className, field) {
    const card = element('section', '', `settings-group skill-rule-card ${className}`);
    card.dataset.field = field;
    const head = element('div', '', 'skill-rule-head');
    const copy = button('复制', async event => {
      event.stopPropagation();
      try {
        const text = [...card.querySelectorAll('pre.skill-text, textarea')]
          .map(node => node.tagName === 'TEXTAREA' ? node.value : node.dataset.empty === 'true' ? '' : node.textContent).join('\n\n');
        await write(text); onNotify?.(`${label}已复制`, { kind: 'success' });
      } catch { onNotify?.(`${label}复制失败，请重试`, { kind: 'error' }); }
    });
    copy.className = 'rules-copy'; copy.setAttribute('aria-label', `复制${label}`);
    copy.setAttribute('aria-live', 'polite');
    head.append(element('h3', label), copy); card.append(head); return card;
  }
  function ruleInput(label, value, action, field, save, showLabel = true) {
    const wrap = element('label', '', 'skill-rule-input');
    if (showLabel) wrap.append(element('span', label));
    const area = element('textarea'); area.value = value; area.readOnly = !save;
    area.setAttribute('aria-label', label);
    const status = element('p', '', 'skill-save-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    let saved = value, chain = Promise.resolve(), revision = 0;
    area.oninput = () => {
      revision++;
      status.textContent = ''; status.classList.remove('error');
      onChange?.({ action, field, value: area.value });
    };
    area.onblur = () => {
      if (!save) return;
      const next = area.value, edited = revision;
      // 每个字段串行保存；上次保存未结束时，继续编辑也不会乱序提交。
      chain = chain.then(async () => {
        if (next === saved) return;
        area.setAttribute('aria-busy', 'true');
        status.classList.remove('error'); status.textContent = '正在保存…';
        try {
          await save({ action, field, value: next, previousValue: saved });
          saved = next;
          if (field === 'supplement') savedData.rules[action].supplement = next;
          if (edited === revision) status.textContent = '已保存';
          else status.textContent = '';
        } catch (error) {
          // 新草稿不能被旧请求的失败覆盖；无后续输入时恢复已保存原文。
          if (edited === revision) area.value = saved;
          status.classList.add('error'); status.textContent = `保存失败：${error?.message || String(error)}`;
        } finally { area.removeAttribute('aria-busy'); }
      });
    };
    wrap.append(area, status); return wrap;
  }

  let epoch = 0, selected = 'generate';
  function render(bases) {
    const current = bases !== undefined;
    const nav = element('div', '', 'tabs'); nav.setAttribute('role', 'tablist'); nav.setAttribute('aria-label', '规则');
    const sections = [], buttons = [];
    const select = index => {
      selected = ACTIONS[index][0];
      buttons.forEach((tab, i) => {
        tab.setAttribute('aria-selected', String(index === i)); tab.tabIndex = index === i ? 0 : -1;
        sections[i].hidden = index !== i;
      });
    };
    for (const [index, [action, label]] of ACTIONS.entries()) {
      const section = element('section', '', 'skill-rule-tab'); section.dataset.action = action; section.dataset.rules = action;
      section.id = `panel-${action}`; section.setAttribute('role', 'tabpanel'); section.setAttribute('aria-labelledby', `tab-${action}`); section.tabIndex = 0;
      if (savedData.supports_supplement) {
        const supplement = ruleCard('补充规则', 'skill-supplement-card', 'supplement');
        supplement.append(ruleInput('补充规则', savedData.rules[action].supplement, action, 'supplement', onSave, false));
        section.append(supplement);
      }
      const base = ruleCard(baseLabel ?? (current ? '基础规则' : '基础规则快照'), 'skill-base', 'base');
      const text = current ? bases[action] : savedData.rules[action].base;
      const pre = element('pre', text || `暂无${current ? '基础规则' : '基础规则快照'}。`, 'skill-text');
      pre.dataset.empty = String(!text); base.append(pre); section.append(base);
      if (action === 'revise' && (opinion !== undefined || onOpinionSave || (current && bases.revise))) {
        section.append(ruleInput('本次修改意见', opinion ?? '', action, 'opinion', onOpinionSave));
      }
      section.append(element('p', ruleNote ?? (current
        ? '基础规则由代码维护；各动作的补充规则独立使用，冲突请调整补充规则。'
        : '当前展示保存的基础规则快照，不代表当前执行规则。'), 'skill-rule-note'));
      const tab = button(label, () => select(index)); tab.id = `tab-${action}`;
      tab.setAttribute('role', 'tab'); tab.setAttribute('aria-controls', section.id);
      tab.onkeydown = event => {
        const next = { ArrowRight: (index + 1) % ACTIONS.length, ArrowLeft: (index + ACTIONS.length - 1) % ACTIONS.length, Home: 0, End: ACTIONS.length - 1 }[event.key];
        if (next === undefined) return;
        event.preventDefault(); select(next); buttons[next].focus();
      };
      sections.push(section); buttons.push(tab); nav.append(tab);
    }
    select(Math.max(0, ACTIONS.findIndex(([action]) => action === selected)));
    page.replaceChildren(header(), nav, ...sections);
  }
  async function loadPage() {
    const token = ++epoch;
    page.replaceChildren(header(), element('p', '正在读取…', 'skill-status'));
    try {
      const bases = validateBases(await loadCurrentBases());
      if (token === epoch) render(bases);
    } catch (error) {
      if (token === epoch) page.replaceChildren(header(), element('p', error?.message || String(error), 'error'), button('重新加载', loadPage));
    }
  }
  if (loadCurrentBases) loadPage(); else render(currentBases);
  return host;
}
