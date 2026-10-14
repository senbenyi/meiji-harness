import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestTextHandler as createTextHandler } from "./fixtures/ai.js";
import { snapshotFixture, taskFixture } from './fixtures/project.js';

for (const kind of ['generate', 'revise']) {
  test(`角色 ${kind} 接受道具及特征数组，拒绝字符串与非文本成员`, async () => {
    const snapshot = snapshotFixture();
    const task = taskFixture(snapshot.project, 'project-characters', snapshot.project.id);
    const person = { name: '甲', gender: '男', era: '宋代', position: '', age_range: '', body_type: '', hairstyle: '',
      signature_props: ['哨棒', '竹篮'], immutable_traits: ['眉骨分明', '右手虎口旧疤'],
      costumes: [{ name: '短衣', color: '', material: '', props: [] }] };
    let candidate = person;
    const handler = createTextHandler({ chat: async ({ system }) => {
      assert.match(system, /必须为字符串数组/);
      return { characters: [candidate] };
    } });
    const run = () => handler({ snapshot, task, step: { kind, seq: 1 }, record: async () => {} });
    const saved = (await run()).content.characters[0];
    assert.deepEqual(saved.signature_props, person.signature_props);
    assert.deepEqual(saved.immutable_traits, person.immutable_traits);
    assert.deepEqual(saved.costumes[0].props, []);
    for (const field of ['signature_props', 'immutable_traits', 'props']) {
      for (const invalid of ['', '道具', null, [1], [{}]]) {
        candidate = structuredClone(person);
        if (field === 'props') candidate.costumes[0].props = invalid;
        else candidate[field] = invalid;
        await assert.rejects(run, new RegExp(field));
      }
    }
  });
}
