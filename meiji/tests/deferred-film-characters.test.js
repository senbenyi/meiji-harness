import test from 'node:test'
import assert from 'node:assert/strict'
import { episodeFixture, setupModel } from './fixtures/model.js'
import { reviewPass } from './fixtures/review-result.js'
import { useWorkspaces } from './fixtures/host.js'
import { validateSeconds } from '../shared/seconds-content.js'
import { planRun } from '../shared/run-planner.js'
import { canGenerate } from '../shared/generation-gates.js'
import { filmCharacterBasis, filmCharactersReady } from '../shared/film-characters.js'
import { compileVideoPrompt } from '../server/prompts/video-prompt-renderer.js'
import { buildTablePrompts, buildSecondsPrompts, buildSingleShotPrompts } from '../server/prompts/shot-text-prompts.js'
import { storyboardContext } from '../server/prompts/storyboard-context.js'
import { checkContext } from '../server/runtime/operation-context.js'
import { createRunService } from '../server/flow/runs/run-service.js'
import { executeRunStep } from '../server/flow/shared/task-executor.js'
import { linkStore } from '../server/data/workspace-links.js'
import { node, setContent, cardModel } from '../shared/drama-model.js'
import { cascade } from '../shared/pipeline-cascade.js'
import { migrateSeconds } from '../scripts/migrate-seconds-content.js'
import { normalizeCharacters } from '../shared/story-content.js'
import { createLibraryEntry, mergeLibraryGroup } from '../shared/library-rules.js'
import { promptData } from './fixtures/prompt-data.js'

const sessionId = 'session-11111111-1111-4111-8111-111111111111'
function namedContent(shot) {
  const content = JSON.parse(JSON.stringify(shot.seconds.content).replace(/【([^|]+)\|[^】]+】/g, '$1'))
  content.version = 2
  content.participants = [{ name: '旅人', presence: 'visible', outfit: '长衣、黑色长裤，本镜着装不变' }]
  content.dialogues = [{ id: 'D01', speakerName: '旅人', text: '我到了。', language: 'zh-CN', startMs: 0, endMs: 2000, delivery: 'on', performance: '平静，开口' }]
  content.beats[0].dialogueIds = ['D01']
  return content
}
function namedProject() {
  const project = episodeFixture()
  project.plot.characters.items = []; project.plot.characters.check.passed = null
  project.plot.scenes.items = []
  for (const shot of project.shots.items) shot.seconds.content = namedContent(shot)
  return project
}

test('无人物卡可规划镜头及指令；请求使用自然称谓和新版协议', () => {
  const project = namedProject()
  assert.equal(canGenerate(project, 'shots'), true)
  for (const to of ['shots', 'seconds']) {
    const plan = planRun(project, { to, mode: 'regenerate' })
    assert.deepEqual(plan.blockers, [])
    assert.ok(!plan.steps.some(step => step.target === 'characters' || step.kind === 'image'))
  }
  const table = buildTablePrompts({ project }).generation
  const seconds = buildSecondsPrompts({ project, shotId: 'S01' }).generation
  assert.doesNotMatch(table.user, /【实体引用清单】|旅人【旅人\|/)
  assert.match(seconds.system, /version（固定为 2）/)
  assert.match(seconds.system, /speakerName/)
  assert.doesNotMatch(seconds.system, /speakerId（人物 ID/)
  assert.doesNotThrow(() => validateSeconds(project.shots.items[0].seconds.content, project.shots.items[0], project))
})

test('有角色卡也不注入前期请求，生成/审核/修订只从剧情读取人物事实', () => {
  const project = episodeFixture()
  const card = project.plot.characters.items[0]
  card.look = '人物卡外貌哨兵不可出现在前期请求'
  card.identity = '人物卡身份哨兵不可出现在前期请求'
  const before = structuredClone(project)
  for (const generationMode of ['regenerate', 'modify']) checkContext.run({ generationMode, originalProject: project, review: '保留台词，修正动作' }, () => {
    for (const build of [buildTablePrompts, buildSingleShotPrompts, buildSecondsPrompts]) {
      const prompts = build({ project, shotId: build === buildTablePrompts ? undefined : 'S02' })
      for (const message of [prompts.generation, prompts.review('待审正文'), prompts.revision('当前失败稿', '修正衔接')]) {
        const text = message.system + '\n' + message.user
        assert.doesNotMatch(text, /【人物称谓规则】|上游事实：人物资料|上游事实：本镜.*关联人物|人物卡外貌哨兵|人物卡身份哨兵/)
        assert.doesNotMatch(message.system, /清单内实体.*名字【名字\|ID】|角色与参考图在直接成片时|角色提取和素材绑定在成片时/)
        assert.match(message.user, /旅人|当前失败稿/)
        assert.match(message.user, /剧情大纲/)
      }
      assert.match(prompts.generation.system, /沿用上游人物称谓，正文直接使用名称/)
    }
  })
  const context = storyboardContext({ project, shot: project.shots.items[0], video: 'reference', characters: ['旅人'] })
  assert.match(JSON.stringify(context), /人物卡外貌哨兵|人物卡身份哨兵/)
  assert.deepEqual(project, before)
})

