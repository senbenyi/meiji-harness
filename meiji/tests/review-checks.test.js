import { storyboardFixture } from './fixtures/storyboard.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import { setupModel } from './fixtures/model.js'
import { runOperation } from '../server/flow/operations/run.js'
import { scopeProjects } from '../server/data/episodes.js'
import { generateShotSeconds, generateShotStoryboard, generateShots } from '../server/generate/shot-text.js'
import { checkReasons, setCheck } from '../server/data/review-checks.js'
import { targetNode, begin, saveReview, finish } from '../shared/drama-model.js'
import { pictureTargetSnapshot } from '../server/data/pictures.js'
const reply=(text,verdict='PASS')=>async ({ skill }) =>skill==='review'?verdict:text
// 意见只在「按意见修改」时由调用方显式传入；失败后保留在节点上供再次修改。
test('generation failure retains opinion and content, modify retry consumes opinion on success',async t=>{const e=await setupModel(t);await assert.rejects(runOperation(e.op('shot-seconds',{track:'S01',review:'不要转身'}),{home:e.home,generateShotSeconds:async()=>{throw new Error('网络失败')}}),/网络失败/);let p=await e.read();assert.equal(p.shots.items[0].seconds.review.text,'不要转身');assert.ok(p.shots.items[0].seconds.content);await runOperation(e.op('shot-seconds',{track:'S01',generationMode:'modify',review:p.shots.items[0].seconds.review.text}),{home:e.home,generateShotSeconds:opts=>{assert.match(opts.review,/不要转身/);return generateShotSeconds({...opts,request:reply('0–5s 朝北不转身')})}});p=await e.read();assert.equal(p.shots.items[0].seconds.review.text,'');assert.equal(p.shots.items[0].seconds.status,'passed')})
test('self-check failure and human opinion remain distinct',async t=>{const e=await setupModel(t);await runOperation(e.op('shot-seconds',{track:'S01',review:'保留动作'}),{home:e.home,generateShotSeconds:opts=>generateShotSeconds({...opts,request:reply('新的指令','FAIL\n缺少空间')})});const n=(await e.read()).shots.items[0].seconds;assert.equal(n.review.text,'保留动作');assert.deepEqual(n.check.failures,['FAIL\n缺少空间']);assert.equal(n.status,'failed');assert.equal(n.content,'新的指令')})
test('new human draft during a running operation is never cleared or overwritten',async t=>{const e=await setupModel(t);await runOperation(e.op('shot-seconds',{track:'S01',review:'本次修改'}),{home:e.home,generateShotSeconds:async opts=>{const n=(await e.read()).shots.items[0].seconds;await e.store.saveReviewDraft(e.id,e.episodeId,n.id,'下一次意见',n.review.revision);return generateShotSeconds({...opts,request:reply('新指令')})}});const n=(await e.read()).shots.items[0].seconds;assert.equal(n.status,'passed');assert.equal(n.review.text,'下一次意见')})
test('image opinion edits do not change the picture target snapshot',async t=>{const e=await setupModel(t),p=await e.read(),c=p.plot.characters.items[0],snapshot=pictureTargetSnapshot(c);saveReview(c.image,'换背景');begin(c.image,{id:'task'});assert.equal(pictureTargetSnapshot(c),snapshot)})
test('unrelated metadata save cannot consume model opinions',async t=>{const e=await setupModel(t);await e.store.saveReviewDraft(e.id,e.episodeId,'storyboard:S01','新意见',0);await e.store.save(e.id,{title:'改名'});assert.equal((await e.read()).shots.items[0].storyboard.review.text,'新意见')})
test('draft optimistic revision rejects a stale browser edit',async t=>{const e=await setupModel(t);await e.store.saveReviewDraft(e.id,e.episodeId,'storyboard:S01','新版',0);await assert.rejects(e.store.saveReviewDraft(e.id,e.episodeId,'storyboard:S01','旧版',0),{status:409});assert.equal((await e.read()).shots.items[0].storyboard.review.text,'新版')})
test('bad shot format fails the task, keeps existing shots and the opinion, and does not retry',async t=>{const e=await setupModel(t),before=await e.read();let calls=0;await assert.rejects(runOperation(e.op('shots',{review:'调整'}),{home:e.home,generateShots:opts=>generateShots({...opts,request:async ({ skill: s }) =>{calls++;return s==='review'?'PASS':'{invalid json'}})}),/镜头表需按/);const p=await e.read();assert.equal(calls,1);assert.deepEqual(p.shots.items.map(s=>s.content),before.shots.items.map(s=>s.content));assert.equal(p.shots.status,'failed');assert.match(p.shots.error,/镜头表需按/);assert.equal(p.shots.review.text,'调整');assert.equal(p.shots.operation,null)})

