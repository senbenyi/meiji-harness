import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { RulesModel } from '../src/index.js';
import { renderRulesPanel } from '../src/ui/rules-panel.js';

const input = { supports_supplement: true, rules: {
  generate: { base: '旧生成快照', supplement: '生成补充' },
  revise: { base: '旧修订快照', supplement: '修订补充' },
  review: { base: '旧审核快照', supplement: '审核补充' },
} };
const currentBases = { generate: '当前生成', revise: '当前修订', review: '当前审核' };
const setup = (data = input, options = {}) => {
  const dom = new JSDOM('<main></main>');
  const model = new RulesModel(data);
  const host = renderRulesPanel(model, { document: dom.window.document, ...options });
  dom.window.document.querySelector('main').append(host);
  return { dom, model, host, root: host.shadowRoot };
};

test('只传模型展示快照，三动作独立且内容只读，输入保持不变', t => {
  const before = structuredClone(input);
  const { dom, model, root } = setup();
  t.after(() => dom.window.close());
  assert.deepEqual([...root.querySelectorAll('[role=tab]')].map(n => n.textContent), ['生成规则', '修订规则', '审核规则']);
  for (const action of ['generate', 'revise', 'review']) {
    const section = root.querySelector(`[data-action=${action}]`);
    assert.equal(section.hidden, action !== 'generate');
    assert.equal(section.querySelector('[data-field=base] h3').textContent, '基础规则快照');
    assert.equal(section.querySelector('[data-field=base] pre').textContent, input.rules[action].base);
    assert.equal(section.querySelector('[data-field=supplement] textarea').value, input.rules[action].supplement);
  }
  assert.match(root.textContent, /不代表当前执行规则/);
  assert.ok([...root.querySelectorAll('textarea')].every(area => area.readOnly));
  assert.deepEqual(model.toJSON(), before);
  assert.deepEqual(input, before);
});

test('当前规则模式不展示旧快照，缺少任一动作当前规则时明确失败', t => {
  const { dom, root } = setup(input, { currentBases });
  t.after(() => dom.window.close());
  for (const action of ['generate', 'revise', 'review']) {
    assert.equal(root.querySelector(`[data-action=${action}] [data-field=base] pre`).textContent, currentBases[action]);
  }
  assert.doesNotMatch(root.textContent, /旧.*快照/);
  assert.throws(() => renderRulesPanel(input, { document: dom.window.document, currentBases: { generate: '当前' } }), { code: 'INVALID_RULES' });
  assert.throws(() => renderRulesPanel(input, { currentBases: null }), TypeError);
});

test('关闭支持后完全隐藏补充区，不泄露已保存的补充内容，允许直接传 JSON', t => {
  const dom = new JSDOM();
  t.after(() => dom.window.close());
  const host = renderRulesPanel({ ...input, supports_supplement: false }, { document: dom.window.document });
  assert.equal(host.shadowRoot.querySelector('[data-field=supplement]'), null);
  assert.doesNotMatch(host.shadowRoot.textContent, /生成补充|审核补充|修订补充/);
});

test('标签点击与键盘导航同步 aria、焦点及显隐；多面板互不干扰', t => {
  const { dom, root } = setup();
  t.after(() => dom.window.close());
  const other = renderRulesPanel(input, { document: dom.window.document });
  dom.window.document.body.append(other);
  const tabs = [...root.querySelectorAll('[role=tab]')];
  tabs[1].click();
  assert.equal(root.querySelector('[data-action=revise]').hidden, false);
  assert.equal(tabs[1].getAttribute('aria-selected'), 'true');
  tabs[1].dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'End', cancelable: true }));
  assert.equal(root.activeElement, tabs[2]);
  tabs[2].dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowRight', cancelable: true }));
  assert.equal(root.activeElement, tabs[0]);
  tabs[0].dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowLeft', cancelable: true }));
  assert.equal(root.activeElement, tabs[2]);
  tabs[2].dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Home', cancelable: true }));
  assert.equal(root.activeElement, tabs[0]);
  assert.equal(other.shadowRoot.querySelector('[data-action=generate]').hidden, false);
  for (const tab of tabs) {
    const section = root.getElementById(tab.getAttribute('aria-controls'));
    assert.equal(section.getAttribute('aria-labelledby'), tab.id);
  }
});

test('复制使用准确原文，失败可重试，不修改其他卡片或动作', async t => {
  const copies = [], notifications = [];
  let fail = true;
  const { dom, root } = setup(input, { currentBases, onNotify: message => notifications.push(message), copyText: async text => {
    if (fail) throw Error('clipboard denied');
    copies.push(text);
  } });
  t.after(() => dom.window.close());
  const copy = root.querySelector('[data-action=generate] [data-field=base] button');
  copy.click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(copy.disabled, false);
  assert.equal(copy.textContent, '复制'); assert.match(notifications.at(-1), /复制失败/);
  fail = false;
  copy.click();
  root.querySelector('[data-action=review] [data-field=supplement] button').click();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(copies, ['当前生成', '审核补充']);
  assert.equal(copy.textContent, '复制'); assert.match(notifications.at(-1), /已复制/);
});

test('HTML 文本安全展示，空规则与返回回调均可用，样式封装在 Shadow DOM', t => {
  let backs = 0;
  const value = '<img src=x onerror="alert(1)">\n{{literal}}';
  const { dom, host, root } = setup({ rules: { generate: { base: value } } }, { onBack: () => backs++, title: '<任务规则>' });
  t.after(() => dom.window.close());
  assert.equal(root.querySelector('img'), null);
  assert.equal(root.querySelector('[data-field=base] pre').textContent, value);
  assert.equal(root.querySelector('h2').textContent, '<任务规则>');
  assert.match(root.querySelector('[data-action=review] pre').textContent, /暂无基础规则快照/);
  root.querySelector('header button').click();
  assert.equal(backs, 1);
  assert.ok(root.querySelector('style'));
  assert.equal(host.querySelector('style'), null);
});