test('新版对白仍校验说话人、旁白、时长及唯一引用', () => {
  const project = namedProject(), shot = project.shots.items[0], content = shot.seconds.content
  const original = structuredClone(content)
  for (const patch of [{ speakerName: '' }, { speakerName: 'NARRATOR', delivery: 'on' }, { endMs: 6000 }]) {
    Object.assign(content.dialogues[0], patch)
    assert.throws(() => validateSeconds(content, shot, project))
    Object.assign(content.dialogues[0], original.dialogues[0])
  }
  content.beats[0].dialogueIds.push('D01')
  assert.throws(() => validateSeconds(content, shot, project), /只能引用一次/)
})

test('跨镜名称在编译副本绑定同一图片，不改写原指令和台词', () => {
  const project = namedProject()
  project.plot.characters.items = [cardModel({ id: 'C03', name: '旅人', type: 'role', image: { ...node('image:C03'), content: { assetId: 'person', localPath: '/person.png', assetCategory: 'characters' } } })]
  const before = structuredClone(project)
  for (const shot of project.shots.items) {
    const out = compileVideoPrompt(project, shot)
    assert.equal(out.referenceSnapshot[0].assetId, 'person')
    assert.deepEqual(out.entityIds, ['C03'])
    assert.match(out.prompt.text, /<Subject 1>（旅人）/)
    assert.match(out.prompt.text, /0–2s <Subject 1>（旅人） \(S1\)，画内/)
    assert.equal(out.prompt.text.split('我到了。').length - 1, 1)
    assert.doesNotMatch(out.prompt.text, /【|undefined/)
  }
  assert.deepEqual(project, before)
})

test('成片人物来源变更需重提取，图片变化只删除成片；旧指令迁移保留新版', () => {
  const project = namedProject()
  project.plot.characters.check.passed = true
  project.plot.characters.secondsSource = filmCharacterBasis(project)
  assert.equal(filmCharactersReady(project), true)
  project.shots.items[0].seconds.content.summary += '，旅人停下'
  assert.equal(filmCharactersReady(project), false)
  const out = cascade(project, { type: 'image', itemId: 'C03', name: '旅人' }).patch
  assert.deepEqual(out.shots.items.map(shot => shot.seconds.content), project.shots.items.map(shot => shot.seconds.content))
  assert.ok(out.shots.items.every(shot => !shot.storyboard.content))
  assert.equal(migrateSeconds({ episodes: [project] }), false)
})

async function setup(t, { source = 'current' } = {}) {
  const e = await setupModel(t), events = [], requests = [], contents = e.episode.shots.items.map(namedContent)
  useWorkspaces(t); await linkStore(e.home).selectProject(sessionId, e.id, e.store)
  let desired
  await e.store.save(e.id, root => {
    const p = root.episodes[0]
    for (const shot of p.shots.items) setContent(shot.seconds, contents.find(c => c.shotId === shot.id), {passed:true,failures:[]})
    p.plot.scenes.items=[]; p.plot.characters.secondsSource=null
    if(source==='empty') {
      p.plot.characters.items=[]
      for(const shot of p.shots.items){const c=shot.seconds.content;c.participants=[];c.summary='空庭院';for(const beat of c.beats)for(const field of ['action','camera','space','endState'])beat[field]='庭院中风吹草叶';c.dialogues[0].speakerName='NARRATOR';c.dialogues[0].delivery='off'}
    } else if(source==='voice') {
      p.plot.characters.items=[cardModel({id:'C01',name:'旅人',presence:'voice',identity:'电话旅人',voiceDescription:'成年男声，低沉，普通话'})]
      for(const shot of p.shots.items){const c=shot.seconds.content;c.participants=[{name:'旅人',presence:'voice'}];c.summary='空庭院传来旅人的声音';for(const beat of c.beats)for(const field of ['action','camera','space','endState'])beat[field]='空庭院中风吹草叶';c.dialogues[0].delivery='off'}
    } else if(source==='missing') p.plot.characters.items=[]
    else if(source==='library') {
      const card=p.plot.characters.items[0]
      createLibraryEntry(root,'characters',{...card,name:'餐馆老板',aliases:['旅人']})
      p.plot.characters.items=[]
    }
    desired=p.shots.items.map(shot=>structuredClone(shot.seconds.content))
    return root
  })
  for(const content of desired)await e.store.save(e.id,root=>{setContent(root.episodes[0].shots.items.find(s=>s.id===content.shotId).seconds,content,{passed:true,failures:[]});return root})
  const service=createRunService({home:e.home,execute:async(run,step,deps)=>{
    events.push(step.key)
    if(['video','tail'].includes(step.kind))return {}
    return executeRunStep(run,step,deps)
  },deps:{
    request:async message=>{requests.push(message);if(message.skill==='review')return reviewPass;if(/依据本镜叙事与关联资料生成/.test(message.user)){const id=promptData(message.user,'【本次要求】').shotId;return JSON.stringify({shots:[contents.find(c=>c.shotId===id)]})}assert.fail('成片不得调用人物模型')},
    submitAssetImage:()=>assert.fail('成片不得自动生图'),
  }})
  t.after(()=>service.dispose())
  return {...e,service,events,requests,start:async(goal={to:'film'})=>{const {run}=await service.plan({projectId:e.id,episodeId:e.episodeId,goal},sessionId);assert.ok(!run.steps.some(s=>s.target==='characters'||s.kind==='image'||s.target==='images:film-characters'));await service.confirm(e.id,run.id,sessionId,{confirmDelete:true});return run.id}}
}

