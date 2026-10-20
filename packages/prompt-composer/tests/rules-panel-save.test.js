import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { RulesModel } from '../src/index.js';
import { renderRulesPanel } from '../src/ui/rules-panel.js';

const currentBases = { generate: '当前生成', revise: '当前修订', review: '当前审核' };
const settle = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; }); return { promise, resolve, reject }; };
function mount(t, options = {}, model = new RulesModel({ supports_supplement: true, rules: { generate: { base: '旧基础', supplement: '已保存' } } })) {
  const dom = new JSDOM('<main></main>');
  const host = renderRulesPanel(model, { document: dom.window.document, currentBases, ...options });
  dom.window.document.querySelector('main').append(host);
  const root = host.shadowRoot;
  t.after(() => dom.window.close());
  return { root, model, dom, host, area: root.querySelector('[data-action=generate] textarea') };
}
const edit = (area, value, dom) => { area.value = value; area.dispatchEvent(new dom.window.Event('input')); };
const blur = (area, dom) => area.dispatchEvent(new dom.window.Event('blur'));

test('原规则面板 DOM 顺序与卡片保留，意见仅在修订，基础规则只读不拼旧快照', t => {
  const { root } = mount(t, { opinion: '修改节奏' });
  const page = root.querySelector('.skill-detail-page');
  assert.deepEqual([...page.children].map(node => node.tagName), ['HEADER', 'DIV', 'SECTION', 'SECTION', 'SECTION']);
  for (const action of ['generate', 'revise', 'review']) {
    const section = root.querySelector(`[data-action=${action}]`);
    assert.equal(section.children[0].className, 'settings-group skill-rule-card skill-supplement-card');
    assert.equal(section.children[1].className, 'settings-group skill-rule-card skill-base');
    assert.equal(section.children[0].firstElementChild.className, 'skill-rule-head');
    assert.equal(section.querySelector('textarea').readOnly, true);
  }
  assert.equal(root.querySelectorAll('[aria-label="本次修改意见"]').length, 1);
  assert.equal(root.querySelector('[data-action=revise] [aria-label="本次修改意见"]').value, '修改节奏');
  assert.equal(root.querySelector('[data-field=base] textarea'), null);
  assert.doesNotMatch(root.textContent, /旧基础/);
});

test('编辑仅草稿，失焦保存由回调持久化并更新同一原 Model；不变值不重复保存', async t => {
  const model = new RulesModel({ supports_supplement: true, rules: { generate: { supplement: '已保存' } } });
  const owner = { rules: model }, events = [], drafts = [], persisted = [];
  const { area, dom } = mount(t, { onChange: event => drafts.push(event), onSave: async event => {
    events.push(event); persisted.push(event.value); model.setSupplement(event.action, event.value);
  } }, model);
  edit(area, '新补充', dom);
  assert.equal(owner.rules.rules.generate.supplement, '已保存'); assert.equal(events.length, 0);
  assert.deepEqual(drafts, [{ action: 'generate', field: 'supplement', value: '新补充' }]);
  blur(area, dom); await settle();
  assert.deepEqual(events, [{ action: 'generate', field: 'supplement', value: '新补充', previousValue: '已保存' }]);
  assert.equal(owner.rules.rules.generate.supplement, '新补充'); assert.deepEqual(persisted, ['新补充']);
  blur(area, dom); await settle(); assert.equal(events.length, 1);
});

test('保存回调不修改 Model 时 UI 不越权写入；失败恢复保存值并显示错误', async t => {
  let fail = false;
  const { root, model, area, dom } = mount(t, { onSave: async () => { if (fail) throw Error('磁盘不可用'); } });
  edit(area, '回调接受的值', dom); blur(area, dom); await settle();
  assert.equal(model.rules.generate.supplement, '已保存');
  fail = true; edit(area, '失败草稿', dom); blur(area, dom); await settle();
  assert.equal(area.value, '回调接受的值'); assert.match(root.textContent, /保存失败：磁盘不可用/);
  assert.equal(model.rules.generate.supplement, '已保存');
});

test('同字段异步保存串行，旧请求失败不覆盖新草稿，下一次回调基线正确', async t => {
  const first = deferred(), second = deferred(), events = [];
  const { area, dom } = mount(t, { onSave: event => { events.push(event); return events.length === 1 ? first.promise : second.promise; } });
  edit(area, '第一稿', dom); blur(area, dom); await settle();
  edit(area, '第二稿', dom); blur(area, dom); await settle();
  assert.equal(events.length, 1); first.reject(Error('第一稿失败')); await settle();
  assert.equal(area.value, '第二稿'); assert.equal(events.length, 2);
  assert.equal(events[1].previousValue, '已保存');
  second.resolve(); await settle(); assert.equal(area.value, '第二稿');
  assert.equal(area.getAttribute('aria-busy'), null);
});

test('保存期间继续输入保留新草稿，成功后下次保存基于前次已保存内容', async t => {
  const gate = deferred(), events = [];
  const { area, dom } = mount(t, { onSave: event => { events.push(event); return events.length === 1 ? gate.promise : undefined; } });
  edit(area, '第一稿', dom); blur(area, dom); await settle();
  edit(area, '第二稿', dom); blur(area, dom); gate.resolve(); await settle();
  assert.equal(area.value, '第二稿'); assert.equal(events[1].previousValue, '第一稿');
});

test('复制读取正在编辑的原文，不依赖旧快照；三个动作保存与意见独立', async t => {
  const events = [], opinions = [], copies = [];
  const { root, area, dom } = mount(t, { opinion: '旧意见', onSave: event => events.push(event), onOpinionSave: event => opinions.push(event), copyText: async text => copies.push(text) });
  edit(area, '未保存草稿', dom);
  root.querySelector('[data-action=generate] [aria-label="复制补充规则"]').click(); await settle();
  assert.deepEqual(copies, ['未保存草稿']);
  const review = root.querySelector('[data-action=review] textarea');
  edit(review, '审核补充', dom); blur(review, dom); await settle(); assert.equal(events[0].action, 'review');
  const opinion = root.querySelector('[aria-label="本次修改意见"]');
  edit(opinion, '新意见', dom); blur(opinion, dom); await settle();
  assert.deepEqual(opinions, [{ action: 'revise', field: 'opinion', value: '新意见', previousValue: '旧意见' }]);
  assert.equal(events.length, 1);
});

test('异步加载失败可重试，恢复当前规则且不拼接基础快照', async t => {
  let calls = 0;
  const { root } = mount(t, { loadCurrentBases: async () => { if (++calls === 1) throw Error('网络不可用'); return currentBases; } });
  assert.match(root.textContent, /正在读取/); await settle();
  assert.match(root.textContent, /网络不可用/);
  [...root.querySelectorAll('button')].find(node => node.textContent === '重新加载').click(); await settle();
  assert.equal(calls, 2); assert.equal(root.querySelector('[data-action=generate] pre').textContent, '当前生成');
  assert.doesNotMatch(root.textContent, /旧基础/);
});

test('未启用补充能力不创建任何规则编辑入口，回调不能越过能力开关', t => {
  const { root } = mount(t, { onSave: () => { throw Error('不应调用'); } }, new RulesModel());
  assert.equal(root.querySelector('textarea:not([readonly])'), null);
  assert.equal(root.querySelector('[data-field=supplement]'), null);
});
