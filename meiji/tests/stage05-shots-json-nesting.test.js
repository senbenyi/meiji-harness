import test from 'node:test';
import assert from 'node:assert/strict';
import shots from '../server/http/nodes/shots.js';
import { composeNodePrompt, validateNodeResult } from '../server/http/ai-routes.js';
import { parseJsonValue } from '../server/prompts/parse-json.js';
import { sampleInput } from './fixtures/ai.js';

test('两个文本来源生成修订均明确锚点闭合顺序，与输出契约同源', () => {
  for (const model of ['qwen3.5:27b', 'codex-gpt']) for (const action of ['generate', 'regenerate']) {
    const prompt = composeNodePrompt('shots', action, sampleInput(shots.actions[action].input), model);
    assert.match(prompt.system, /不能在departed_characters后提前写右花括号/);
    assert.match(prompt.output.requirements, /lighting不得作为镜头根字段/);
    assert.match(prompt.output.requirements, /写完audio_arrangement后才关闭当前镜头对象/);
    assert.deepEqual(Object.keys(prompt.output.structure.shots[0].reference_anchor), ['fixed_landmark', 'character_positions', 'departed_characters', 'lighting']);
  }
});

test('正确完整嵌套及字符串转义可解析，提前闭合错误不被静默修补', () => {
  const content = structuredClone(shots.actions.generate.output.structure);
  content.shots[0].on_screen_characters = [];
  content.shots[0].body = '他说："保持联系"。\n门边有\\标记。';
  const raw = JSON.stringify(content);
  const parsed = parseJsonValue(raw);
  assert.deepEqual(parsed, content);
  assert.doesNotThrow(() => validateNodeResult('shots', 'generate', parsed, {}));
  const broken = raw.replace('"departed_characters":"离场角色","lighting":', '"departed_characters":"离场角色"},"lighting":');
  assert.throws(() => parseJsonValue(broken), error => error.code === 'INVALID_MODEL_JSON');
  const wrongLevel = structuredClone(content), shot = wrongLevel.shots[0];
  shot.lighting = shot.reference_anchor.lighting; delete shot.reference_anchor.lighting;
  assert.throws(() => validateNodeResult('shots', 'generate', wrongLevel, {}), /lighting|缺少字段|未定义/);
});
