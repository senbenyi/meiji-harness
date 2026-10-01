import { reviewPass, reviewFail } from './fixtures/review-result.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import { setupModel, episodeFixture } from './fixtures/model.js'
import { modelStore } from '../server/data/model-settings.js'
import { runOperation } from '../server/flow/operations/run.js'
import { recordStore } from '../server/data/task-store.js'
import { generateAllSeconds } from '../server/generate/shot-text.js'
const output = '## S01 / 5s\n0–5s 第一镜新动作\n\n## S02 / 5s\n0–5s 第二镜接续动作\n[seconds-complete]'
async function environment(t) {
 const e = await setupModel(t), models = modelStore(e.home)
 await models.write({ ...await models.read(), apiKey: 'test-only' })
 return e
}
test('whole episode generates once, reviews the complete episode, and replaces even previously passed shots', async t => {
 const e=await environment(t), calls=[]
 await runOperation(e.op('seconds',{generationMode:'regenerate'}),{home:e.home,generateAllSeconds:options=>generateAllSeconds({...options,request:async ({ skill, user: prompt }) =>{
  calls.push({skill,prompt});return skill==='review'?reviewPass:output
 }})})
 assert.equal(calls.length,2);assert.equal(calls.filter(c=>c.skill!=='review').length,1)
 assert.match(calls[1].prompt,/第一镜新动作/)
 assert.match(calls[1].prompt,/第二镜接续动作/)
 const p=await e.read()
 assert.ok(p.shots.items.every(s=>s.seconds.check.passed===true && !s.seconds.operation))
 assert.ok(p.shots.items.every(s=>s.storyboard.content===null))
 assert.equal(p.activity,null)
})
test('whole episode failed review revises the complete version once', async t=>{
 const e=await environment(t), calls=[]
 await assert.rejects(runOperation(e.op('seconds'),{home:e.home,generateAllSeconds:options=>generateAllSeconds({...options,request:async ({ skill, user: prompt }) =>{
  calls.push({skill,prompt})
  if(skill==='review') return reviewFail('第一镜问题')
  return calls.length===1?output:output.replace('第一镜新动作','第一镜修订稿')
 }})}),/第一镜问题/)
 const p=await e.read()
 assert.equal(p.shots.items[0].seconds.content,'0–5s 第一镜修订稿')
 assert.equal(p.shots.items[1].seconds.content,'0–5s 第二镜接续动作')
 for (const shot of p.shots.items) {
  assert.equal(shot.seconds.check.passed, false)
  assert.equal(shot.seconds.status, 'failed')
  assert.deepEqual(shot.seconds.check.failures, ['位置：本次内容；原因：第一镜问题；修正要求：修正上述问题'])
  assert.equal(shot.seconds.operation, null)
 }
 assert.equal(calls.length,4)
})
for(const text of [output.replace('[seconds-complete]',''), '## S01 / 5s\n只有一镜\n[seconds-complete]',output.replace('S02 / 5s','S02 / 4s')]) {
 test('incomplete or mismatched result preserves original content and downstream',async t=>{
  const e=await environment(t),before=await e.read()
  await assert.rejects(runOperation(e.op('seconds'),{home:e.home,generateAllSeconds:options=>generateAllSeconds({...options,request:async ({skill})=>skill==='review'?reviewPass:text})}),/自审未通过/)
  const after=await e.read()
  for(let i=0;i<2;i++) {
   assert.equal(after.shots.items[i].seconds.content,before.shots.items[i].seconds.content)
   assert.deepEqual(after.shots.items[i].storyboard,before.shots.items[i].storyboard)
  }
 })
}
test('whole generation does not include old seconds or their opinions',async()=>{
 const p=episodeFixture();p.shots.items.forEach(s=>{s.seconds.content='OLD_SECRET';s.seconds.review.text='OLD_OPINION'})
 const calls=[]
 await generateAllSeconds({project:p,request:async ({ skill, user: prompt }) =>{calls.push(prompt);return skill==='review'?reviewPass:output}})
 assert.doesNotMatch(calls[0],/OLD_SECRET|OLD_OPINION/)
})
test('cancellation during review preserves all newly generated drafts and releases ownership',async t=>{
 const e=await environment(t),controller=new AbortController()
 await assert.rejects(runOperation(e.op('seconds'),{home:e.home,signal:controller.signal,generateAllSeconds:options=>generateAllSeconds({...options,request:async ({ skill }) =>{
  if(skill!=='review')return output
  controller.abort();controller.signal.throwIfAborted()
 }})}),{name:'AbortError'})
 const p=await e.read()
 assert.ok(p.shots.items.every(s=>s.seconds.content.includes('动作') && s.seconds.operation===null))
 assert.equal(p.activity,null)
})
test('storyboard never fills missing seconds in the background',async t=>{
 const e=await environment(t)
 await e.store.save(e.id,p=>{p.episodes[0].shots.items[1].seconds.content=null;return p})
 await assert.rejects(runOperation(e.op('storyboard'),{home:e.home,generateAllSeconds:()=>assert.fail('no implicit fill'),generateShotSeconds:()=>assert.fail('no implicit fill')}),/请先生成整集每秒指令/)
})
test('review preserves new human opinions entered on a different shot',async t=>{
 const e=await environment(t);let reviews=0
 await runOperation(e.op('seconds',{generationMode:'regenerate'}),{home:e.home,generateAllSeconds:options=>generateAllSeconds({...options,request:async ({ skill }) =>{
  if(skill!=='review')return output
  if(reviews++===0)await e.store.saveReviewDraft(e.id,e.episodeId,'seconds:S02','新输入意见',0)
  return reviewPass
 }})})
 assert.equal((await e.read()).shots.items[1].seconds.review.text,'新输入意见')
})
test('unified opinion and numbered failures modify the whole episode and are consumed only on success',async t=>{
 const e=await environment(t)
 await e.store.saveReviewDraft(e.id,e.episodeId,'seconds','统一保持动作方向',0)
 await e.store.save(e.id,p=>{p.episodes[0].shots.items[1].seconds.check={passed:false,failures:['机位反了']};return p})
 const calls=[]
 await runOperation(e.op('seconds',{generationMode:'modify'}),{home:e.home,generateAllSeconds:options=>generateAllSeconds({...options,request:async ({ skill, user: prompt }) =>{
  calls.push(prompt);return skill==='review'?reviewPass:output
 }})})
 assert.match(calls[0],/统一保持动作方向/);assert.match(calls[0],/S02：机位反了/);assert.match(calls[0],/修改基稿/)
 const p=await e.read()
 assert.equal(p.shots.seconds.review.text,'');assert.equal(p.shots.seconds.operation,null)
 assert.ok(p.shots.items.every(s=>s.seconds.review.text===''))
})
test('unified opinion saved while generation runs survives completion',async t=>{
 const e=await environment(t)
 await e.store.saveReviewDraft(e.id,e.episodeId,'seconds','本次意见',0)
 let entered=false
 await runOperation(e.op('seconds',{generationMode:'modify'}),{home:e.home,generateAllSeconds:options=>generateAllSeconds({...options,request:async ({ skill }) =>{
  if(!entered){entered=true;await e.store.saveReviewDraft(e.id,e.episodeId,'seconds','下次意见',1)}
  return skill==='review'?reviewPass:output
 }})})
 assert.equal((await e.read()).shots.seconds.review.text,'下次意见')
})
test('unified opinion is retained after failed review and regeneration does not submit it',async t=>{
 const e=await environment(t)
 await e.store.saveReviewDraft(e.id,e.episodeId,'seconds','保留人工意见',0)
 let generated=false
 await assert.rejects(runOperation(e.op('seconds',{generationMode:'modify'}),{home:e.home,generateAllSeconds:options=>generateAllSeconds({...options,request:async ({ skill }) =>{
  if(skill==='review')return reviewFail('不通过')
  if(!generated){generated=true;return output}return output.replace('第一镜新动作','第一镜修订稿')
 }})}),/自检未通过/)
 assert.equal((await e.read()).shots.seconds.review.text,'保留人工意见')
 await runOperation(e.op('seconds',{generationMode:'regenerate'}),{home:e.home,generateAllSeconds:options=>generateAllSeconds({...options,request:async ({ skill, user: prompt }) =>{
  assert.doesNotMatch(prompt,/保留人工意见/);return skill==='review'?reviewPass:output
 }})})
 assert.equal((await e.read()).shots.seconds.review.text,'保留人工意见')
})
test('old per-shot opinions are collected into one persistent group review',async t=>{
 const e=await environment(t)
 await e.store.save(e.id,p=>{
  const shots=p.episodes[0].shots
  delete shots.seconds
  shots.items[0].seconds.review.text='保留动作'
  shots.items[1].seconds.review.text='保持机位'
  return p
 })
 const group=(await e.read()).shots.seconds
 assert.equal(group.id,'seconds');assert.match(group.review.text,/S01：保留动作/);assert.match(group.review.text,/S02：保持机位/)
 await e.store.saveReviewDraft(e.id,e.episodeId,'seconds','统一意见',group.review.revision)
 assert.equal((await e.read()).shots.seconds.review.text,'统一意见')
})

