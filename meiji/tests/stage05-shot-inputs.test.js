import test from 'node:test';
import assert from 'node:assert/strict';
import { renderTaskPrompt } from "./fixtures/ai.js";
import { taskNodeInput } from '../server/handlers/node-inputs.js';
import { prepareContent } from '../server/handlers/content.js';
import { emptyCharacterModel } from '../shared/models/character_model.js';
import { snapshotFixture, taskFixture } from './fixtures/project.js';

const fields = ['title', 'id', 'duration_seconds', 'shot_scale', 'hook', 'body', 'continuity_transition', 'reference_anchor', 'audio_arrangement', 'on_screen_characters', 'background_characters'];
for (const suffix of ['generate', 'regenerate']) test(`镜头表${suffix}返回与现行 dots 一致的字段`, async () => {
  const snapshot = snapshotFixture(), project = snapshot.project, episode = project.episodes[0];
  const character = emptyCharacterModel({ name: '周巡检', position: '军中巡检', age_range: '四十岁', voice: '不参与镜头依赖的声线标记' });
  character.costume_images[0].address = '不参与镜头依赖的图片地址.png';
  character.costume_images[0].node_state.status = 'generated';
  project.character_library.characters = [character];
  const task = taskFixture(project, 'shots', episode.id);
  const rendered = renderTaskPrompt(snapshot, task, null, suffix);
  assert.match(rendered.system, /本集故事小段/);
  assert.match(rendered.messages[1].content, /周巡检/);
  assert.match(rendered.messages[1].content, /四十岁/);
  assert.doesNotMatch(rendered.messages[1].content, /has_image|costume_images|不参与镜头依赖/);
  assert.doesNotMatch(rendered.system + rendered.user, /本集资产/);
  assert.deepEqual(Object.keys(rendered.output.structure.shots[0]).sort(), [...fields].sort());
  if (suffix === 'regenerate') assert.match(rendered.user, /待修订表/);
});

test('镜头表保留 dots 全部正文资料并由程序维护身份', () => {
  const snapshot = snapshotFixture(), project = snapshot.project, episode = project.episodes[0];
  const original = episode.shot_list.shots[0];
  const row = Object.fromEntries(fields.map(key => [key, original[key]]));
  row.title = '开门'; row.body = '人物推门进入。'; row.shot_scale = '中景';
  row.reference_anchor.fixed_landmark = '木门';
  const content = prepareContent(snapshot, taskFixture(project, 'shots', episode.id), { shots: [row] });
  assert.equal(content.shots[0].id, original.id);
  assert.equal(content.shots[0].sequence, 1);
  for (const key of fields) assert.deepEqual(content.shots[0][key], row[key]);
});


test('修订意见去重，重复的任务意见与程序审核原因仅出现一次', () => {
  const snapshot = snapshotFixture(), episode = snapshot.project.episodes[0];
  const task = taskFixture(snapshot.project, 'shots', episode.id, { opinion: '镜头总时长需等于小段合计' });
  snapshot.steps = [{ task_id: task.id, kind: 'review', seq: 2, step_status: 'rejected', result: { 原因: task.opinion } }];
  const input = taskNodeInput(snapshot, task, null, 'regenerate', { kind:'revise', seq:3 });
  assert.equal(input.opinion, task.opinion);
});
