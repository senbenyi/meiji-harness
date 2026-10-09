import test from 'node:test'
import assert from 'node:assert/strict'
import { checkShotTable } from '../server/flow/steps/step-review-shot-table.js'
import { readShotSections } from '../server/flow/steps/step-generate-shot-table.js'
import { buildTablePrompts } from '../server/prompts/shot-text-prompts.js'
import { checkContext } from '../server/runtime/operation-context.js'
import { generateShots } from '../server/flow/tasks/text/task-shot-table.js'
import { episodeFixture } from './fixtures/model.js'
import { reviewPass } from './fixtures/review-result.js'
const table = durations => JSON.stringify({ shots: durations.map((durationSeconds, i) => ({ shotId: `S${String(i+1).padStart(2,'0')}`, durationSeconds, title: '连续行动', content: '人物继续完成当前行动。' })) })
const current = table([12,...Array(15).fill(15)])
const project = (parts=[60,90,90,60]) => {
 const p={...episodeFixture(),durationSeconds:300}
 p.plot.outline.content=parts.map((时长秒,index)=>({编号:index+1,时长秒,正文:`第${index+1}段完整事件。`}))
 return p
}
test('每段和全表精确继承大纲时间，15秒允许，不能用剧集±10秒替代', () => {
 const p=project()
 assert.deepEqual(checkShotTable(table(Array(20).fill(15)),p),[])
 for(const durations of [[...Array(19).fill(15),5],[...Array(20).fill(15),10]]) assert.match(checkShotTable(table(durations),p).join('\n'),/大纲固定总时长 300 秒/)
 // 来源大纲290秒本身合法，则镜头表也必须290秒。
 assert.deepEqual(checkShotTable(table([...Array(19).fill(15),5]),project([290])),[])
 assert.match(checkShotTable(current,p).join('\n'),/总时长 237 秒.*固定总时长 300 秒.*相差 63 秒/)
})
test('全表总和正确但镜头跨小段边界仍失败', () => {
 const p=project([70,80,90,60])
 assert.match(checkShotTable(table(Array(20).fill(15)),p)[0],/故事小段 1.*70 秒.*75 秒.*未在该段边界结束/)
 assert.deepEqual(checkShotTable(table([...Array(4).fill(15),10,...Array(5).fill(15),5,...Array(10).fill(15)]),p),[])
})
test('18秒镜头指出具体秒数和拆分，15秒镜头接受', () => {
 assert.throws(()=>readShotSections(table([18])),/S01 的时长 18 秒无效.*拆成多镜/)
 assert.equal(readShotSections(table([15]))[0].duration,15)
})
test('审核只读取当前稿统计，历史失败不混入；逐段预算传入生成', () => {
 const p=project();p.shots.items=readShotSections(table(Array(20).fill(15))).map(s=>({...s,content:'旧稿独有事件'}))
 p.shots.check={passed:false,failures:['旧失败结论282秒']}
 const prompts=checkContext.run({generationMode:'modify',originalProject:p,review:'保持最后的后窗画面'},()=>buildTablePrompts({project:p}))
 const review=prompts.review(current,{revisionReview:true,revisionOpinion:'历史S17错误'})
 assert.doesNotMatch(review.user,/旧稿独有事件|旧失败结论|历史S17错误|"shotId":"S17"/)
 assert.match(review.user,/保持最后的后窗画面/)
 assert.match(review.user,/"count":16.*"total":237/s)
 const budget=prompts.generation.segments.user.find(segment=>segment.title==='【逐段固定拆镜预算】')
 assert.deepEqual(JSON.parse(budget.text).parts.map(part=>part.durationSeconds),[60,90,90,60])
})
test('自动修订收到分段边界与固定总时长问题后返回合法完整镜头表',async()=>{
 let generated=0,repair=''
 const result=await generateShots({project:project(),request:async message=>{
  if(message.skill==='review')return reviewPass
  generated++;if(generated===1)return current
  repair=message.user;return table(Array(20).fill(15))
 }})
 assert.equal(result.check.passed,true);assert.equal(result.items.length,20)
 assert.match(repair,/大纲固定总时长 300 秒/);assert.match(repair,/未在该段边界结束/)
})
test('手动与自动修订只能调整段内分镜，审核统计不包含程序失败指令', () => {
 const p=project(),short=table([...Array(17).fill(14),10]),prompts=buildTablePrompts({project:p})
 const automatic=prompts.revision(short,'修正拆分')
 p.shots.items=readShotSections(short)
 const manual=checkContext.run({generationMode:'modify',originalProject:p},()=>buildTablePrompts({project:p,review:'修正拆分'}).generation)
 for(const message of [automatic,manual]) {
  assert.match(message.user,/"count":18.*"total":248/s)
  assert.match(message.system,/不跨段借秒，不重新分配整集预算/)
  assert.doesNotMatch(message.system,/可在原事件内部跨镜重新分配|删除冗余后必须重新核算完整时长/)
 }
 const review=prompts.review(short),stats=review.segments.user.find(item=>item.title==='【当前稿程序统计】')
 assert.deepEqual(JSON.parse(stats.text),{count:18,total:248,target:300,min:300,max:300})
 assert.doesNotMatch(stats.text,/failures/)
})
