import test from 'node:test';
import assert from 'node:assert/strict';
import { composeNodePrompt } from '../server/http/ai-routes.js';
import seconds from '../server/http/nodes/seconds.js';
import { sampleInput } from './fixtures/ai.js';

for (const model of ['qwen3.5:27b', 'codex-gpt']) test(`${model}审核保留完整候选JSON，空字段与台词不丢失或二次展开`, () => {
  const candidate = {
    end_state: '人物站在门边。', pending_actions: '', pending_dialogue: '', continuing_audio: '',
    storyboard: [{ time_range: '0–1s', action: '人物看向门外。', camera: '', space: '', audio: '', handoff: '', dialogue: [] }],
    evidence: { absent: null, empty: {}, quoted: '他说：“{{不要解释}}”。\n第二行\\原文' },
  };
  const input = { ...sampleInput(seconds.actions.review.input), previous: null, content: candidate };
  const before = structuredClone(input);
  const prompt = composeNodePrompt('seconds', 'review', input, model);
  const data = prompt.user.split('# 待审核内容\n')[1].split(/\n\n# /)[0];
  assert.deepEqual(JSON.parse(data), candidate);
  assert.deepEqual(input, before);
  assert.equal(prompt.messages[0].role, model === 'codex-gpt' ? 'developer' : 'system');
});
