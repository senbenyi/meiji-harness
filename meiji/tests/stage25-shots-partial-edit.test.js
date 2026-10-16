import test from 'node:test';
import assert from 'node:assert/strict';
import { snapshotFixture, taskFixture } from './fixtures/project.js';
import { commitContent } from '../server/handlers/content.js';
import { expireDownstream, isNodeCurrent } from '../shared/node-dependencies.js';

for (const changed of [0, 1]) test(`修改镜头${changed + 1}的转场只使实际输入及后镜交接受影响的文本过期`, () => {
  const snapshot = snapshotFixture(), e = snapshot.project.episodes[0];
  const before = structuredClone(e.shot_list.shots);
  const table = structuredClone(e.shot_list);
  table.shots[changed].continuity_transition = '明确切回此前的临别场面，后续保持同一回叙。';
  const task = taskFixture(snapshot.project, 'shots', e.id, { action: 'manual_edit' });
  commitContent(snapshot, task, table, { passed: true });
  expireDownstream(snapshot, 'shots', e.id);
  assert.ok(isNodeCurrent(snapshot, 'shots', e.id));
  for (const [i, shot] of e.shot_list.shots.entries()) {
    if (i < changed) {
      assert.ok(isNodeCurrent(snapshot, 'seconds', shot.id));
      assert.ok(isNodeCurrent(snapshot, 'storyboard', shot.id));
      assert.deepEqual(shot.seconds_storyboard, before[i].seconds_storyboard);
      assert.deepEqual(shot.text_to_video_prompt, before[i].text_to_video_prompt);
    } else {
      assert.equal(shot.seconds_storyboard.node_state.status, 'expired');
      assert.equal(shot.text_to_video_prompt.node_state.status, 'expired');
      assert.equal(isNodeCurrent(snapshot, 'seconds', shot.id), false);
    }
  }
});
