import test from 'node:test'
import assert from 'node:assert/strict'
import { splitSecondsIssues, secondsRevisionIds } from '../server/prompts/seconds-feedback.js'
import { buildAllSecondsPrompts, buildSecondsPrompts } from '../server/prompts/shot-prompts.js'
import { EpisodeSecondsModel } from '../server/prompts/models/text-step-model.js'
import { render } from '../server/prompts/skill-prompts.js'
import { checkContext } from '../server/data/operation-context.js'
import { formatReviewIssue } from '../shared/review-result.js'
import { validateSeconds } from '../shared/seconds-content.js'
import { protocols } from '../skills/protocols.js'
import { episodeFixture } from './fixtures/model.js'

const program = { location: '程序校验', reason: 'S02 节拍总时长4000ms，应为5000ms', requirement: '修正时长' }
const semantic = { location: 'S01 B01动作', reason: '待审向南，镜头表向北；S02仅作交接参考', requirement: '保留向北，不能改写S02' }
const verdict = issues => JSON.stringify({ passed: false, issues })

test('seconds feedback separates fixed program labels, preserves uncertain opinions and deduplicates exact issues',()=>{
 const falselyNamed = { ...semantic, location: '程序校验 S01' }
 assert.deepEqual(splitSecondsIssues([formatReviewIssue(program),formatReviewIssue(program),formatReviewIssue(semantic),formatReviewIssue(falselyNamed)]),{
  programIssues:[program],semanticIssues:[semantic,falselyNamed],
 })
 assert.equal(splitSecondsIssues('未格式化但需要核对的意见').semanticIssues[0].reason,'未格式化但需要核对的意见')
})

test('seconds correction scope follows issue locations rather than names mentioned in explanations',()=>{
 const shots=episodeFixture().shots.items
 assert.deepEqual(secondsRevisionIds(verdict([semantic]),shots),['S01'])
 assert.deepEqual(secondsRevisionIds(verdict([program]),shots),['S02'])
 assert.deepEqual(secondsRevisionIds(verdict([{...semantic,location:'S01 与 S02交接'}]),shots),['S01','S02'])
 assert.deepEqual(secondsRevisionIds(verdict([{...semantic,location:'本次内容'}]),shots),['S01','S02'])
 assert.deepEqual(secondsRevisionIds(verdict([{...semantic,location:'S99'}]),shots),['S01','S02'])
})

for(const single of [false,true])test(`seconds human correction uses distinct opinions and current base, single=${single}`,()=>{
 const project=episodeFixture()
 project.shots.items[0].seconds.check={passed:false,failures:[formatReviewIssue(semantic)]}
 project.shots.items[1].seconds.check={passed:false,failures:[formatReviewIssue(program)]}
 project.shots.seconds.review.text='保留声音细节'
 project.shots.items[0].seconds.review.text='保留声音细节'
 const message=checkContext.run({generationMode:'modify',review:'混合旧字段不能作为人工意见',batchReview:'保留声音细节',originalProject:project},()=>single
  ? buildSecondsPrompts({project,shotId:'S01'}).generation
  : buildAllSecondsPrompts({project},project).generation)
 assert.match(message.user,/【修改基稿】/)
 assert.match(message.user,/【语义审核问题】/)
 assert.match(message.user,/【人工修改意见】\n保留声音细节/)
 assert.doesNotMatch(message.user,/混合旧字段|【本次修改意见】/)
 if(!single)assert.match(message.user,/【程序校验问题】/)
 assert.match(message.system,/不能修改上游事实或重排镜头事件/)
})

test('seconds automatic correction and re-review keep sources separate, exclude old issues and declare partial output',()=>{
 const model=new EpisodeSecondsModel({project:episodeFixture(),modify:true,baseContent:'人工基稿',opinion:'保留声音',programIssues:[{...program,reason:'旧校验原因'}]})
 model.task.revisionShotIds=['S01']
 const correction=model.toReviseSegments('本轮失败稿',verdict([semantic,program,semantic]))
 assert.match(render(correction.user),/【最新失败稿（唯一修改基准）】\n本轮失败稿/)
 assert.match(render(correction.user),/【程序校验问题】/)
 assert.match(render(correction.user),/【语义审核问题】/)
 assert.equal(render(correction.user).split(semantic.reason).length-1,1)
 assert.doesNotMatch(render(correction.user),/旧校验原因|人工基稿/)
 assert.match(render(correction.system),/本轮仅返回这些镜头的完整 shots 条目：S01/)
 model.task.baseContent='本轮失败稿';model.task.revisionReview=true;model.task.revisionOpinion=verdict([program,semantic])
 const review=model.toReviewSegments('最新修订稿')
 assert.match(render(review.user),/【人工修改意见】\n保留声音/)
 assert.match(render(review.user),/【本次待审内容】\n最新修订稿/)
 assert.match(render(review.system),/对应镜头表原文/)
 assert.match(render(review.system),/不能因动作问题将正确时长判为/)
})

test('seconds regeneration omits old reasons and all human opinions',()=>{
 const project=episodeFixture();project.shots.seconds.review.text='旧意见';project.shots.seconds.check={passed:false,failures:[formatReviewIssue(program)]}
 const message=checkContext.run({generationMode:'regenerate',batchReview:'旧意见'},()=>buildAllSecondsPrompts({project},project).generation)
 assert.doesNotMatch(message.user,/旧意见|【修改基稿】|【程序校验问题】|【语义审核问题】|【人工修改意见】/)
 assert.match(message.system,/全部镜头的完整 shots 条目/)
})

test('seconds protocol example satisfies the actual validator including empty dialogueIds',()=>{
 const example=JSON.parse(protocols.seconds.split('示例（仅示范格式，单镜 4 秒）：\n')[1])
 const project=episodeFixture(),shot={...project.shots.items[0],duration:4}
 assert.doesNotThrow(()=>validateSeconds(example.shots[0],shot,project))
 assert.ok(example.shots[0].beats.every(beat=>Array.isArray(beat.dialogueIds)))
})