for(const source of ['current','library','voice','empty','missing'])test(`完整成片直接读取${source}角色，无人物生成、自审或生图`,async t=>{
 const e=await setup(t,{source}),before=await e.read(),id=await e.start();await e.service.drain()
 const run=await e.service.get(e.id,id,sessionId),saved=await e.read()
 assert.equal(e.requests.length,0)
 assert.ok(!e.events.some(key=>/characters|image@/.test(key)))
 assert.deepEqual(saved.plot.characters.items,before.plot.characters.items)
 assert.deepEqual(saved.library,before.library)
 assert.deepEqual(saved.shots.items.map(s=>s.seconds.content),before.shots.items.map(s=>s.seconds.content))
 if(source==='missing'){assert.equal(run.status,'failed');assert.match(run.failure.message,/旅人.*缺少人物资料/);assert.ok(!e.events.some(key=>key.startsWith('video@')))}
 else {
  assert.equal(run.status,'completed',JSON.stringify({failure:run.failure,pause:run.pause}))
  if(source==='voice'){assert.match(saved.shots.items[0].storyboard.content.prompt.text,/固定声音特征：成年男声/);assert.doesNotMatch(saved.shots.items[0].storyboard.content.prompt.text,/<Subject|<Picture/)}
  if(source==='library')assert.match(saved.shots.items[0].storyboard.content.prompt.text,/餐馆老板/)
  if(source==='empty')assert.match(saved.shots.items[0].storyboard.content.prompt.text,/独立画外旁白/)
 }
})

test('同任务生成新版每秒指令后直接编译，不插入人物准备',async t=>{
 const e=await setup(t);const id=await e.start({from:'seconds',to:'film',mode:'regenerate'});await e.service.drain()
 const run=await e.service.get(e.id,id,sessionId)
 assert.equal(run.status,'completed',JSON.stringify({failure:run.failure,pause:run.pause}));assert.ok(e.requests.length>0)
 assert.ok(!run.steps.some(s=>s.target==='characters'||s.kind==='image'))
})

test('补做后镜成片保留已完成前镜视频与角色资料',async t=>{
 const e=await setup(t);await e.store.save(e.id,root=>{setContent(root.episodes[0].shots.items[0].video,{status:'ready',file:'existing.mp4'},{passed:true,failures:[]});return root})
 const before=await e.read(),id=await e.start();await e.service.drain();const run=await e.service.get(e.id,id,sessionId),saved=await e.read()
 assert.equal(run.status,'completed',JSON.stringify({failure:run.failure,pause:run.pause}));assert.deepEqual(saved.shots.items[0].video.content,before.shots.items[0].video.content);assert.deepEqual(saved.plot.characters.items,before.plot.characters.items);assert.ok(!e.events.includes('video@film:S01'))
})

