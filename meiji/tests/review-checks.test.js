import { tableResponse } from './fixtures/shot-response.js'
import { secondsResponse } from './fixtures/seconds.js'
import { reviewPass, reviewFail } from './fixtures/review-result.js'
import { storyboardFixture } from './fixtures/storyboard.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import { setupModel } from './fixtures/model.js'
import { runOperation } from './fixtures/operation.js'
import { scopeProjects } from '../server/data/episode-data.js'
import { generateShotSeconds } from '../server/flow/tasks/text/task-shot-seconds.js'
import { generateShotStoryboard } from '../server/flow/tasks/text/task-storyboard-prompt.js'
import { generateShots } from '../server/flow/tasks/text/task-shot-table.js'
import { checkReasons, setCheck } from '../server/runtime/review-checks.js'
import { targetNode, begin, saveReview, finish } from '../shared/drama-model.js'
import { pictureTargetSnapshot } from '../server/data/image-storage.js'
const reply=(text,verdict=reviewPass)=>async ({ skill }) =>skill==='review'?verdict:skill==='seconds'?secondsResponse([['S01',5,text]]):text

for (const [action, key, fields] of [
  ['shots', 'shots', {}],
  ['shot-seconds', 'seconds:S01', { track: 'S01' }],
]) test(`${action} passes complete long self-check feedback with a short human opinion`, async t => {
  const e = await setupModel(t)
  const reasons = Array.from({ length: 13 }, (_, i) => `位置：S01 第${i + 1}项；原因：${'需保留的动作与空间问题'.repeat(20)}；修正要求：完整处理第${i + 1}项`)
  const human = '保留既定剧情'
  const store = scopeProjects(e.store, e.episodeId)
  await store.save(e.id, p => {
    targetNode(p, key).check = { passed: false, failures: reasons }
    return p
  })
  let called = 0
  const verify = text => {
    called++
    for (const reason of reasons) assert.ok(text.includes(reason), 'must preserve every complete self-check issue')
    assert.ok(text.includes(human))
  }
  const deps = { home: e.home,
    generateShots: opts => generateShots({ ...opts, request: async ({ skill, user }) => {
      if (skill === 'review') return reviewPass
      verify(user)
      return tableResponse('## S01 / 5s\n标题：进入庭院\n旅人朝北进入庭院。\n\n## S02 / 5s\n标题：等待回应\n旅人在门外等待。')
    } }),
    generateShotSeconds: opts => generateShotSeconds({ ...opts, request: async ({ skill, user }) => {
      if (skill === 'review') return reviewPass
      verify(user)
      return secondsResponse([['S01', 5, '沿原路径继续前行']])
    } }),
    submitPencilBoard: async args => { verify(args.prompt) },
  }
  await runOperation(e.op(action, { ...fields, generationMode: 'modify', review: human }), deps)
  assert.equal(called, 1)
})

test('shots can revise from long self-check feedback without any human opinion', async t => {
  const e = await setupModel(t)
  const reason = `位置：S01；原因：${'空间连续性问题'.repeat(400)}；修正要求：修正镜头衔接`
  await scopeProjects(e.store, e.episodeId).save(e.id, p => {
    p.shots.check = { passed: false, failures: [reason] }
    return p
  })
  let called = false
  await runOperation(e.op('shot-table', { generationMode: 'modify' }), { home: e.home, generateShots: async opts => {
    called = true
    assert.equal(opts.review, reason)
    return { ...opts.project.shots, check: { passed: true, failures: [] } }
  } })
  assert.equal(called, true)
})

