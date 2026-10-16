import test from 'node:test';
import assert from 'node:assert/strict';
import { assertPromptDialogue } from '../shared/dialogue-integrity.js';
import route from '../server/http/nodes/storyboard.js';

const source = (...texts) => ({ storyboard: texts.map(dialogue_text => ({ dialogue: [{ speaker_id: 'a', mode: '画内', dialogue_text }] })) });
const rejects = (node, text) => assert.throws(() => assertPromptDialogue(node, text), error => error.validationKind === 'dialogue-preservation' && /对白完整性/.test(error.message));

test('一句不可按节拍、逗号、省略号、换气或自然段拆成两个标签', () => {
  for (const [first, second] of [['我还有', '话说。'], ['先停，', '再走。'], ['先停……', '再走。'], ['我——', '还有话说。']]) {
    const node = source(first, second);
    rejects(node, `<d>${first}</d>\n停顿，抬手。\n<d>${second}</d>`);
    assert.doesNotThrow(() => assertPromptDialogue(node, `<d>${first}${second}</d>`));
  }
});

test('同一人物连续多句可整体保留，也可在完整句子之间分开', () => {
  const node = source('别走。我还', '有话说！你听见了吗？');
  for (const text of ['<d>别走。我还有话说！你听见了吗？</d>', '<d>别走。</d>抬手。<d>我还有话说！</d>停顿。<d>你听见了吗？</d>'])
    assert.doesNotThrow(() => assertPromptDialogue(node, text));
  rejects(node, '<d>别走。我还有</d><d>话说！你听见了吗？</d>');
});

test('句末标点与闭引号不拆开', () => {
  const node = source('他说“走！”然后关门。');
  assert.doesNotThrow(() => assertPromptDialogue(node, '<d>他说“走！”</d><d>然后关门。</d>'));
  rejects(node, '<d>他说“走！</d><d>”然后关门。</d>');
});

test('小数、英文称谓和首字母缩写不作为拆句边界', () => {
  for (const [first, second] of [['数值为3.', '14。'], ['Dr. ', 'Smith is here.'], ['U.S. ', 'officials arrived.']])
    rejects(source(first, second), `<d>${first}</d><d>${second}</d>`);
  assert.doesNotThrow(() => assertPromptDialogue(source('Wait. Go!'), '<d>Wait.</d><d> Go!</d>'));
});

test('换人可保留被打断的原话，不能把同一人的跨拍字段当换人', () => {
  const node = { storyboard: [{ dialogue: [{ speaker_id: 'a', dialogue_text: '可是我' }, { speaker_id: 'b', dialogue_text: '别说了！' }] }] };
  assert.doesNotThrow(() => assertPromptDialogue(node, '(S1)<d>可是我</d>(S2)<d>别说了！</d>'));
  rejects(source('可是我', '别说了！'), '<d>可是我</d><d>别说了！</d>');
});

test('镜末未结束发言必须完整保留本镜部分，不拆碎、不擅自续写', () => {
  const node = source('我老友麦思敦君乎！余实不能伴汝。', '不但弹丸狭小而已，君已颓龄，难受辛苦，');
  assert.doesNotThrow(() => assertPromptDialogue(node, '<d>我老友麦思敦君乎！</d><d>余实不能伴汝。</d><d>不但弹丸狭小而已，君已颓龄，难受辛苦，</d>'));
  rejects(node, '<d>我老友</d><d>麦思敦君乎！余实不能伴汝。不但弹丸狭小而已，君已颓龄，难受辛苦，</d>');
  rejects(node, '<d>我老友麦思敦君乎！余实不能伴汝。不但弹丸狭小而已，君已颓龄，难受辛苦。</d>');
});

test('空标签不合法，完整原话的逐字校验继续生效', () => {
  for (const text of ['<d></d><d>别走。</d>', '<d>别走</d>', '<d>别走。别走。</d>']) rejects(source('别走。'), text);
});

test('HTTP生成修订均拦截碎片并标为可修订的对白错误', () => {
  for (const action of ['generate', 'regenerate']) {
    const input = { storyboard: source('我还有话说。') };
    const sections = text => `integrated_multimodal_description:\n${text}\noverall_soundscape:\nN/A\nnon_diegetic_music:\nN/A`;
    assert.throws(() => route.validateResult(sections('<d>我还有</d><d>话说。</d>'), input, action), error => error.validationKind === 'dialogue-preservation');
    assert.doesNotThrow(() => route.validateResult(sections('<d>我还有话说。</d>'), input, action));
  }
});
