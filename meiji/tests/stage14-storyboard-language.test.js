import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { composeNodePrompt } from '../server/http/ai-routes.js';
import { createAppRuntime } from '../server/runtime/app-runtime.js';
import { modelStore } from '../server/data/model-settings.js';
import { projectFixture } from './fixtures/project.js';
import { config, sampleInput } from './fixtures/ai.js';
import storyboard from '../server/http/nodes/storyboard.js';

const sections = ['integrated_multimodal_description', 'overall_soundscape', 'non_diegetic_music'];
const body = language => `${sections[0]}:\n${language === 'zh-CN' ? '摄影机跟随人物走到门边。' : 'The camera follows the person to the door.'} (S1) <d>你好</d>\n\n${sections[1]}:\n${language === 'zh-CN' ? '脚步声持续。' : 'Footsteps continue.'}\n\n${sections[2]}:\nN/A`;

for (const [language, name] of [['zh-CN', '简体中文'], ['en', 'English（英文）']]) {
  test(`分镜提示词${name}生成、修订、审核无固定英文冲突，保留段名与台词规则`, () => {
    for (const model of ['qwen3.5:27b', 'codex-gpt']) {
      for (const [action, contract] of Object.entries(storyboard.actions)) {
        const input = { ...sampleInput(contract.input), language, content: body(language) };
        if (action === 'generate') delete input.content;
        const prompt = composeNodePrompt('storyboard', action, input, model);
        assert.ok(prompt.system.includes(`画面描述、运镜、声景和配乐说明均使用${name}`));
        assert.ok(prompt.system.includes(`运镜用${name}写完整动作描述`));
        assert.doesNotMatch(prompt.system, /画面描述使用英文|完整英文动作|\{\{输出语言\}\}/);
        assert.match(prompt.system, /对白、旁白、心声、歌词及画面文字保留原文/);
        for (const marker of [...sections, '(S1)', '(S2)', '<d>', 'N/A']) assert.ok(prompt.system.includes(marker));
        if (action !== 'review') assert.deepEqual(prompt.output.sections, sections);
        if (action === 'regenerate') assert.equal(prompt.messages[2].content, body(language));
        if (action === 'review') assert.ok(prompt.user.includes(`自然语言与${name}一致`));
      }
    }
  });
}

test('真实设置读取链将中英文选择传入分镜提示词生成、修订及审核，不改固定段名', async () => {
  const home = await mkdtemp(join(tmpdir(), 'meiji-storyboard-language-'));
  let runtime, language = 'zh-CN';
  const calls = [];
  try {
    await modelStore(home).write({ ...config, output_language: language });
    runtime = await createAppRuntime({ home, gateway: { chat: async options => {
      assert.equal(options.trace.input.language, language);
      assert.ok(options.messages[0].content.includes(`均使用${language === 'zh-CN' ? '简体中文' : 'English（英文）'}`));
      assert.doesNotMatch(options.messages[0].content, /画面描述使用英文|完整英文动作/);
      calls.push({ language, action: options.trace.action, messages: structuredClone(options.messages) });
      return options.trace.action === 'review' ? { 是否通过: true, 原因: '' } : body(language);
    } } });
    const project = projectFixture(), shot = project.episodes[0].shot_list.shots[0];
    const stored = await runtime.repository.create(project);
    for (const model of ['qwen3.5:27b', 'codex-gpt']) {
      for (const selected of ['zh-CN', 'en']) {
        language = selected;
        const kept = structuredClone(stored.readAll().project.episodes[0].shot_list.shots[0].text_to_video_prompt);
        await runtime.models.write({ ...config, output_language: language, text: { model } });
        assert.deepEqual(stored.readAll().project.episodes[0].shot_list.shots[0].text_to_video_prompt, kept);
        for (const action of ['regenerate', 'revise']) {
          const start = calls.length;
          const accepted = await runtime.tasks.command({ type: 'submit', project_id: project.id,
            request_id: `${model}-${language}-${action}`, business_type: 'storyboard', target_id: shot.id,
            action, ...(action === 'revise' ? { opinion: '保持原事件，修正表达' } : {}) });
          await runtime.tasks.idle(project.id);
          const snapshot = stored.readAll(), task = snapshot.tasks.find(t => t.id === accepted.task_id);
          assert.equal(task.task_status, 'completed', task.end_reason);
          assert.deepEqual(calls.slice(start).map(call => call.action), [action === 'revise' ? 'regenerate' : 'generate', 'review']);
          const result = snapshot.project.episodes[0].shot_list.shots[0].text_to_video_prompt;
          assert.ok(result.integrated_multimodal_description.includes(language === 'zh-CN' ? '摄影机跟随' : 'The camera follows'));
          assert.ok(result.integrated_multimodal_description.includes('<d>你好</d>'));
          assert.equal(result.non_diegetic_music, 'N/A');
        }
      }
    }
  } finally { await runtime?.dispose(); await rm(home, { recursive: true, force: true }); }
});