// 意见只在「按意见修改」时由调用方显式传入；失败后保留在节点上供再次修改。
test('generation failure retains opinion and content, modify retry consumes opinion on success',async t=>{const e=await setupModel(t);await assert.rejects(runOperation(e.op('seconds', {track:'S01',review:'不要转身'}),{home:e.home,generateShotSeconds:async()=>{throw new Error('网络失败')}}),/网络失败/);let p=await e.read();assert.equal(p.shots.items[0].seconds.review.text,'不要转身');assert.ok(p.shots.items[0].seconds.content);await runOperation(e.op('seconds', {track:'S01',generationMode:'modify',review:p.shots.items[0].seconds.review.text}),{home:e.home,generateShotSeconds:opts=>{assert.match(opts.review,/不要转身/);return generateShotSeconds({...opts,request:reply('0–5s 朝北不转身')})}});p=await e.read();assert.equal(p.shots.items[0].seconds.review.text,'');assert.equal(p.shots.items[0].seconds.status,'passed')})
test('self-check failure and human opinion remain distinct',async t=>{const e=await setupModel(t);await assert.rejects(runOperation(e.op('seconds', {track:'S01',review:'保留动作'}),{home:e.home,generateShotSeconds:opts=>generateShotSeconds({...opts,request:reply('新的指令',reviewFail('缺少空间'))})}), /自审未通过/);const n=(await e.read()).shots.items[0].seconds;assert.equal(n.review.text,'保留动作');assert.deepEqual(n.check.failures,['位置：本次内容；原因：缺少空间；修正要求：修正上述问题']);assert.equal(n.status,'failed');assert.equal(n.content.beats[0].action,'新的指令')})
test('new human draft during a running operation is never cleared or overwritten',async t=>{const e=await setupModel(t);await runOperation(e.op('seconds', {track:'S01',review:'本次修改'}),{home:e.home,generateShotSeconds:async opts=>{const n=(await e.read()).shots.items[0].seconds;await e.store.saveReviewDraft(e.id,e.episodeId,n.id,'下一次意见',n.review.revision);return generateShotSeconds({...opts,request:reply('新指令')})}});const n=(await e.read()).shots.items[0].seconds;assert.equal(n.status,'passed');assert.equal(n.review.text,'下一次意见')})
test('image opinion edits do not change the picture target snapshot',async t=>{const e=await setupModel(t),p=await e.read(),c=p.plot.characters.items[0],snapshot=pictureTargetSnapshot(c);saveReview(c.image,'换背景');begin(c.image,{id:'task'});assert.equal(pictureTargetSnapshot(c),snapshot)})
test('unrelated metadata save cannot consume model opinions',async t=>{const e=await setupModel(t);await e.store.saveReviewDraft(e.id,e.episodeId,'storyboard:S01','新意见',0);await e.store.save(e.id,{title:'改名'});assert.equal((await e.read()).shots.items[0].storyboard.review.text,'新意见')})
test('draft optimistic revision rejects a stale browser edit',async t=>{const e=await setupModel(t);await e.store.saveReviewDraft(e.id,e.episodeId,'storyboard:S01','新版',0);await assert.rejects(e.store.saveReviewDraft(e.id,e.episodeId,'storyboard:S01','旧版',0),{status:409});assert.equal((await e.read()).shots.items[0].storyboard.review.text,'新版')})
test('bad shot format fails review, keeps existing shots and opinion after maxRevisions (default 2) rounds',async t=>{const e=await setupModel(t),before=await e.read();let calls=0;await assert.rejects(runOperation(e.op('shot-table', {review:'调整'}),{home:e.home,generateShots:opts=>generateShots({...opts,request:async ({ skill: s }) =>{calls++;return s==='review'?reviewPass:'{invalid json'}})}),/JSON/);const p=await e.read();assert.equal(calls,6);assert.deepEqual(p.shots.items.map(s=>s.content),before.shots.items.map(s=>s.content));assert.equal(p.shots.status,'failed');assert.equal(p.shots.error,null);assert.ok(p.shots.check.failures.some(reason=>reason.includes('JSON')));assert.equal(p.shots.review.text,'调整');assert.equal(p.shots.operation,null)})

test('batch film stays generating until download and local save complete', async t => {
  const e = await setupModel(t)
  let calls = 0
  await runOperation(e.op('film', { ...{}, parts: 'video' }), {
    home: e.home,
    submitH3: async () => ({ baseUrl: 'https://test', shots: [{ promptId: 'task', duration: 5 }] }),
    retrieveGatewayVideo: async () => {
      const p = await e.read(), current = p.shots.items[calls++]
      assert.equal(current.video.status, 'generating')
      assert.equal(current.video.content.status, 'running')
      assert.ok(current.video.operation)
      return Buffer.from('test-video')
    },
    saveLastFrame: async (_input, output) => { const { writeFile } = await import('node:fs/promises'); await writeFile(output, Buffer.from('frame')) },
  })
  assert.equal(calls, 2)
  assert.ok((await e.read()).shots.items.every(s => s.video.status === 'passed' && s.video.content.status === 'ready'))
})

// 重试即重新生成：已完成的镜头不重交，失败的镜头重新提交，不续查旧远端任务。
test('one-click retry does not regenerate clips completed before a later failure', async t => {
  const e = await setupModel(t), submitted = []
  let failSecond = true
  const deps = {
    home: e.home,
    submitH3: async ({items}) => { submitted.push(items[0].track); return { baseUrl: 'https://test', shots: [{ promptId: items[0].track, duration: 5 }] } },
    retrieveGatewayVideo: async ({promptId}) => { if (promptId === 'S02' && failSecond) throw new Error('remote failure'); return Buffer.from('video') },
    saveLastFrame: async (_input, output) => { const { writeFile } = await import('node:fs/promises'); await writeFile(output, Buffer.from('frame')) },
  }
  await assert.rejects(runOperation(e.op('film', { ...{}, parts: 'video' }), deps), /remote failure/)
  assert.equal((await e.read()).shots.items[0].video.status, 'passed')
  failSecond = false
  await runOperation(e.op('film'), deps)
  assert.deepEqual(submitted, ['S01','S02','S02'])
  assert.ok((await e.read()).shots.items.every(s => s.video.status === 'passed'))
})