test('truncated stop response continues from the unfinished shot before atomic save and whole review', async t => {
 const e=await environment(t),before=await e.read(),calls=[]
 const partial='## S01 / 5s\n0–5s 第一镜完整新动作\n\n## S02 / 5s\n0–2s 被截断的半句话'
 await runOperation(e.op('seconds',{generationMode:'regenerate'}),{home:e.home,generateAllSeconds:options=>generateAllSeconds({...options,request:async message=>{
  calls.push(message)
  if(message.skill==='review') {
   assert.match(message.user,/第一镜完整新动作/);assert.match(message.user,/第二镜续传完成/)
   assert.doesNotMatch(message.user,/0–2s 被截断的半句话/)
   return reviewPass
  }
  if(calls.length===1)return partial
  assert.match(message.system,/只返回剩余镜头：S02 \/ 5s/)
  assert.match(message.user,/第一镜完整新动作/)
  assert.doesNotMatch(message.user,/0–2s 被截断的半句话/)
  assert.equal((await e.read()).shots.items[0].seconds.content,before.shots.items[0].seconds.content)
  return '## S02 / 5s\n0–5s 第二镜续传完成\n[seconds-complete]'
 }})})
 assert.equal(calls.length,3)
 const p=await e.read()
 assert.equal(p.shots.items[0].seconds.content,'0–5s 第一镜完整新动作')
 assert.equal(p.shots.items[1].seconds.content,'0–5s 第二镜续传完成')
 assert.ok(p.shots.items.every(s=>s.seconds.check.passed===true))
})