test('batch film stays generating until download and local save complete', async t => {
  const e = await setupModel(t)
  let calls = 0
  await runOperation(e.op('films'), {
    home: e.home,
    submitH3: async () => ({ baseUrl: 'https://test', shots: [{ promptId: 'task', duration: 5 }] }),
    retrieveFilm: async () => {
      const p = await e.read(), current = p.shots.items[calls++]
      assert.equal(current.video.status, 'generating')
      assert.equal(current.video.content.status, 'running')
      assert.ok(current.video.operation)
      return Buffer.from('test-video')
    },
    saveLastFrame: async () => Buffer.from('frame'),
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
    retrieveFilm: async ({promptId}) => { if (promptId === 'S02' && failSecond) throw new Error('remote failure'); return Buffer.from('video') },
    saveLastFrame: async () => Buffer.from('frame'),
  }
  await assert.rejects(runOperation(e.op('films'), deps), /remote failure/)
  assert.equal((await e.read()).shots.items[0].video.status, 'passed')
  failSecond = false
  await runOperation(e.op('films'), deps)
  assert.deepEqual(submitted, ['S01','S02','S02'])
  assert.ok((await e.read()).shots.items.every(s => s.video.status === 'passed'))
})

for (const action of ['storyboard']) {
  test(`${action} failure preserves unprocessed shot media`, async t => {
    const e = await setupModel(t)
    await e.store.save(e.id, p => {
      for (const shot of p.episodes[0].shots.items) {
        shot.pencil.content = { url: `${shot.id}.png` }
        shot.video.content = { status: 'ready', url: `${shot.id}.mp4` }
      }
      return p
    })
    const before = (await e.read()).shots.items[1]
    const { generateStoryboard } = await import('../server/generate/shot-text.js')
    await assert.rejects(runOperation(e.op(action), {
      home: e.home,
      generateShotSeconds: opts => generateShotSeconds({ ...opts, request: reply('新每秒指令') }),
      generateShotStoryboard: opts => generateShotStoryboard({ ...opts, request: reply('新文本分镜', 'FAIL 动作冲突') }),
      generateStoryboard: opts => generateStoryboard({ ...opts, request: reply('新文本分镜', 'FAIL 动作冲突') }),
    }), /自检未通过/)
    const after = (await e.read()).shots.items
    assert.equal(after[0].pencil.content, null)
    assert.equal(after[0].video.content, null)
    assert.deepEqual(after[1].pencil, before.pencil)
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
 const deps={home:e.home,submitH3:async()=>({baseUrl:'https://test',shots:[{promptId:'task',duration:5}]}),retrieveFilm:async()=>Buffer.from('old-video'),saveLastFrame:async()=>Buffer.from('frame')}
 await runOperation(e.op('films'),deps)
 const before=(await e.read()).shots.items[0].video.content
 await e.store.save(e.id,p=>{p.episodes[0].shots.items[0].video.stale=true;return p})
 await assert.rejects(runOperation(e.op('films'),{...deps,retrieveFilm:async()=>Buffer.from('new-video'),saveLastFrame:async()=>{throw new Error('frame failed')}}), /frame failed/)
 const after=(await e.read()).shots.items[0].video.content
 assert.notEqual(after.file,before.file)
 assert.equal(after.status,'ready')
 assert.equal((await e.read()).shots.items[0].tailFrame.status,'failed')
 assert.equal(await readFile(`${e.home}/storages/meiji/projects/${e.id}/films/${e.episodeId}/${before.file}`,'utf8'),'old-video')
})

test('running text API receives the operation cancellation signal', async t => {
 const e=await setupModel(t), controller=new AbortController()
 const {completeChat}=await import('../server/generate/gateway.js')
 await assert.rejects(runOperation(e.op('shot-seconds',{track:'S01'}),{
  home:e.home,signal:controller.signal,
  generateShotSeconds:()=>completeChat({baseUrl:'https://test/',apiKey:'test',model:'test',prompt:'test',fetchImpl:async(_url,{signal})=>{
   controller.abort();signal.throwIfAborted();assert.fail('request must abort')
  }})
 }),{name:'AbortError'})
 assert.equal((await e.read()).shots.items[0].seconds.operation,null)
})

test('storyboard regenerates all shots even when already passed', async t => {
 const e=await setupModel(t)
 const {modelStore}=await import('../server/data/model-settings.js')
 const models=modelStore(e.home);await models.write({...await models.read(),apiKey:'test-only'})
 const {generateStoryboard}=await import('../server/generate/shot-text.js')
 const calls=[]
 const deps={home:e.home,generateStoryboard:opts=>generateStoryboard({...opts,request:async ({ skill, user: prompt }) =>{
  if(skill==='review')return 'PASS'
  calls.push(/仅为 (S\d+) 将已通过的每秒指令/.exec(prompt)[1]);return storyboardFixture(prompt)
 }})}
 await runOperation(e.op('storyboard'),deps)
 assert.deepEqual(calls,['S01','S02'])
 calls.length=0
 await runOperation(e.op('storyboard'),deps)
 assert.deepEqual(calls,['S01','S02'])
})
