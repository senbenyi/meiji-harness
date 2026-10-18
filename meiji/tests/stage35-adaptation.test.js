import test from 'node:test';
import assert from 'node:assert/strict';
import { adaptationContext, adaptedStory } from '../shared/adaptation-context.js';
import { stampDependencyHash, expireDownstream, isNodeCurrent } from '../shared/node-dependencies.js';
import { taskNodeInput } from '../server/handlers/node-inputs.js';
import { renderTaskPrompt } from './fixtures/ai.js';
import { snapshotFixture, taskFixture } from './fixtures/project.js';
import { emptyEpisode } from '../shared/project_contract.js';

function fixture() {
  const snapshot=snapshotFixture(), project=snapshot.project, first=project.episodes[0];
  first.plot='首集规划：甲找到线索，结尾带着线索离开。';
  first.story_outline.segments[0].body='甲与乙争论后拿到红色钥匙，独自离开仓库。';
  const second=emptyEpisode({sequence:2,duration_seconds:10,plot:'次集规划：甲用线索救人并揭开真相。'});
  second.story_outline.segments=[{sequence:1,duration_seconds:10,body:'甲在门前停下，最终救出同伴。',causal:''}];
  second.story_outline.node_state.status='generated';
  project.episodes.push(second);
  stampDependencyHash(snapshot,'outline',first.id);stampDependencyHash(snapshot,'outline',second.id);
  return {snapshot,project,first,second};
}

test('逐集改编输入含完整剧本、全集规划、前集实际结果，本集单独输出',()=>{
  const {snapshot,project,first,second}=fixture();
  const task=taskFixture(project,'outline',second.id);
  const input=taskNodeInput(snapshot,task,null,'generate');
  assert.equal(input.script,project.script.body);assert.equal(input.sequence,2);
  assert.equal(input.episodes.length,2);assert.equal(input.plot,second.plot);
  assert.equal(input.previous.story,adaptedStory(first));
  for(const action of ['generate','regenerate','review']) {
    const prompt=renderTaskPrompt(snapshot,task,second.story_outline,action);
    assert.ok(prompt.messages.some(message=>message.content.includes('红色钥匙')));
    assert.ok(prompt.messages.some(message=>message.content.includes(second.plot)));
    assert.match(prompt.system,/允许改写对白、增删或合并局部事件/);
    assert.doesNotMatch(prompt.system,/原台词逐字保留|原剧情必须完整保留/);
  }
});
test('前集无有效改编时只传规划，不把被拒绝的正文当作实际状态',()=>{
  const {project,first,second}=fixture();
  first.story_outline.node_state.status='rejected';first.story_outline.node_state.reason='需修正';
  const input=adaptationContext(project,second);
  assert.equal(input.previous.story,'');assert.equal(input.previous.plan,first.plot);
});
test('前集改编变化使后集改编过期，旧规划及正文保留',()=>{
  const {snapshot,project,first,second}=fixture();
  const old=structuredClone(second);
  assert.equal(isNodeCurrent(snapshot,'outline',second.id),true);
  first.story_outline.segments[0].body='甲失去钥匙，带着伤返回仓库。';
  stampDependencyHash(snapshot,'outline',first.id);
  expireDownstream(snapshot,'outline',first.id);
  assert.equal(second.story_outline.node_state.status,'expired');
  assert.equal(second.plot,old.plot);assert.deepEqual(second.story_outline.segments,old.story_outline.segments);
  assert.equal(project.episodes.length,2);
});
test('后集规划变化会使依赖全集规划的前集改编过期',()=>{
  const {snapshot,first,second}=fixture();second.plot='改为先救人，最终结果不变。';
  expireDownstream(snapshot,'episode-plot',second.id);
  assert.equal(first.story_outline.node_state.status,'expired');
});
test('完整改编正文由段落派生，不覆盖或重复保存规划',()=>{
  const {first}=fixture();first.story_outline.segments.push({sequence:2,duration_seconds:5,body:'甲打开信封，发现新的去向。',causal:'接续离开仓库'});
  assert.equal(adaptedStory(first),first.story_outline.segments.map(s=>s.body).join('\n\n'));
  assert.match(first.plot,/首集规划/);
});