test('continuation obeys three-request bound and never publishes accumulated partial shots',async()=>{
 const project=episodeFixture(),template=project.shots.items[0],persisted=[]
 project.shots.items=Array.from({length:6},(_,i)=>({...structuredClone(template),id:`S0${i+1}`}))
 let requests=0
 await assert.rejects(generateAllSeconds({project,persist:async shots=>{persisted.push(shots);return {...project,shots}},request:async ({skill})=>{
  if(skill==='review')return reviewPass
  const i=(requests++ % 4)+1
  return `## S0${i} / 5s\n0–5s 已完成\n\n## S0${i+1} / 5s\n0–1s 截断`
 }}),/自审未通过.*缺少完成标记/)
 assert.equal(requests,8);assert.deepEqual(persisted,[])
})

for(const kind of ['wrong-order','api-error','cancel','no-progress']) test(`failed continuation (${kind}) preserves original content and downstream`,async t=>{
 const e=await environment(t),before=await e.read(),controller=new AbortController();let requests=0
 await assert.rejects(runOperation(e.op('seconds'),{home:e.home,signal:controller.signal,generateAllSeconds:options=>generateAllSeconds({...options,request:async ({skill})=>{
  if(skill==='review')return reviewPass
  if(++requests===1)return '## S01 / 5s\n0–5s 临时完整片段\n\n## S02 / 5s\n半句话'
  if(kind==='api-error')throw new Error('network failure')
  if(kind==='cancel'){controller.abort();controller.signal.throwIfAborted()}
  if(kind==='wrong-order')return requests===2?output:output.replace('S01','S03')
  return '## S02 / 5s\n始终没有结束标记'
 }})}))
 const after=await e.read()
 for(let i=0;i<2;i++){
  assert.equal(after.shots.items[i].seconds.content,before.shots.items[i].seconds.content)
  assert.deepEqual(after.shots.items[i].storyboard,before.shots.items[i].storyboard)
 }
 assert.ok(requests<=8)
})

