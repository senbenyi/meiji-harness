import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createAiRoutes } from '../server/http/ai-routes.js';
import { taskNodeInput } from '../server/handlers/node-inputs.js';
import { emptyCharacterModel } from '../shared/models/character_model.js';
import { dependencyHash } from '../shared/node-dependencies.js';
import { snapshotFixture, taskFixture } from './fixtures/project.js';
import { config } from './fixtures/ai.js';

const resultText = 'integrated_multimodal_description:\n黑暗火场中，一只戴消防手套的手推门，画外队长说出<d>保持联系。</d>。\n\noverall_soundscape:\n警报持续。\n\nnon_diegetic_music:\nN/A';
function fixture() {
  const snapshot = snapshotFixture(), shot = snapshot.project.episodes[0].shot_list.shots[0];
  const person = (name, number) => emptyCharacterModel({ name, number, nationality: `${name}国籍哨兵`, height: `${name}身高哨兵`, facial_features: `${name}面部哨兵`, voice: `${name}声线哨兵`,
    costume_images: [{ costume_id: '', address: `https://image-sentinel.test/${name}.png` }],
    reference_image: { address: 'data:image/png;base64,IMAGE_SENTINEL' },
  });
  const visible = person('消防员', 'C01'), voiceOnly = person('队长', 'C02'), unrelated = person('无关人物', 'C03');
  snapshot.project.character_library.characters = [visible, voiceOnly, unrelated];
  shot.on_screen_characters = [{ character_id: visible.id, costume_id: '' }];
  shot.body = '场景背景哨兵：黑暗火场。摄影安排哨兵：固定特写，仅手及袖口入镜。';
  shot.reference_anchor.fixed_landmark = '门框位置哨兵';
  shot.seconds_storyboard.storyboard[0].dialogue = [{ speaker_id: voiceOnly.id, speaker_name: '队长别称', mode: '画外', dialogue_text: '保持联系。' }];
  return { snapshot, shot, visible, voiceOnly, unrelated };
}

test('文本提示词实际HTTP消息含整镜设定和出镜/发声人物文字，两个来源三动作均不带图', async () => {
  let action, received = 0;
  const server = createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    try {
      assert.equal(req.method, 'POST');
      assert.equal(req.url, '/v1/chat/completions');
      const body = JSON.parse(raw);
      assert.ok(body.messages.every(message => typeof message.content === 'string'));
      const prompt = body.messages.map(message => message.content).join('\n');
      for (const marker of ['场景背景哨兵', '摄影安排哨兵', '门框位置哨兵', '消防员国籍哨兵', '消防员身高哨兵', '消防员面部哨兵', '队长声线哨兵', '保持联系。']) assert.ok(prompt.includes(marker), marker);
      assert.doesNotMatch(prompt, /无关人物|image-sentinel|IMAGE_SENTINEL|data:image|image_url|reference_image|costume_images/);
      assert.match(prompt, /本节点仅生成文本提示词/);
      assert.match(prompt, /只有画外声时写明为画外声/);
      received++;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: action === 'review' ? '{"是否通过":true, "类型": "","原因":""}' : resultText } }] }));
    } catch (error) { res.writeHead(500); res.end(JSON.stringify({ message: error.message })); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const { snapshot, shot } = fixture(), task = taskFixture(snapshot.project, 'storyboard', shot.id);
    const saved = structuredClone(snapshot.project);
    for (const model of ['qwen3.5:27b', 'codex-gpt']) {
      const ai = createAiRoutes({ readConfig: async () => ({ ...config, textBaseUrl: `http://127.0.0.1:${server.address().port}/v1`, text: { model } }) });
      for (action of ['generate', 'regenerate', 'review']) {
        const input = taskNodeInput(snapshot, task, resultText, action);
        const response = await ai('storyboard', action, input);
        assert.deepEqual(input.characters.map(person => person.name), ['消防员', '队长']);
        assert.deepEqual(response.result, action === 'review' ? { 是否通过: true, "类型": "", 原因: '' } : resultText);
      }
    }
    assert.equal(received, 6);
    assert.deepEqual(snapshot.project, saved);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});

test('参与角色外貌文字影响最终提示词指纹，图片及无关人物不影响，前置目录保持原样', () => {
  const { snapshot, shot, visible, unrelated } = fixture();
  const hash = () => dependencyHash(snapshot, 'storyboard', shot.id);
  const before = hash();
  visible.reference_image.address = 'other-image.png'; unrelated.facial_features = '无关改动';
  assert.equal(hash(), before);
  visible.facial_features = '新面部特征'; assert.notEqual(hash(), before);
  const task = taskFixture(snapshot.project, 'seconds', shot.id);
  const input = taskNodeInput(snapshot, task, null, 'generate');
  assert.equal(Object.hasOwn(input.characters[0], 'facial_features'), false);
});

test('同一说话人在不同镜头子集及目录重排后使用同一标记，标记进入实际提示词', async () => {
  const { snapshot, shot, visible, voiceOnly } = fixture();
  const { shotTextInputs } = await import('../shared/shot-text-inputs.js');
  const { composeNodePrompt } = await import('../server/http/ai-routes.js');
  const episode = snapshot.project.episodes[0];
  const input = shotTextInputs(snapshot.project, episode, shot, 'storyboard');
  const tags = new Map(input.characters.map(person => [person.id, person.speaker_tag]));
  assert.match(tags.get(visible.id), /^\(S\d+\)$/);
  assert.notEqual(tags.get(visible.id), tags.get(voiceOnly.id));
  const next = structuredClone(shot);
  next.on_screen_characters = [{ character_id: voiceOnly.id, costume_id: '' }];
  next.seconds_storyboard.storyboard.forEach(beat => { beat.dialogue = []; });
  const nextInput = () => shotTextInputs(snapshot.project, episode, next, 'storyboard');
  assert.deepEqual(nextInput().characters.map(person => [person.id, person.speaker_tag]), [[voiceOnly.id, tags.get(voiceOnly.id)]]);
  snapshot.project.character_library.characters.reverse();
  assert.deepEqual(nextInput().characters.map(person => [person.id, person.speaker_tag]), [[voiceOnly.id, tags.get(voiceOnly.id)]]);
  for (const model of ['qwen3.5:27b', 'codex-gpt']) {
    const prompt = composeNodePrompt('storyboard', 'generate', { ...nextInput(), language: 'zh-CN', requirements: '' }, model);
    assert.ok(prompt.user.includes(tags.get(voiceOnly.id)));
    assert.ok(prompt.system.includes('不得按本镜出场顺序重新编号'));
  }
});
