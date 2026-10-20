import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { snapshotFixture } from './fixtures/project.js';
import { taskNodeInput } from '../server/handlers/node-inputs.js';
import { composeNodePrompt } from '../server/http/ai-routes.js';
import { createAppRuntime } from '../server/runtime/app-runtime.js';
import { ModelRepository } from '../server/data/model-repository.js';
import { effectiveRules } from '../shared/ai-node-rules.js';
import { defaultRules } from '../shared/rule-defaults.js';
import { dependencyHash, isNodeCurrent } from '../shared/node-dependencies.js';

test('代码基础规则是执行来源：旧快照被忽略，三动作补充互相隔离且不进入正文', () => {
  const s = snapshotFixture(), e = s.project.episodes[0], node = e.story_outline;
  for (const action of ['generate', 'review', 'revise']) node.rules[action] = {base: `基础哨兵_${action}`, supplement: `补充哨兵_${action}`};
  const before = structuredClone(node.rules), task = { business_type:'outline', target_id:e.id, opinion:'本次意见' };
  for (const action of ['generate', 'review', 'regenerate']) {
    const key = action === 'regenerate' ? 'revise' : action;
    const input = taskNodeInput(s, task, node, action);
    const composed = composeNodePrompt('outline',action,input,'codex-gpt');
    const body = composed.messages.map(row => row.content).join('\n');
    assert.equal(input.rules.base,defaultRules('outline')[key].base);
    assert.ok(!body.includes(`基础哨兵_${key}`)); assert.ok(body.includes(`补充哨兵_${key}`));
    const direct=composeNodePrompt('outline',action,{...input,rules:{base:'请求试图替换基础规则',supplement:input.rules.supplement}},'codex-gpt');
    assert.equal(direct.system,composed.system);
    for (const other of ['generate','review','revise'].filter(a=>a!==key)) {
      assert.ok(!body.includes(`基础哨兵_${other}`)); assert.ok(!body.includes(`补充哨兵_${other}`));
    }
    if (action === 'regenerate') assert.equal(JSON.parse(composed.messages[2].content).rules,undefined);
    assert.match(composed.system,/输出格式/);
  }
  assert.deepEqual(node.rules,before);
});

test('面板规则事务：仅编辑补充、拒绝基础与同步，持久化并过期下游', async () => {
  const home = await mkdtemp(join(tmpdir(),'meiji-node-rules-')); let runtime;
  try {
    runtime = await createAppRuntime({home});
    const s = snapshotFixture(), p = s.project, e = p.episodes[0], sid = `session-${randomUUID()}`;
    const model = await runtime.repository.create(p); await runtime.bindings.bind(sid,p.basic_info.id);
    const command = fields => runtime.projectCommand({project_id:p.basic_info.id,request_id:randomUUID(),business_type:'outline',target_id:e.id,...fields},sid,'panel');
    const oldHash = dependencyHash(s,'outline',e.id);
    await command({type:'edit-rule',action:'generate',field:'supplement',value:'本剧补充'});
    await command({type:'edit-rule',action:'review',field:'supplement',value:'审核独立补充'});
    await assert.rejects(command({type:'edit-rule',action:'revise',field:'base',value:'人工基础'}),/基础规则由代码维护/);
    let next = model.read(), n = next.project.episodes[0].story_outline;
    assert.equal(n.node_state.status,'expired'); assert.equal(next.project.episodes[0].shot_list.node_state.status,'expired');
    assert.notEqual(dependencyHash(next,'outline',e.id),oldHash);
    await assert.rejects(command({type:'sync-base-rules'}),/已移除同步操作/);
    n = model.read().project.episodes[0].story_outline;
    assert.equal(n.rules.revise.base,defaultRules('outline').revise.base);
    assert.equal(n.rules.generate.supplement,'本剧补充'); assert.equal(n.rules.review.supplement,'审核独立补充'); assert.equal(n.rules.revise.supplement,'');
    await assert.rejects(command({type:'edit-rule',action:'unknown',field:'base',value:'x'}),/rules/);
    await runtime.dispose(); runtime = await createAppRuntime({home});
    assert.deepEqual((await runtime.repository.open(p.basic_info.id)).read().project.episodes[0].story_outline.rules,n.rules);
  } finally { await runtime?.dispose(); await rm(home,{recursive:true,force:true}); }
});

