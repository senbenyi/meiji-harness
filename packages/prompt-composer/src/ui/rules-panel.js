import { RulesModel } from '../rules-model.js';

const ACTIONS = [['generate', '生成规则'], ['revise', '修订规则'], ['review', '审核规则']];
const styles = `
:host { display:block; min-width:0; color:var(--rules-color,#e6e7eb); font:14px/1.65 system-ui,sans-serif; }
* { box-sizing:border-box; }
[hidden] { display:none !important; }
.panel { min-width:0; padding:20px; border:1px solid var(--rules-border,#383a41); border-radius:12px; background:var(--rules-background,#15161b); }
header { display:flex; align-items:center; flex-wrap:wrap; gap:12px; margin-bottom:18px; }
h2 { margin:0; font-size:20px; overflow-wrap:anywhere; }
button { font:inherit; color:inherit; cursor:pointer; padding:7px 13px; border:1px solid var(--rules-border,#383a41); border-radius:7px; background:transparent; }
button:hover { background:var(--rules-card-background,#202127); }
button:focus-visible, [role=tabpanel]:focus-visible { outline:2px solid var(--rules-accent,#a5b4fc); outline-offset:3px; }
button:disabled { cursor:wait; opacity:.6; }
[role=tablist] { display:flex; gap:6px; padding:4px; border:1px solid var(--rules-border,#383a41); border-radius:9px; margin-bottom:16px; }
[role=tab] { flex:1; min-width:0; border-color:transparent; }
[role=tab][aria-selected=true] { color:var(--rules-accent,#c7d2fe); background:var(--rules-selected-background,#303247); border-color:var(--rules-border,#45485d); }
.card { min-width:0; padding:16px; margin-top:12px; border:1px solid var(--rules-border,#383a41); border-radius:9px; background:var(--rules-card-background,#1b1c21); }
.card-head { display:flex; align-items:center; justify-content:space-between; gap:8px; margin-bottom:10px; }
h3 { margin:0; font-size:15px; }
.copy { flex:none; font-size:12px; padding:3px 9px; }
pre { font:inherit; white-space:pre-wrap; overflow-wrap:anywhere; margin:0; }
.note, .empty { color:var(--rules-muted,#a4a6b2); }
.note { margin:14px 0 0; font-size:12px; }
.status { margin:0; font-size:12px; }
.status:empty { display:none; }
@media(max-width:480px) { .panel { padding:12px; } .card { padding:12px; } [role=tab] { padding:7px 4px; font-size:13px; } }
`;

/** 创建独立只读规则面板；返回 HTMLElement，可挂载到任意容器。 */
export function renderRulesPanel(model, {
  title = '规则', currentBases, onBack, copyText, document = globalThis.document,
} = {}) {
  // 允许直接传入 JSON 反序列化数据，校验与默认值仍统一由 Model 处理。
  const data = model instanceof RulesModel ? model : new RulesModel(model);
  const snapshot = data.toJSON();
  const current = currentBases !== undefined;
  if (current && (!currentBases || typeof currentBases !== 'object' || Array.isArray(currentBases))) {
    throw new TypeError('currentBases 需为三动作当前基础规则对象');
  }
  const values = Object.fromEntries(ACTIONS.map(([action]) => [action,
    current ? data.resolve(action, Object.hasOwn(currentBases, action) ? currentBases[action] : undefined) : snapshot.rules[action],
  ]));
  if (!document?.createElement) throw new TypeError('规则面板需要浏览器 document');
  const element = (tag, text = '', className) => {
    const node = document.createElement(tag);
    node.textContent = text;
    if (className) node.className = className;
    return node;
  };
  const button = (text, onClick) => {
    const node = element('button', text);
    node.type = 'button';
    node.onclick = onClick;
    return node;
  };
  const host = element('div');
  const root = host.attachShadow({ mode: 'open' });
  root.append(element('style', styles));
  const panel = element('section', '', 'panel');
  panel.setAttribute('aria-label', title);
  const head = element('header');
  if (onBack) head.append(button('← 返回', onBack));
  head.append(element('h2', title));
  const tabs = element('div');
  tabs.setAttribute('role', 'tablist');
  tabs.setAttribute('aria-label', '规则');
  const status = element('p', '', 'status');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  const write = copyText ?? (text => document.defaultView.navigator.clipboard.writeText(text));
  const card = (title, text, field) => {
    const node = element('section', '', 'card');
    node.dataset.field = field;
    const heading = element('div', '', 'card-head');
    const copy = button('复制', async () => {
      copy.disabled = true;
      try {
        await write(text);
        copy.textContent = '已复制';
        status.textContent = `${title}已复制`;
      } catch {
        copy.textContent = '复制失败，重试';
        status.textContent = `${title}复制失败，请重试`;
      } finally {
        copy.disabled = false;
      }
    });
    copy.className = 'copy';
    copy.setAttribute('aria-label', `复制${title}`);
    heading.append(element('h3', title), copy);
    node.append(heading, element('pre', text || `暂无${title}。`, text ? '' : 'empty'));
    return node;
  };
  const sections = [], buttons = [];
  const select = index => {
    buttons.forEach((tab, i) => {
      tab.setAttribute('aria-selected', String(i === index));
      tab.tabIndex = i === index ? 0 : -1;
      sections[i].hidden = i !== index;
    });
    status.textContent = '';
  };
  for (const [index, [action, label]] of ACTIONS.entries()) {
    const section = element('section');
    section.dataset.action = action;
    section.id = `panel-${action}`;
    section.setAttribute('role', 'tabpanel');
    section.setAttribute('aria-labelledby', `tab-${action}`);
    section.tabIndex = 0;
    if (snapshot.supports_supplement) section.append(card('补充规则', values[action].supplement, 'supplement'));
    section.append(card(current ? '基础规则' : '基础规则快照', values[action].base, 'base'));
    const tab = button(label, () => select(index));
    tab.id = `tab-${action}`;
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-controls', section.id);
    tab.onkeydown = event => {
      let next;
      if (event.key === 'ArrowRight') next = (index + 1) % ACTIONS.length;
      if (event.key === 'ArrowLeft') next = (index + ACTIONS.length - 1) % ACTIONS.length;
      if (event.key === 'Home') next = 0;
      if (event.key === 'End') next = ACTIONS.length - 1;
      if (next === undefined) return;
      event.preventDefault();
      select(next);
      buttons[next].focus();
    };
    buttons.push(tab);
    sections.push(section);
    tabs.append(tab);
  }
  select(0);
  const note = current
    ? '基础规则来自当前代码。各动作规则独立展示，查看不会执行动作。'
    : '当前展示保存的基础规则快照，不代表当前执行规则。';
  panel.append(head, tabs, status, ...sections, element('p', note, 'note'));
  root.append(panel);
  return host;
}