test('truncated automatic revision continues its own latest draft and receives a whole-episode re-review',async()=>{
 let generations=0,reviews=0
 const p=await generateAllSeconds({project:episodeFixture(),request:async message=>{
  if(message.skill==='review'){
   if(++reviews===1)return reviewFail('第二镜动作不连续')
   assert.match(message.user,/第一镜修好/);assert.match(message.user,/第二镜修好/)
   assert.doesNotMatch(message.user,/第二镜未写完/)
   return reviewPass
  }
  if(++generations===1)return output
  if(generations===2)return '## S01 / 5s\n0–5s 第一镜修好\n\n## S02 / 5s\n第二镜未写完'
  assert.match(message.user,/第二镜动作不连续/)
  return '## S02 / 5s\n0–5s 第二镜修好\n[seconds-complete]'
 }})
 assert.equal(generations,3);assert.equal(reviews,2)
 assert.equal(p.items[1].seconds.content,'0–5s 第二镜修好')
})


test('numbered failures stay on affected shots and appear only once in whole revision', async t => {
 const e=await environment(t)
 await assert.rejects(runOperation(e.op('seconds'),{home:e.home,generateAllSeconds:options=>generateAllSeconds({...options,request:async ({skill})=>skill==='review'?reviewFail('S01：动作重复'):output})}),/动作重复/)
 const project=await e.read()
 assert.equal(project.shots.items[0].seconds.check.passed,false)
 assert.equal(project.shots.items[1].seconds.check.passed,true)
 const { checkReasons }=await import('../server/data/review-checks.js')
 assert.deepEqual(checkReasons(project,{action:'seconds'}),['位置：本次内容；原因：S01：动作重复；修正要求：修正上述问题'])
})


test('multiline feedback retains evidence inside its targeted issue',async()=>{
 const { scopedCheck, uniqueFeedback }=await import('../shared/feedback.js')
 const issue='位置：S01；原因：动作重复\n\n原文：再起身；修正要求：保持站立'
 assert.deepEqual(uniqueFeedback([issue,issue]),[issue])
 assert.equal(scopedCheck({passed:false,failures:[issue]},'S02').passed,true)
 assert.deepEqual(scopedCheck({passed:false,failures:[issue]},'S01').failures,[issue])
})


test('resolved shot failures do not survive in the whole episode feedback',async()=>{
 const { feedbackOf }=await import('../shared/feedback.js')
 const project=episodeFixture()
 project.shots.seconds.check={passed:false,failures:['位置：S01；原因：旧问题；修正要求：修正']}
 project.shots.items.forEach(shot=>{shot.seconds.check={passed:true,failures:[]}})
 assert.equal(feedbackOf(project,'seconds').check.passed,true)
 assert.deepEqual(feedbackOf(project,'seconds').check.failures,[])
})


test('a new local failure replaces stale whole episode failure when collecting opinions',async()=>{
 const { feedbackOf }=await import('../shared/feedback.js')
 const project=episodeFixture()
 project.shots.seconds.check={passed:false,failures:['位置：S01；原因：旧问题；修正要求：修正']}
 project.shots.items[0].seconds.check={passed:true,failures:[]}
 project.shots.items[1].seconds.check={passed:false,failures:['新问题']}
 assert.deepEqual(feedbackOf(project,'seconds').check.failures,['S02：新问题'])
})

for (const [label, invalid, reason] of [
 ['missing', '## S01 / 5s\n只有一镜\n[seconds-complete]', /镜头数量应为 2，实际 1；缺少 S02 \/ 5s/],
 ['duration', output.replace('S02 / 5s', 'S02 / 4s'), /应为 S02 \/ 5s，实际 S02 \/ 4s/],
 ['extra', output.replace('[seconds-complete]', '## S03 / 5s\n多余镜头\n[seconds-complete]'), /镜头数量应为 2，实际 3/],
]) test(`seconds ${label} reports the mismatch as review failure and preserves originals`, async t => {
 const e = await environment(t), before = await e.read(); let requests = 0
 await assert.rejects(runOperation(e.op('seconds'), { home: e.home, operationId: `mismatch-${label}`,
  generateAllSeconds: options => generateAllSeconds({ ...options, request: async ({skill}) => { requests++; return skill==='review'?reviewPass:invalid } }),
 }), reason)
 assert.equal(requests, 4)
 const task = await recordStore(e.home, e.id).read('tasks', `mismatch-${label}`)
 assert.equal(task.status, 'review_failed')
 assert.ok(task.steps.every(step => step.status === 'completed' && !step.error))
 assert.match(task.steps[1].reasons.join('；'), reason)
 assert.equal(task.steps[1].verdict, 'fail')
 assert.deepEqual(task.steps[1].attempts.map(a => a.label), ['程序审核', '大模型审核'])
 const raw = await recordStore(e.home, e.id).read('artifacts', task.steps[0].outputs[0])
 assert.equal(raw.content.text, invalid)
 assert.equal(raw.published, false)
 const after = await e.read()
 for (let i = 0; i < 2; i++) {
  assert.deepEqual(after.shots.items[i].seconds.content, before.shots.items[i].seconds.content)
  assert.deepEqual(after.shots.items[i].storyboard, before.shots.items[i].storyboard)
 }
})