test('基础快照不影响有效规则和hash，补充变化影响相应节点且不改快照',()=>{
 const s=snapshotFixture(),p=s.project,e=p.episodes[0],before=dependencyHash(s,'outline',e.id);
 e.story_outline.rules.generate.base='旧代码留下的基础副本';
 assert.equal(dependencyHash(s,'outline',e.id),before);
 assert.equal(effectiveRules(p,'outline',e.id).generate.base,defaultRules('outline').generate.base);
 e.story_outline.rules.generate.supplement='本次补充';assert.notEqual(dependencyHash(s,'outline',e.id),before);
 assert.equal(e.story_outline.rules.generate.base,'旧代码留下的基础副本');
 const plan=structuredClone(p.story_segments.rules),adapt=structuredClone(p.script_revision.rules);
 p.script_revision.rules.revise.base='旧改编基础';p.script_revision.rules.revise.supplement='只用于改编';
 assert.equal(effectiveRules(p,'script-review',p.basic_info.id).revise.base,defaultRules('script-review').revise.base);
 assert.equal(effectiveRules(p,'script-review',p.basic_info.id).revise.supplement,'只用于改编');
 assert.deepEqual(p.story_segments.rules,plan);assert.equal(effectiveRules(p,'script-split',p.basic_info.id).revise.supplement,plan.revise.supplement);
});

test('v25到v26显式迁移：补齐规则、保留正文媒体和有效链、二次启动不重写', async () => {
  const home = await mkdtemp(join(tmpdir(),'meiji-rules-migrate-')); let repo;
  try {
    repo = new ModelRepository(home); const p = snapshotFixture().project;
    await repo.create(p); await repo.close(); repo = null;
    const legacy = structuredClone(p);
    const strip = value => { if (!value || typeof value !== 'object') return; delete value.rules; for (const child of Object.values(value)) strip(child); };
    strip(legacy);
    const e = legacy.episodes[0], snapshot = {project:legacy};
    for (const [business,id,node] of [
      ['project-summary',legacy.basic_info.id,legacy.project_summary],['project-characters',legacy.basic_info.id,legacy.character_library],
      ['outline',e.id,e.story_outline],['episode-scenes',e.id,e.scene_catalog],['shots',e.id,e.shot_list],
      ...e.shot_list.shots.flatMap(s=>[['seconds',s.id,s.seconds_storyboard],['storyboard',s.id,s.text_to_video_prompt],['first-last-frame',s.id,s.first_last_frame_prompt],['multimodal',s.id,s.multimodal_prompt],['video',s.id,s.video],['tail',s.id,s.last_frame]]),['assembly',e.id,e.assembly],
    ]) node.node_state.dependency_hash = dependencyHash(snapshot,business,id);
    const db = new DatabaseSync(join(home,'meiji.sqlite'));
    db.prepare('UPDATE projects SET data_json=? WHERE id=?').run(JSON.stringify(legacy),p.basic_info.id);
    db.exec('DELETE FROM schema_migrations WHERE version=26; PRAGMA user_version=25'); db.close();
    repo = new ModelRepository(home); const next = (await repo.open(p.basic_info.id)).read();
    assert.deepEqual(next.project.episodes[0].story_outline.rules,defaultRules('outline'));
    assert.equal(next.project.script_revision.body,p.script_revision.body);
    assert.equal(next.project.episodes[0].assembly.address,p.episodes[0].assembly.address);
    assert.equal(isNodeCurrent(next,'outline',e.id),true); assert.equal(isNodeCurrent(next,'assembly',e.id),true);
    await repo.close(); repo = new ModelRepository(home); assert.deepEqual((await repo.open(p.basic_info.id)).read(),next);
  } finally { await repo?.close(); await rm(home,{recursive:true,force:true}); }
});
