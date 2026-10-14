import test from 'node:test';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAppRuntime } from '../server/runtime/app-runtime.js';
import { projectFixture } from './fixtures/project.js';

for (const state of ['idle', 'queued', 'running']) {
  test(`项目删除不受 ${state} 进度限制，取消执行并清除绑定`, async () => {
    const home = await mkdtemp(join(tmpdir(), 'meiji-delete-runtime-'));
    let release, started, aborted, signal;
    const wait = new Promise(r => { release = r; });
    const entered = new Promise(r => { started = r; });
    const cancelled = new Promise(r => { aborted = r; });
    const runtime = await createAppRuntime({ home, gateway: {
      chat: async options => {
        signal = options.signal;
        signal.addEventListener('abort', aborted, { once: true });
        started();
        await wait;
        return '晚到结果不能恢复项目';
      },
    } });
    const project = projectFixture(), other = projectFixture(), session = `session-${randomUUID()}`;
    const model = await runtime.repository.create(project);
    await runtime.repository.create(other);
    await runtime.bindings.bind(session, project.id);
    const submit = request_id => runtime.tasks.command({ type: 'submit', project_id: project.id,
      request_id, business_type: 'project-summary', target_id: project.id, action: 'regenerate' });
    try {
      if (state === 'queued') await model.update('pause', {}, s => { s.runtime.queue_stopped = true; return {}; });
      if (state !== 'idle') await submit('before-delete');
      if (state === 'running') await entered;
      const deletion = runtime.projectCommand({ type: 'delete', project_id: project.id }, session);
      if (state === 'running') {
        await cancelled;
        assert.equal(signal.aborted, true);
        await assert.rejects(submit('during-delete'), /正在删除/);
        assert.equal(model.read().tasks[0].task_status, 'cancelled');
        release();
      }
      assert.deepEqual(await deletion, { deleted: true });
      assert.equal(await runtime.bindings.projectForSession(session), null);
      await assert.rejects(runtime.repository.open(project.id), /不存在/);
      await assert.rejects(model.update('late-write', {}, () => ({})), /不存在/);
      assert.deepEqual((await runtime.repository.list()).map(p => p.id), [other.id]);
    } finally {
      release();
      await runtime.dispose();
      await rm(home, { recursive: true, force: true });
    }
  });
}
