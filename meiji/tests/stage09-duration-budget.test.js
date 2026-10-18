import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSplit } from '../server/handlers/script-split.js';
import { composeNodePrompt } from '../server/http/ai-routes.js';
import { splitBudget, outlineBudget, shotsBudget } from '../server/prompts/duration-policy.js';

for(const duration of [60,150,300]) test(`规划参考${duration}秒保留统一时长边界`,()=>{
  const budget=splitBudget(duration);
  for(const seconds of [budget.min_seconds,budget.max_seconds])
    assert.equal(buildSplit('故事原文',{剧集:[{序号:1,本集规划:'本集冲突得到阶段性解决并交接后续。',预估时长秒:seconds}]},duration).episodes[0].duration_seconds,seconds);
  assert.equal(outlineBudget(duration).target_seconds,duration);
  for(const action of ['generate','regenerate','review']){
    const prompt=composeNodePrompt('script-split',action,{language:'zh-CN',requirements:'',script:'故事原文',duration,opinion:'',...(action==='generate'?{}:{content:{剧集:[]}})},'codex-gpt');
    assert.match(prompt.body,new RegExp(`"min_seconds": ${duration-30}`));
    assert.match(prompt.body,new RegExp(`"max_seconds": ${duration+30}`));
  }
});
test('分集改编的小数时长仍按累计舍入交给镜头表，无独立二次预算',()=>{
  const segments=[{sequence:1,duration_seconds:10.4},{sequence:2,duration_seconds:10.4},{sequence:3,duration_seconds:10.4}];
  const budget=shotsBudget(segments,31.2);
  assert.equal(budget.target_seconds,31);
  assert.deepEqual(budget.segments.map(s=>s.budget_seconds),[10,11,10]);
});