test('逐镜执行前镜新尾帧后，重编规划时已跳过的后镜提示词再提交',async t=>{
 const e=await setupModel(t);useWorkspaces(t);await linkStore(e.home).selectProject(sessionId,e.id,e.store)
 await e.store.save(e.id,root=>{setContent(root.episodes[0].plot.scenes.items[0].image,{localPath:'/scene.png'},{passed:true,failures:[]});return root})
 for(const original of e.episode.shots.items)await e.store.save(e.id,root=>{const shot=root.episodes[0].shots.items.find(s=>s.id===original.id);setContent(shot.seconds,namedContent(original),{passed:true,failures:[]});shot.video.content=null;shot.tailFrame.content=null;return root})
 for(const original of e.episode.shots.items){const p=await e.read(),shot=p.shots.items.find(s=>s.id===original.id),board=compileVideoPrompt(p,shot);await e.store.save(e.id,root=>{setContent(root.episodes[0].shots.items.find(s=>s.id===shot.id).storyboard,board,{passed:true,failures:[]});return root})}
 const events=[]
 const service=createRunService({home:e.home,execute:async(run,step,deps)=>{
  events.push(step.key)
  if(step.kind==='video'){const p=await e.read(),shot=p.shots.items.find(s=>s.id===step.input.operation.track);assert.deepEqual(shot.storyboard.content.referenceSnapshot,compileVideoPrompt(p,shot).referenceSnapshot);await e.store.save(e.id,root=>{setContent(root.episodes[0].shots.items.find(s=>s.id===shot.id).video,{status:'ready',file:shot.id+'.mp4'},{passed:true,failures:[]});return root});return {}}
  if(step.kind==='tail'){await e.store.save(e.id,root=>{const shot=root.episodes[0].shots.items.find(s=>s.id===step.input.operation.track);setContent(shot.tailFrame,{sourceVideoFile:shot.id+'.mp4',localPath:'/films/'+shot.id+'-last.png'},{passed:true,failures:[]});return root});return {}}
  return executeRunStep(run,step,deps)
 },deps:{request:()=>assert.fail('禁止人物模型'),submitAssetImage:()=>assert.fail('禁止生图')}});t.after(()=>service.dispose())
 const {run:preview}=await service.plan({projectId:e.id,episodeId:e.episodeId,goal:{to:'film'}},sessionId)
 assert.equal(preview.steps.find(s=>s.target==='storyboard:S02').status,'skipped')
 await service.confirm(e.id,preview.id,sessionId,{confirmDelete:true});await service.drain();const run=await service.get(e.id,preview.id,sessionId),p=await e.read()
 assert.equal(run.status,'completed',JSON.stringify({failure:run.failure,pause:run.pause}));assert.ok(events.indexOf('tail@film:S01')<events.indexOf('storyboard@storyboard:S02'),JSON.stringify(events));assert.ok(events.indexOf('storyboard@storyboard:S02')<events.indexOf('video@film:S02'));assert.equal(p.shots.items[1].storyboard.content.tailReference.sourceShotId,'S01')
})

test('服装穿脱、情绪与对白表演从每秒状态原样编排，不改角色资料',()=>{
 const p=episodeFixture();p.plot.scenes.items=[];const shot=p.shots.items[0];shot.seconds.content=namedContent(shot)
 shot.seconds.content.beats[0].action='旅人原穿长衣，解开外套纽扣，双手脱下外套放在椅背，皱眉压抑怒意'
 shot.seconds.content.beats[0].endState='旅人外套已脱下置于椅背，仍穿内层长衣，双手握紧'
 shot.seconds.content.dialogues[0].performance='压低声音，克制愤怒，开口说话'
 const before=structuredClone(p),text=compileVideoPrompt(p,shot).prompt.text
 for(const phrase of ['外套纽扣','外套已脱下置于椅背','仍穿内层长衣','克制愤怒'])assert.ok(text.includes(phrase),phrase)
 assert.deepEqual(p,before)
 const prompts=buildSecondsPrompts({project:p,shotId:shot.id})
 assert.match(prompts.generation.system,/服装状态与当下表演/);assert.match(prompts.revision('基稿','调整情绪').system,/服装状态与当下表演/);assert.match(prompts.review(JSON.stringify(shot.seconds.content)).system,/服装与表演验收/)
})

test('新每秒响应必须返回AI参与清单，校验重复、类型及对白出镜一致性', async () => {
 const {parseSecondsResponse}=await import('../shared/seconds-content.js')
 const p=namedProject(),s=p.shots.items[0],base=structuredClone(s.seconds.content)
 p.plot.characters.items=[cardModel({id:'C01',name:'旅人'})]
 const parse=c=>parseSecondsResponse(JSON.stringify({shots:[c]}),[s],p)
 assert.doesNotThrow(()=>parse(base))
 const missing=structuredClone(base);delete missing.participants
 assert.throws(()=>parse(missing),/必须返回participants/)
 // 老的已保存指令仍兼容。
 assert.doesNotThrow(()=>validateSeconds(missing,s,p))
 for(const participants of [[],[{name:'旅人',presence:'voice'}],[{name:'旅人',presence:'wrong'}],[{name:'旅人',presence:'visible'},{name:'旅人',presence:'visible'}]]){
  assert.throws(()=>parse({...base,participants}),/participants/)
 }
 const noCard=structuredClone(p);noCard.plot.characters.items=[]
 assert.doesNotThrow(()=>validateSeconds(base,s,noCard))
 const prompts=buildSecondsPrompts({project:p,shotId:s.id})
 assert.match(prompts.generation.system,/participants.*visible/s)
 assert.match(prompts.review(base).system,/participants/)
})

