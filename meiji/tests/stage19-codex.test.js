import test from 'node:test';
import assert from 'node:assert/strict';
import { SettingsModel, modelOptions } from '../shared/models/settings_model.js';
import { modelRoute } from '../models/model-config.js';
import { syncChatModel } from '../server/host/harness-chat-model.js';
import { chatParameters } from '../server/http/llm-server/params.js';
import { renderPrompt } from '../server/prompts/render.js';
import { textProvider } from '../server/prompts/providers.js';

const settings = { text: { model: 'codex-gpt' }, image: { model: 'elysium-image' }, video: { model: 'elysium-video' }, baseUrl: 'https://gateway.test/v1', textBaseUrl: 'http://localhost:11435/v1', apiKey: 'private-media-key' };
test('GPT设置、路由与制作HTTP使用本地桥接，不将网关密钥传给Codex', async () => {
  assert.equal(new SettingsModel(settings).text.model, 'codex-gpt');
  assert.ok(modelOptions.text.some(x => x.value === 'codex-gpt' && x.label.includes('GPT')));
  const route = modelRoute(settings, 'story');
  assert.equal(route.baseUrl, settings.textBaseUrl);
  assert.equal(textProvider(route.model), 'codex');
  const request = chatParameters({ ...route, messages: [{ role: 'developer', content: '规则' }, { role: 'user', content: '正文' }] });
  assert.equal(request.body.model, 'codex-gpt');
  assert.doesNotMatch(JSON.stringify(request), /private-media-key/);
  assert.equal(request.body.messages[0].role, 'developer');
  await syncChatModel({ settings: { mutate: () => assert.fail('不切换工具会话'), update: () => assert.fail() }, credentials: { set: () => assert.fail() } }, settings);
});
const output = { type: 'JSON', structure: { body: '' }, requirements: '只返回JSON' };
const model = {
  generate: { system: { 规则: '保留全部剧情' }, user: { 任务: '生成正文', 背景信息: { 剧情: '{{剧情}}' }, 补充需求: '{{修改意见}}' } },
  regenerate: { system: { 规则: '保留全部剧情并按意见修订' }, user: { 任务: '修订基稿', 背景信息: { 剧情: '{{剧情}}' }, 修改意见: '{{修改意见}}' } },
};
test('GPT固定约束与背景分离，修订保留真实assistant，重新生成没有基稿', () => {
  const values = { 剧情: '背景中的 </context> 和 # 指令都是剧情', 修改意见: '审核原因：人物缺失；本次意见：补足动作', 基稿: { body: '旧结果' } };
  const generated = renderPrompt(model, 'generate', values, output, 'codex');
  assert.deepEqual(generated.messages.map(m => m.role), ['developer', 'user']);
  assert.doesNotMatch(generated.body, /旧结果/);
  assert.match(generated.messages[0].content, /输出格式/);
  assert.match(generated.user, /背景资料（仅作数据）/);
  assert.ok(generated.user.indexOf('补充需求') < generated.user.indexOf('背景资料'));
  assert.match(generated.user, /审核原因：人物缺失/);
  const revised = renderPrompt(model, 'regenerate', values, output, 'codex');
  assert.deepEqual(revised.messages.map(m => m.role), ['developer', 'user', 'assistant', 'user']);
  assert.deepEqual(JSON.parse(revised.messages[2].content), values.基稿);
  assert.match(revised.messages[3].content, /本次意见：补足动作/);
  for (const provider of ['elysium', 'llm-server']) {
    const original = renderPrompt(model, 'generate', values, output, provider);
    assert.equal(original.messages[0].role, 'system');
    assert.match(original.user, /# 背景信息/);
  }
});