for (const count of [1, 2, 5]) test(`whole seconds covers exactly ${count} shots with their own duration`, async () => {
 const { buildAllSecondsPrompts } = await import('../server/prompts/shot-prompts.js')
 const project = episodeFixture(), sample = project.shots.items[0]
 project.shots.items = Array.from({ length: count }, (_, i) => ({ ...structuredClone(sample), id: `S${String(i + 1).padStart(2, '0')}`, duration: 3 + i }))
 const text = project.shots.items.map(s => `## ${s.id} / ${s.duration}s\n### 0–${s.duration}s\n本镜动作`).join('\n\n') + '\n[seconds-complete]'
 const prompts = buildAllSecondsPrompts({ project }, project)
 assert.match(prompts.generation.user, /本次必须逐项输出的镜头标题清单/)
 for (const shot of project.shots.items) assert.ok(prompts.generation.user.includes(`## ${shot.id} / ${shot.duration}s`))
 assert.doesNotMatch(prompts.generation.system, /结束的逐秒正文|\nS01 \/ 4s/)
 const result = await generateAllSeconds({ project, request: async message => message.skill === 'review' ? reviewPass : text })
 assert.equal(result.items.length, count)
 for (const shot of result.items) assert.equal(shot.seconds.content, `### 0–${shot.duration}s\n本镜动作`)
})

test('seconds timeline rejects repeated, overlapping, gapped, short or oversized ranges', async () => {
 const { validateSecondsTimeline } = await import('../server/generate/shot-text.js')
 for (const content of ['### 0–5s\n动作\n### 0–5s\n重复', '### 0–3s\n动作\n### 2–5s\n重叠', '### 0–2s\n动作\n### 3–5s\n空档', '### 0–4s\n未完', '### 0–6s\n越界', '没有时间线']) {
  assert.throws(() => validateSecondsTimeline({ id: 'S01', duration: 5, content }), /S01.*未覆盖原内容/)
 }
 validateSecondsTimeline({ id: 'S01', duration: 5, content: '### 0–0.5s\n动作\n### 0.5–5s\n持续' })
})

test('even with all shot titles, a repeated timeline cannot overwrite previous seconds', async t => {
 const e = await environment(t), before = await e.read()
 const invalid = output.replace('0–5s 第一镜新动作', '### 0–5s\n动作\n### 0–5s\n重复')
 await assert.rejects(runOperation(e.op('seconds'), { home: e.home, generateAllSeconds: options => generateAllSeconds({ ...options, request: async ({skill}) => skill==='review'?reviewPass:invalid }) }), /S01 时间线错误/)
 assert.equal((await e.read()).shots.items[0].seconds.content, before.shots.items[0].seconds.content)
})

test('program-rejected missing shot is repaired and both reviewers accept the complete revision', async t => {
 const e = await environment(t); let generations = 0
 await runOperation(e.op('seconds'), { home: e.home, operationId: 'repaired-missing-shot', generateAllSeconds: options => generateAllSeconds({ ...options,
  request: async message => {
   if (message.skill === 'review') return reviewPass
   if (++generations === 1) return '## S01 / 5s\n0–5s 第一镜\n[seconds-complete]'
   assert.match(message.user, /缺少 S02/)
   return output
  },
 }) })
 const task = await recordStore(e.home, e.id).read('tasks', 'repaired-missing-shot')
 assert.equal(task.status, 'completed')
 assert.deepEqual(task.steps.filter(s => s.kind.includes('review')).map(s => s.verdict), ['fail', 'pass'])
 assert.equal((await e.read()).shots.items[1].seconds.content, '0–5s 第二镜接续动作')
})
