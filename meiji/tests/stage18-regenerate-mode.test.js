import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ModelRepository } from '../server/data/model-repository.js';
import { TaskService } from '../server/flow/tasks/task-manager.js';
import { createHandlerRegistry } from '../server/handlers/handler-registry.js';
import { commitContent } from '../server/handlers/content.js';
import { createTestTextHandler } from './fixtures/ai.js';
import { projectFixture, snapshotFixture, taskFixture } from './fixtures/project.js';
import { validateCommand } from '../shared/task_contract.js';

for (const action of ['generate', 'regenerate', 'revise'])
  test(`${action} 明确选择首轮消息模式，自动修订只引用本轮候选`, async () => {
    const root = await mkdtemp(join(tmpdir(), 'meiji-regenerate-mode-'));
    const repository = new ModelRepository(root), project = projectFixture();
    project.project_summary.body = '上次完整结果独有标记';
    project.project_summary.node_state.status = 'rejected';
    project.project_summary.node_state.reason = '旧审核意见';
    if (action === 'generate') {
      project.project_summary.body = '';
      project.project_summary.node_state.status = 'empty';
      project.project_summary.node_state.reason = '';
    }
    const model = await repository.create(project), requests = [];
    let reviews = 0;
    const text = createTestTextHandler({ chat: async ({ step, messages }) => {
      requests.push({ kind: step.kind, messages: structuredClone(messages) });
      if (step.kind === 'review') return { 是否通过: ++reviews > 1, 原因: reviews === 1 ? '本轮修订原因' : '' };
      return step.kind === 'revise' ? '修订完成的结果' : '本轮新候选独有标记';
    } });
    const service = new TaskService({ repository, commitOutput: commitContent, execute: createHandlerRegistry({ text }) });
    try {
      const command = { type: 'submit', project_id: project.id, business_type: 'project-summary', target_id: project.id, action, opinion: '本次用户要求', request_id: action };
      const { task_id } = await service.command(command);
      await service.idle(project.id);
      const snapshot = model.readAll();
      assert.equal(snapshot.tasks.find(task => task.id === task_id).task_status, 'completed');
      const first = requests[0].messages;
      assert.deepEqual(first.map(m => m.role), action === 'revise' ? ['system', 'user', 'assistant', 'user'] : ['system', 'user']);
      assert.match(first.at(-1).content, /本次用户要求/);
      if (action !== 'generate') {
        assert.match(first.at(-1).content, /旧审核意见/);
        assert.equal(first.at(-1).content.split('旧审核意见').length - 1, 1);
      }
      if (action === 'revise') {
        assert.equal(first[2].content, '上次完整结果独有标记');
        assert.doesNotMatch(first[1].content + first[3].content, /上次完整结果独有标记/);
        assert.match(snapshot.tasks.find(task => task.id === task_id).name, /原结果修订/);
      } else assert.doesNotMatch(JSON.stringify(first), /上次完整结果独有标记|# 基稿|# 待修订内容/);
      const revision = requests.find(request => request.kind === 'revise').messages;
      assert.deepEqual(revision.map(m => m.role), ['system', 'user', 'assistant', 'user']);
      assert.equal(revision[2].content, '本轮新候选独有标记');
      assert.match(revision[3].content, /本轮修订原因/);
      assert.doesNotMatch(JSON.stringify(revision), /上次完整结果独有标记/);
    } finally { await service.dispose(); await repository.close(); await rm(root, { recursive: true, force: true }); }
  });

for (const action of ['regenerate', 'revise'])
  test(`镜头表 ${action} 实际请求不混入另一种模式`, async () => {
    const snapshot = snapshotFixture(), episode = snapshot.project.episodes[0];
    episode.shot_list.shots[0].body = '旧镜头正文独有标记';
    const task = taskFixture(snapshot.project, 'shots', episode.id, { action, opinion: '本次镜头要求' });
    const fields = ['title', 'id', 'duration_seconds', 'shot_scale', 'hook', 'body', 'continuity_transition', 'reference_anchor', 'audio_arrangement', 'on_screen_characters', 'background_characters'];
    let sent;
    const handler = createTestTextHandler({ chat: async ({ messages }) => {
      sent = messages;
      return { shots: episode.shot_list.shots.map(shot => Object.fromEntries(fields.map(key => [key, shot[key]]))) };
    } });
    await handler({ snapshot, task, step: { kind: 'generate', seq: 2 } });
    assert.deepEqual(sent.map(m => m.role), action === 'revise' ? ['system', 'user', 'assistant', 'user'] : ['system', 'user']);
    assert.match(sent.at(-1).content, /本次镜头要求/);
    if (action === 'revise') {
      assert.match(sent[2].content, /旧镜头正文独有标记/);
      assert.doesNotMatch(sent[1].content + sent[3].content, /旧镜头正文独有标记/);
    } else assert.doesNotMatch(JSON.stringify(sent), /旧镜头正文独有标记|待修订镜头表|# 基稿/);
  });

test('原结果修订只允许文本及非空意见，成片组不接受 revise', () => {
  const p = projectFixture(), e = p.episodes[0];
  const command = { type: 'submit', project_id: p.id, business_type: 'outline', target_id: e.id, action: 'revise', opinion: '补足动作', request_id: 'revise' };
  assert.doesNotThrow(() => validateCommand(command));
  assert.throws(() => validateCommand({ ...command, opinion: ' ' }), /修改意见/);
  assert.throws(() => validateCommand({ ...command, business_type: 'video', target_id: e.shot_list.shots[0].id }), /仅支持文本/);
  assert.throws(() => validateCommand({ type: 'submit-group', project_id: p.id, episode_id: e.id, group_type: 'episode-film', action: 'revise', opinion: '修改', request_id: 'group' }), /command.action/);
});