for (const action of ['storyboard']) {
  test(`${action} failure preserves unprocessed shot media`, async t => {
    const e = await setupModel(t)
    await e.store.save(e.id, p => {
      for (const shot of p.episodes[0].shots.items) {
        shot.video.content = { status: 'ready', url: `${shot.id}.mp4` }
      }
      return p
    })
    await e.store.save(e.id,p=>{p.episodes[0].shots.items[0].seconds.content.beats[0].action='【错误|C99】';return p})
    const before = (await e.read()).shots.items[1]
    const { generateStoryboard } = await import('../server/flow/tasks/text/task-storyboard-prompt.js')
    await assert.rejects(runOperation(e.op(action), {
      home: e.home,
      generateShotSeconds: opts => generateShotSeconds({ ...opts, request: reply('新每秒指令') }),
      generateShotStoryboard: opts => generateShotStoryboard({ ...opts, request: reply('新文本分镜', reviewFail('动作冲突')) }),
      generateStoryboard: opts => generateStoryboard({ ...opts, request: reply('新文本分镜', reviewFail('动作冲突')) }),
    }), /自审未通过/)
    const after = (await e.read()).shots.items
    assert.equal(after[0].video.content, null)
    assert.deepEqual(after[1].video, before.video)
    assert.deepEqual(after[1].storyboard.content, before.storyboard.content)
  })
}

test('aborted operation does not invoke generation', async t => {
 const e=await setupModel(t), controller=new AbortController();controller.abort()
 await assert.rejects(runOperation(e.op('seconds'),{home:e.home,signal:controller.signal,generateAllSeconds:()=>{assert.fail('must not generate')}}),{name:'AbortError'})
})

test('failed frame extraction keeps newly completed video ready', async t => {
 const e=await setupModel(t)
 const {readFile}=await import('node:fs/promises')
 const deps={home:e.home,submitH3:async()=>({baseUrl:'https://test',shots:[{promptId:'task',duration:5}]}),retrieveGatewayVideo:async()=>Buffer.from('old-video'),saveLastFrame:async()=>Buffer.from('frame')}
 await runOperation(e.op('film', { ...{}, parts: 'video' }),deps)
 const before=(await e.read()).shots.items[0].video.content
 await e.store.save(e.id,p=>{p.episodes[0].shots.items[0].video.stale=true;return p})
 await assert.rejects(runOperation(e.op('film', { ...{}, parts: 'video' }),{...deps,retrieveGatewayVideo:async()=>Buffer.from('new-video'),saveLastFrame:async()=>{throw new Error('frame failed')}}), /frame failed/)
 const after=(await e.read()).shots.items[0].video.content
 assert.notEqual(after.file,before.file)
 assert.equal(after.status,'ready')
 assert.equal((await e.read()).shots.items[0].tailFrame.status,'failed')
 assert.equal(await readFile(`${e.home}/storages/meiji/projects/${e.id}/films/${e.episodeId}/${before.file}`,'utf8'),'old-video')
})

test('running text API receives the operation cancellation signal', async t => {
 const e=await setupModel(t), controller=new AbortController()
 const { completeChat } = await import('../server/gateway/model-gateway.js')
 await assert.rejects(runOperation(e.op('seconds', {track:'S01'}),{
  home:e.home,signal:controller.signal,
  generateShotSeconds:()=>completeChat({baseUrl:'https://test/',apiKey:'test',model:'test',prompt:'test',fetchImpl:async(_url,{signal})=>{
   controller.abort();signal.throwIfAborted();assert.fail('request must abort')
  }})
 }),{name:'AbortError'})
 assert.equal((await e.read()).shots.items[0].seconds.operation,null)
})

test('storyboard regenerates all shots even when already passed', async t => {
 const e=await setupModel(t)
 const { modelStore } = await import('../server/data/model-settings.js')
 const models=modelStore(e.home);await models.write({...await models.read(),apiKey:'test-only'})
 const { generateStoryboard } = await import('../server/flow/tasks/text/task-storyboard-prompt.js')
 const calls=[]
 const deps={home:e.home,generateStoryboard:opts=>generateStoryboard({...opts,request:async ({ skill, user: prompt }) =>{
  if(skill==='review')return reviewPass
  calls.push(/仅为 (S\d+) 将已通过的每秒指令/.exec(prompt)[1]);return storyboardFixture(prompt)
 }})}
 await runOperation(e.op('film', { ...{}, parts: 'storyboard' }),deps)
 assert.deepEqual(calls,[]);assert.ok((await e.read()).shots.items.every(s=>s.storyboard.content.compilerVersion===1))
 calls.length=0
 await runOperation(e.op('film', { ...{}, parts: 'storyboard' }),deps)
 assert.deepEqual(calls,[]);assert.ok((await e.read()).shots.items.every(s=>s.storyboard.content.compilerVersion===1))
})
