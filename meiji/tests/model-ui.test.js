import { operationRequest } from '../client/operation-request.js'
import { outlineText } from '../shared/story-outline.js'
import { outlineFixture } from './fixtures/story-package.js'
import { tableResponse, singleShotResponse } from './fixtures/shot-response.js'
import { reviewPass } from './fixtures/review-result.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from './fixtures/jsdom.js'
import { episodeFixture, setupModel } from './fixtures/model.js'
import { renderStage } from '../client/generation-stage-views.js'
import { renderModelView, createModelStore } from '../client/drama-store.js'
import { setContent } from '../shared/drama-model.js'
import { secondsContent } from './fixtures/seconds.js'
function domSetup(t) {
 const dom=new JSDOM('<body><main></main></body>',{url:'http://localhost'})
 const prior={document:globalThis.document,window:globalThis.window,CustomEvent:globalThis.CustomEvent}
 Object.assign(globalThis,{document:dom.window.document,window:dom.window,CustomEvent:dom.window.CustomEvent})
 t.after(()=>{Object.assign(globalThis,prior);dom.window.close()})
 return dom.window.document.querySelector('main')
}
test('all production panes render directly from new models, including video and references',t=>{
 const container=domSetup(t),e=episodeFixture();e.episodeId=e.id
 e.plot.characters.items[0].image.content={localPath:'/portrait'}
 e.shots.items[0].storyboard.content.referenceSnapshot=[{id:'C01',url:'/portrait',localPath:'/portrait',kind:'characters',label:'旅人'}]
 e.shots.items[0].storyboard.content.prompt.text='<Subject 1> comes from <Picture 1>'
 const actions={perform:async()=>{},fail:()=>{}}
 for(const step of ['script','shots','film','assembly'])container.replaceChildren(renderStage(step,e,actions,{}))
 for(const shotsPane of ['table','seconds','board']){
  container.replaceChildren(renderStage(shotsPane === 'board' ? 'film' : shotsPane === 'seconds' ? 'seconds' : 'shots',e,actions,{shotsPane}))
  if(shotsPane==='board'){assert.ok(container.querySelector('.reference-card img'));assert.match(container.textContent,/<Subject 1>/);assert.ok(container.querySelector('.storyboard-editor'))}
 }
})
test('镜头表按钮始终可见，缺少道具时禁用，审核通过后刷新启用', async t => {
 const container=domSetup(t), project=episodeFixture(), props=project.plot.props
 project.shots.items=[]
 delete project.plot.props
 let calls=0
 const actions={perform:async()=>{calls++},fail:()=>{}}
 const build=()=>renderStage('shots',project,actions,{})
 renderModelView(container,build())
 let button=container.querySelector('.stage-primary-actions button.primary')
 assert.ok(button)
 assert.equal(button.disabled,true)
 assert.match(container.textContent,/道具尚未提取/)
 assert.match(button.title,/道具尚未提取/)
 button.click()
 assert.equal(calls,0)
 project.plot.props=props
 renderModelView(container,build())
 button=container.querySelector('.stage-primary-actions button.primary')
 assert.equal(button.disabled,false)
 assert.doesNotMatch(container.textContent,/道具尚未提取/)
 button.click()
 await new Promise(resolve=>setImmediate(resolve))
 assert.equal(calls,1)
})
test('partial refresh retains focused draft and does not detach nested reused components',t=>{
 const container=domSetup(t)
 const build=label=>{const root=document.createElement('div');root.innerHTML=`<article data-model-key="one"><input value="draft"><span data-model-key="inside">inside</span></article><article data-model-key="two">${label}</article>`;return root}
 renderModelView(container,build('old'));const input=container.querySelector('input');input.value='未提交文字';input.focus();input.setSelectionRange(2,3)
 renderModelView(container,build('new'));assert.equal(container.querySelector('input'),input);assert.equal(input.value,'未提交文字');assert.equal(document.activeElement,input);assert.equal(input.selectionStart,2);assert.equal(container.querySelector('[data-model-key=inside]').textContent,'inside');assert.equal(container.querySelector('[data-model-key=two]').textContent,'new')
})
test('model store notifies on newer revisions and rejects late responses',async t=>{const e=await setupModel(t),p=await e.store.read(e.id),store=createModelStore();let calls=0;store.subscribe(()=>calls++);store.accept(p);store.accept({...p,revision:p.revision+2,title:'新'});assert.equal(store.accept({...p,title:'旧'}).title,'新');assert.equal(calls,2)})
test('text draft survives reload and does not alter published storyboard',async t=>{const e=await setupModel(t);const before=(await e.read()).shots.items[0].storyboard.content.prompt.text;await e.store.saveReviewDraft(e.id,e.episodeId,'storyboard:S01','未提交正文',0,'text');const model=(await e.read()).shots.items[0].storyboard;assert.equal(model.content.prompt.text,before);assert.equal(model.draft.text,'未提交正文');assert.equal(model.status,'passed')})
test('replacing a picture deletes referenced storyboard and preserves table and seconds', async t => {
 const e = await setupModel(t), before = await e.read()
 await e.store.save(e.id, p => {
  p.episodes[0].plot.characters.items[0].image.content = { localPath: '/plugins/meiji/asset-file?category=characters&id=new' }
  return p
 })
 const ep = await e.read()
 assert.equal(ep.shots.items[0].storyboard.content, null)
 assert.equal(ep.shots.items[0].storyboard.status, 'not-generated')
 assert.equal(ep.shots.items[0].video.content, null)
 assert.deepEqual(ep.shots.items[0].seconds, before.shots.items[0].seconds)
 assert.equal(ep.shots.items[0].content, before.shots.items[0].content)
})
test('project refresh marker reads nested video nodes', async t => {
 const { projectRefreshMark } = await import('../client/chat-bridge.js')
 const e = await setupModel(t), p = await e.store.read(e.id)
 const before = projectRefreshMark(p)
 p.episodes[0].shots.items[0].video.content = { status: 'ready', url: '/new-video' }
 assert.notEqual(projectRefreshMark(p), before)
})
test('shot subtab cards show review failure and retain manual expansion across refresh', t => {
 const container = domSetup(t), e = episodeFixture(); e.episodeId = e.id
 e.shots.items[1] = structuredClone(e.shots.items[0]); e.shots.items[1].id = 'S02'
 e.shots.items[1].storyboard.check = { passed: false, failures: ['角色冲突'] }
 const actions = { perform: async () => {}, fail: () => {} }
 for (const shotsPane of ['table', 'seconds']) {
  const build = () => renderStage(shotsPane === 'seconds' ? 'seconds' : 'shots', e, actions, { shotsPane })
  container.replaceChildren(build())
  const cards = container.querySelectorAll('.collapsible-shot')
  assert.equal(cards.length, 2)
  assert.equal(cards[0].dataset.expanded, 'true'); assert.equal(cards[1].dataset.expanded, 'false')
  if (shotsPane === 'board') assert.ok(cards[1].classList.contains('shot-unpassed'))
  cards[1].querySelector('.shot-collapse').click()
  renderModelView(container, build())
  assert.equal(container.querySelectorAll('.collapsible-shot')[1].dataset.expanded, 'true')
 }
})

test('failed review keeps reasons and accepts an opinion for the unified modification',async t=>{
 const container=domSetup(t),p=episodeFixture();p.episodeId=p.id
 p.shots.items[0].seconds.check={passed:false,failures:['朝向不连续']}
 const calls=[]
 container.replaceChildren(renderStage('seconds',p,{perform:async(...args)=>calls.push(args),fail:()=>{}},{shotsPane:'seconds'}))
 const card=container.querySelector('.shot-card'),area=container.querySelector('.workflow-review-panel')
 assert.ok(area.classList.contains('workflow-review-failed'))
 assert.match(area.textContent,/朝向不连续/)
 const input=area.querySelector('.workflow-review-input');assert.ok(input)
 input.value='保持朝向'
 const button=area.querySelector('.workflow-review-action');assert.equal(button.textContent,'提交修改')
 assert.equal(card.contains(button),false)
 assert.ok(area.compareDocumentPosition(card) & 4)
 assert.equal(container.querySelectorAll('.workflow-review-input').length,1)
 button.click();await Promise.resolve()
 assert.equal(calls[0][1],'seconds');assert.equal(calls[0][2].generationMode,'modify');assert.equal(calls[0][2].review,'保持朝向')
})

test('storyboard badges distinguish missing pending and failed content', t => {
 const container=domSetup(t),e=episodeFixture();e.episodeId=e.id
 const n=e.shots.items[0].storyboard
 for(const [status,content,passed,label,red] of [
  ['not-generated',null,null,'未生成',false],
  ['generating',null,null,'生成中',false],
  ['generating',{prompt:{text:'旧内容'}},false,'生成中',false],
  ['not-generated',{prompt:{text:'待审内容'}},null,'待自审',false],
  ['failed',{prompt:{text:'失败内容'}},false,'自审未通过',true],
  ['passed',{prompt:{text:'通过内容'}},true,'已通过',false],
 ]){
  Object.assign(n,{status,content,error:null,check:{passed,failures:passed===false?['动作错误']:[]}})
  container.replaceChildren(renderStage('film',e,{perform:async()=>{},fail:()=>{}},{shotsPane:'board'}))
  const card=container.querySelector('.shot-card')
  assert.equal(card.querySelector('.shot-check-badge').textContent,label)
  assert.equal(card.classList.contains('shot-unpassed'),red)
 }
})

test('previous tail input is hidden and never replaces missing current video or tail', t => {
 const container=domSetup(t),e=episodeFixture();e.episodeId=e.id
 const s=e.shots.items[1]
 s.storyboard.content.tailReference={sourceShotId:'S01',sourceVideoFile:'previous.mp4'}
 s.video.content=null
 s.tailFrame={status:'passed',content:{sourceVideoFile:'old.mp4',localPath:'/old.png'}}
 container.replaceChildren(renderStage('film',e,{perform:async()=>{},fail:()=>{}},{}))
 const card=container.querySelectorAll('.shot-card')[1]
 assert.doesNotMatch(card.textContent,/输入参考/ )
 assert.equal(card.querySelector('img[alt="上一镜尾帧参考"]'),null)
 assert.match(card.textContent,/本镜视频尚未生成/)
 assert.match(card.textContent,/本镜尾帧尚未生成/)
 assert.equal(card.querySelector('img[alt="本镜尾帧"]'),null)
})

test('generated and revised shot titles appear on production cards', async t => {
 const { generateShots, reviseShot } = await import('../server/flow/tasks/text/task-shot-table.js')
 const container = domSetup(t), project = episodeFixture()
 const request = text => async ({ skill }) => skill === 'review' ? reviewPass : skill === 'shots' ? tableResponse(text) : singleShotResponse(text)
 project.shots = await generateShots({ project, request: request('## S01 / 5s\n标题：夜访庭院\n旅人走到门外。\n\n## S02 / 5s\n标题：叩门待应\n旅人敲门。') })
 assert.match(project.shots.items[0].content, /^标题：夜访庭院/)
 const actions = { perform: async () => {}, fail: () => {} }
 const checkCards = title => {
  for (const shotsPane of ['table', 'seconds', 'board']) {
   container.replaceChildren(renderStage(shotsPane === 'seconds' ? 'seconds' : 'shots', project, actions, { shotsPane }))
   assert.ok([...container.querySelectorAll('h3')].some(el => el.textContent.includes(`S01 / 5s · ${title}`)), shotsPane)
  }
 }
 checkCards('夜访庭院')
 project.shots = await reviseShot({ project, shotId: 'S01', review: '改为风雪中抵达', request: request('- **标题：风雪抵达**\n旅人冒雪抵达门外。') })
 checkCards('风雪抵达')
})

test('JSON 大纲经解析保存后展示真实换行，不展示对象外壳或转义字符', async t => {
 const { generateStoryPackage } = await import('./fixtures/story-generation.js')
 const { runOperation } = await import('./fixtures/operation.js')
 const { outlineFixture, storyPackageFixture } = await import('./fixtures/story-package.js')
 const container = domSetup(t), e = await setupModel(t), fixture = storyPackageFixture()
 const outline = outlineFixture('旅人读到 "明天见"。\n他收起信，望向紧闭的门。')
 const replies = [JSON.stringify(outline), reviewPass, JSON.stringify(fixture.characters), reviewPass,
  JSON.stringify(fixture.scenes), reviewPass, JSON.stringify({ items: [] }), reviewPass]
 await runOperation(e.op('story', {}), { home: e.home, request: async () => replies.shift() })
 const saved = await e.read()
 assert.deepEqual(saved.plot.outline.content, outline)
 container.replaceChildren(renderStage('outline', saved, { perform: async () => {}, fail: () => {} }, {}))
 assert.equal(container.querySelector('pre.story').textContent, outlineText(outline))
 assert.equal(container.querySelector('pre.story').textContent.split('\n\n').length, 7)
})

test('超过15秒的小剧情同名分段标题经保存读回后在各镜头卡片完整展示', async t => {
 const { generateShots,reviseShot }=await import('../server/flow/tasks/text/task-shot-table.js')
 const container=domSetup(t), e=await setupModel(t), project=e.episode
 project.durationSeconds=24
 const raw='## S01 / 12s\n标题：发现旧信1\n旅人在木箱里找到旧信，尚未取出。\n\n## S02 / 8s\n标题：发现旧信2\n旅人取出旧信，辨认封面。\n\n## S03 / 4s\n标题：决定拆读\n旅人准备打开旧信。'
 const request=text=>async ({skill})=>skill==='review'?reviewPass:skill==='shots'?tableResponse(text):singleShotResponse(text,'S02',8)
 const persist=async shots=>{project.shots=shots;await e.store.save(e.id,{episodes:[project]})}
 await generateShots({project,request:request(raw),persist})
 let saved=await e.read()
 assert.deepEqual(saved.shots.items.map(s=>[s.id,s.duration]),[['S01',12],['S02',8],['S03',4]])
 assert.match(saved.shots.items[1].content,/^标题：发现旧信2/)
 const revised=await reviseShot({project:saved,shotId:'S02',review:'补充信封完整',request:request('标题：发现旧信2\n旅人取出封口完整的旧信，辨认封面。')})
 await persist(revised)
 saved=await e.read()
 assert.deepEqual(saved.shots.items[0],revised.items[0])
 const actions={perform:async()=>{},fail:()=>{}}
 for(const stage of ['shots','seconds','film']) {
  container.replaceChildren(renderStage(stage,saved,actions,{}))
  const headings=[...container.querySelectorAll('h3')].map(el=>el.textContent)
  for(const expected of ['S01 / 12s · 发现旧信1','S02 / 8s · 发现旧信2','S03 / 4s · 决定拆读']) assert.ok(headings.includes(expected),`${stage}: ${expected}`)
 }
})

test('log copy copies full content when expanded or collapsed, without duplicate buttons or toggling', async t => {
 const { appendLogCopy } = await import('../client/panel-dom.js')
 const container = domSetup(t)
 const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
 const copied = []
 Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { clipboard: { writeText: async text => copied.push(text) } } })
 t.after(() => { if (descriptor) Object.defineProperty(globalThis, 'navigator', descriptor); else delete globalThis.navigator })
 const card = document.createElement('div')
 const content = '完整请求\n参数：{"prompt":"保留换行和全部正文"}'
 card.innerHTML = '<div data-disclosure-row><span>图标</span><span>日志-用途-发起请求</span><span></span><span></span></div><pre></pre>'
 card.querySelector('pre').textContent = content
 card.querySelector('[data-disclosure-row] > span:last-child').textContent = content
 container.append(card)
 let toggles = 0
 card.onclick = () => { toggles++ }
 appendLogCopy(card); appendLogCopy(card)
 assert.equal(card.querySelectorAll('button').length, 1)
 const button = card.querySelector('button')
 button.click(); await Promise.resolve()
 assert.equal(button.textContent, '已复制')
 card.querySelector('pre').remove()
 button.click(); await Promise.resolve()
 assert.deepEqual(copied, [content, content])
 assert.equal(toggles, 0)
 navigator.clipboard.writeText = async () => { throw new Error('denied') }
 button.click(); await Promise.resolve()
 assert.equal(button.textContent, '复制失败，重试')
 assert.equal(button.disabled, false)
})

test('paused generation shows paused badge and regenerate action without losing its opinion', t => {
 const container=domSetup(t), project=episodeFixture()
 project.shots.items[0].seconds.status='paused'
 project.shots.seconds.review.text='保留动作'
 container.append(renderStage('seconds', project, {perform:async()=>{},fail:()=>{}}, {shotsPane:'seconds'}))
 const card=container.querySelector('[data-model-key="seconds:S01"]') || container.querySelector('.shot-card')
 assert.equal(card.querySelector('.shot-check-badge').textContent,'暂停')
 assert.ok([...container.querySelectorAll('.stage-primary-actions button')].some(button=>button.textContent==='重新生成' && !button.disabled))
 assert.equal(container.querySelector('.workflow-review input').value,'保留动作')
 assert.equal(card.querySelector('input'),null)
})

test('regenerate button never submits the visible previous opinion', async t => {
 const container=domSetup(t),p=episodeFixture();p.episodeId=p.id
 p.shots.seconds.review.text='旧人工意见'
 const calls=[]
 container.replaceChildren(renderStage('seconds',p,{perform:async(...args)=>calls.push(args),fail:()=>{}},{shotsPane:'seconds'}))
 const area=container.querySelector('.workflow-review-panel')
 const regenerate=container.querySelector('.workflow-regenerate'),modify=area.querySelector('button')
 assert.equal(area.contains(regenerate),false)
 assert.equal(regenerate.textContent,'重新生成');assert.equal(modify.textContent,'提交修改')
 regenerate.click();await Promise.resolve()
 assert.equal(calls[0][2].generationMode,'regenerate');assert.equal(calls[0][2].review,undefined)
})
test('batch text controls no longer offer fill remaining',async t=>{
 const container=domSetup(t),p=episodeFixture();p.episodeId=p.id
 for(const shotsPane of ['seconds']){
  const calls=[]
  container.replaceChildren(renderStage(shotsPane === 'seconds' ? 'seconds' : 'shots',p,{perform:async(...args)=>calls.push(args),fail:()=>{}},{shotsPane}))
  assert.doesNotMatch(container.textContent,/补齐剩余/)
  const button=[...container.querySelectorAll('button')].find(b=>b.textContent==='重新生成')
  assert.ok(button);button.click();await Promise.resolve()
  assert.equal(calls[0][2].generationMode,'regenerate');assert.equal(calls[0][2].regenerateAll,undefined)
 }
})
test('table and seconds review panels precede all shot cards; seconds cards have no individual submission',t=>{
 const container=domSetup(t),p=episodeFixture()
 p.shots.check={passed:false,failures:['镜头表失败']}
 p.shots.items[0].seconds.check={passed:false,failures:['第一镜失败']}
 p.shots.items[1].seconds.check={passed:false,failures:['第二镜失败']}
 for(const shotsPane of ['table','seconds']){
  container.replaceChildren(renderStage(shotsPane === 'seconds' ? 'seconds' : 'shots',p,{perform:async()=>{},fail:()=>{}},{shotsPane}))
  const area=container.querySelector('.workflow-review'),cards=container.querySelectorAll('.shot-card')
  assert.ok(area.compareDocumentPosition(cards[0]) & 4)
  assert.equal(container.querySelectorAll('.workflow-review').length,1)
  if(shotsPane==='seconds'){
   assert.match(area.textContent,/S01：第一镜失败/);assert.match(area.textContent,/S02：第二镜失败/)
   for(const card of cards){assert.equal(card.querySelector('input'),null);assert.doesNotMatch(card.textContent,/提交修改|重新生成/);assert.match(card.textContent,/本镜自审未通过/)}
  }
 }
})
test('single shot seconds detail is read only',async t=>{
 const container=domSetup(t),p=episodeFixture(),{renderShotPage}=await import('../client/generation-stage-views.js')
 container.append(renderShotPage(p,p.shots.items[0],{perform:()=>assert.fail('read only')},{shotTab:'seconds'}))
 assert.match(container.textContent,/卡片集顶部统一/)
 assert.equal(container.querySelector('.workflow-review'),null)
})
test('shared review hides empty initial state but displays failures without generated content',async t=>{
 const container=domSetup(t),{appendWorkflowReview}=await import('../client/workflow-review.js')
 const record={id:'seconds',review:{text:'',revision:0},check:{passed:false,failures:['失败原因']}}
 appendWorkflowReview(container,{...record,check:{passed:null,failures:[]}},false)
 assert.equal(container.querySelector('.workflow-review'),null)
 let area=appendWorkflowReview(container,record,false,false,document.createElement('button'))
 assert.ok(area.classList.contains('workflow-review-failed'))
 assert.match(area.textContent,/失败原因/)
 assert.match(area.textContent,/尚未保存可用内容/)
 assert.equal(area.querySelector('input'),null)
 assert.equal(area.querySelector('.workflow-review-override'),null)
 assert.equal(area.querySelector('.workflow-review-action').disabled,true)
 container.replaceChildren()
 area=appendWorkflowReview(container,record,true,false,document.createElement('button'))
 assert.match(area.textContent,/失败原因/)
 container.replaceChildren()
 area=appendWorkflowReview(container,{...record,check:{passed:true,failures:['旧原因']}},true)
 assert.equal(area.querySelector('.workflow-review-failures'),null)
 assert.ok(area.querySelector('input'))
 assert.equal(area.querySelector('.workflow-review-heading'),null)
})
test('shared review displays audit reasons once and preserves independent execution errors',async t=>{
 const container=domSetup(t),{appendWorkflowReview}=await import('../client/workflow-review.js')
 const first='位置：程序校验；原因：S05 节拍总时长3000ms，应为5000ms；修正要求：按该校验要求修正正文'
 const second='S06 节拍总时长3000ms，应为4000ms'
 const record={id:'seconds',check:{passed:false,failures:[first,second]},error:`自检未通过：${first}`}
 for(const prefix of ['自检','自审'])for(const generated of [true,false]){
  container.replaceChildren()
  const area=appendWorkflowReview(container,{...record,error:`${prefix}未通过：${first}`},generated)
  assert.equal(area.textContent.split('S05 节拍总时长3000ms').length-1,1)
  assert.match(area.textContent,/S06 节拍总时长3000ms/)
  assert.doesNotMatch(area.textContent,/执行未通过/)
  assert.equal(area.querySelector('input'),null)
 }
 container.replaceChildren()
 const area=appendWorkflowReview(container,{...record,error:'请求超时，请重试'},true)
 assert.match(area.textContent,/执行未通过：请求超时，请重试/)
 assert.match(area.textContent,/自审未通过：位置：程序校验/)
 container.replaceChildren()
 const errorOnly=appendWorkflowReview(container,{...record,check:{passed:false,failures:[]}},false)
 assert.match(errorOnly.textContent,/S05 节拍总时长3000ms/)
 assert.match(errorOnly.textContent,/尚未保存可用内容/)
 assert.ok(errorOnly.classList.contains('workflow-review-failed'))
})
test('seconds renders unpublished task failure and clears it after a successful refresh',t=>{
 const container=domSetup(t),p=episodeFixture(),calls=[]
 p.shots.items.forEach(shot=>{shot.seconds.content=null;shot.seconds.check={passed:null,failures:[]};shot.seconds.status='not-generated'})
 p.shots.seconds.status='failed';p.shots.seconds.error='自审未通过：S01 节拍总时长5000ms，应为6000ms'
 const build=()=>renderStage('seconds',p,{perform:async(...args)=>calls.push(args),openHistory:()=>{},fail:()=>{}},{})
 container.append(build())
 const area=container.querySelector('.workflow-review-failed')
 assert.ok(area);assert.match(area.textContent,/S01 节拍总时长5000ms，应为6000ms/)
 assert.equal(area.querySelector('.workflow-review-action').disabled,true)
 assert.equal(area.querySelector('.workflow-review-override'),null)
 assert.ok([...container.querySelectorAll('button')].some(b=>/查看.*任务历史/.test(b.textContent)))
 container.querySelector('.workflow-regenerate').click()
 assert.equal(calls[0][2].generationMode,'regenerate')
 p.shots.seconds.error=null;p.shots.seconds.status='passed'
 for(const shot of p.shots.items){shot.seconds.content={beats:[]};shot.seconds.check={passed:true,failures:[]};shot.seconds.status='passed'}
 renderModelView(container,build())
 assert.equal(container.querySelector('.workflow-review-failed'),null)
 assert.doesNotMatch(container.textContent,/5000ms|尚未保存可用内容/)
})
test('seconds retains failed shot text and reasons without offering a format override',t=>{
 const container=domSetup(t),p=episodeFixture()
 p.shots.items[0].seconds.content=secondsContent('S01',3,'本次失败正文仍需查看')
 p.shots.items[0].seconds.check={passed:false,failures:['S01 节拍总时长3000ms，应为5000ms']}
 p.shots.items[0].seconds.status='failed'
 const build=()=>renderStage('seconds',p,{perform:async()=>{},fail:()=>{}},{})
 container.append(build())
 const card=container.querySelector('.shot-card')
 assert.match(card.textContent,/本次失败正文仍需查看/)
 assert.match(card.textContent,/本镜自审未通过：S01 节拍总时长3000ms，应为5000ms/)
 assert.equal(container.querySelector('.workflow-review-override'),null)
 delete p.shots.items[0].seconds.content.beats[0].dialogueIds
 container.replaceChildren(build())
 assert.match(container.querySelector('.shot-card').textContent,/本次失败正文仍需查看/)
 assert.match(container.querySelector('.shot-card').textContent,/"shotId": "S01"/)
})
test('seconds history exposes the complete original response even when JSON is truncated',async t=>{
 const container=domSetup(t),{renderTaskHistory}=await import('../client/execution-history.js')
 const original='{"shots":[{"shotId":"S01","summary":"未截掉的原文'
 const view=renderTaskHistory(episodeFixture(),{historyScope:'seconds',back:()=>{},load:async id=>id
  ? {artifact:{content:{text:original}}}
  : {tasks:[{id:'failed-seconds',action:'seconds',status:'review_failed',nodes:[],artifacts:[{target:'seconds-response',artifactId:'raw-response',version:1}]}]}})
 container.append(view);await Promise.resolve()
 const snapshot=view.querySelector('.task-history-snapshot')
 assert.match(snapshot.querySelector('summary').textContent,/每秒指令原始响应/)
 snapshot.open=true;await snapshot.ontoggle()
 assert.equal(JSON.parse(snapshot.querySelector('pre').textContent).text,original)
})
test('plot has one generation entry and one review for outline, characters and scenes',async t=>{
 const container=domSetup(t),p=episodeFixture(),calls=[]
 p.plot.outline.check={passed:false,failures:['角色与剧情不一致']}
 container.append(renderStage('script',p,{perform:async(...args)=>calls.push(args),beginImage:async()=>{},fail:()=>{}},{}))
 assert.equal(container.querySelectorAll('.workflow-review').length,2)
 const review=container.querySelector('[data-review-target="outline"]')
 assert.ok(review)
 assert.match(review.textContent,/角色与剧情不一致/)
 assert.equal(container.querySelector('[aria-label="编辑大纲"]'),null)
 assert.equal([...container.querySelectorAll('button')].some(b=>b.textContent==='编辑文字'),false)
 const input=review.querySelector('input')
 input.value='将旅人改为女侦探，并同步调整大纲和庭院场景'
 input.dispatchEvent(new window.Event('input'));input.onblur()
 review.querySelector('.workflow-review-action').click();await Promise.resolve()
 assert.equal(calls.length,1);assert.equal(calls[0][1],'outline')
 assert.equal(calls[0][2].generationMode,'modify');assert.equal(calls[0][2].review,input.value)
 assert.ok(review.compareDocumentPosition(container.querySelector('.character-list'))&4)
})
test('empty plot has a unified generate button and no separate card review',async t=>{
 const container=domSetup(t),p=episodeFixture(),calls=[]
 p.plot.outline.content='';p.plot.characters.items=[];p.plot.scenes.items=[];p.plot.props.check.passed=null
 container.append(renderStage('script',p,{perform:async(...args)=>calls.push(args),fail:()=>{}},{}))
 assert.equal(container.querySelectorAll('.workflow-review').length,0)
 const button=container.querySelector('[aria-label="生成剧情"]');assert.ok(button);assert.equal(button.disabled,false)
 button.click();await Promise.resolve()
 assert.equal(calls[0][1],'outline');assert.equal(calls[0][2].generationMode,'regenerate')
})
test('film shows review only for existing content and independently for generated video',async t=>{
 const container=domSetup(t),p=episodeFixture(),calls=[]
 container.append(renderStage('film',p,{perform:async(...args)=>calls.push(args),fail:()=>{}},{}))
 const card=container.querySelector('.shot-card'),story=card.querySelector('.film-storyboard-section'),video=card.querySelector('.film-video-section')
 assert.equal(story.lastElementChild.dataset.reviewTarget,'storyboard:S01')
 assert.equal(video.querySelector('.workflow-review'),null)
 const input=story.querySelector('.workflow-review input');input.value='只改文本分镜';input.dispatchEvent(new window.Event('input'));input.onblur()
 story.querySelector('.workflow-review button').click();await Promise.resolve()
 assert.equal(calls[0][1],'shot-storyboard');assert.equal(calls[0][2].review,'只改文本分镜')
 p.shots.items[0].video.content={url:'/video.mp4',status:'ready'}
 container.replaceChildren(renderStage('film',p,{perform:async()=>{},fail:()=>{}},{}))
 assert.ok(container.querySelector('.film-video-section [data-review-target="film:S01"]'))
 p.shots.items[0].storyboard.content=null;p.shots.items[0].video.content=null
 container.replaceChildren(renderStage('film',p,{perform:async()=>{},fail:()=>{}},{}))
 assert.equal(container.querySelector('.shot-card').querySelector('.workflow-review'),null)
})

test('summary editing and review target the current episode',async t=>{
 const container=domSetup(t),p=episodeFixture(),calls=[],edits=[]
 p.episodeId=p.id
 container.append(renderStage('summary',p,{perform:async(...args)=>calls.push(args),openEpisode:(...args)=>edits.push(args),fail:()=>{}},{}))
 assert.equal(container.querySelector('.episode-summary > .summary').textContent,p.summary.content)
 const edit=[...container.querySelectorAll('button')].find(b=>b.textContent==='编辑摘要')
 edit.click();assert.equal(edits[0][1].id,p.episodeId);assert.equal(edits[0][1].summary.content,p.summary.content)
 const area=container.querySelector('[data-review-target="summary"]'),input=area.querySelector('input')
 input.value='增加结尾悬念';input.dispatchEvent(new window.Event('input'));input.onblur()
 area.querySelector('button').click();await Promise.resolve()
 assert.equal(calls[0][1],'episode-generate');assert.equal(calls[0][2].episodeId,p.episodeId)
 assert.equal(calls[0][2].generationMode,'modify');assert.equal(calls[0][2].review,'增加结尾悬念')
 container.replaceChildren(renderStage('summary',p,{perform:async(...args)=>calls.push(args),fail:()=>{}},{}))
 container.querySelector('.workflow-regenerate').click();await Promise.resolve()
 assert.equal(calls[1][2].generationMode,'regenerate');assert.equal(calls[1][2].review,undefined)
})

test('overview deletion buttons confirm, target the selected scope and do not open episodes', async t => {
 const { renderOverview } = await import('../client/project-overview-view.js')
 const container = domSetup(t), episode = episodeFixture()
 const project = { id: 'project', title: '测试', summary: { content: '摘要' }, episodes: [episode] }
 const calls = []; let opened = 0, confirmed = false
 window.confirm = () => confirmed
 container.append(renderOverview(project, { perform: async (...args) => calls.push(args), fail: error => { throw error } }, { onOpenEpisode: () => opened++ }))
 const buttons = container.querySelectorAll('.delete-content')
 buttons[1].click()
 assert.equal(calls.length, 0)
 confirmed = true
 buttons[1].click()
 await Promise.resolve()
 assert.equal(calls[0][1], 'episode-delete')
 assert.equal(calls[0][2].episodeId, episode.id)
 assert.equal(opened, 0)
 buttons[0].click()
 await Promise.resolve()
 assert.equal(calls[1][1], 'project-delete')
})

test('history entry navigates without loading inline history', t => {
 const container = domSetup(t), project = { id: 'p', episodeId: 'e' }, calls = []
 return import('../client/execution-history.js').then(({ historyEntry }) => {
  container.append(historyEntry(project, { openHistory: value => calls.push(value) }))
  assert.equal(container.querySelector('details'), null)
  container.querySelector('button').click()
  assert.deepEqual(calls, [project])
 })
})

test('task history page filters records, loads snapshots, refreshes and returns', async t => {
 const { renderTaskHistory } = await import('../client/execution-history.js')
 const container = domSetup(t), calls = []; let returned = false
 const task = operationRequest('episode-generate', { id: 't1', startedAt: new Date().toISOString(), actor: 'model', status: 'review_failed', nodes: [{ kind: 'generate', target: 'summary', status: 'completed' }, { kind: 'review', target: 'summary', status: 'completed', verdict: 'fail', reasons: ['因果不成立'] }, { kind: 'revise', target: 'summary', status: 'skipped' }], artifacts: [{ target: 'summary', version: 2, artifactId: 'version-2' }] })
 const view = renderTaskHistory({ id: 'p', episodeId: 'e', episodeNumber: 1, title: '测试项目' }, {
  back: () => { returned = true },
  load: async artifactId => { calls.push(artifactId); return artifactId ? { artifact: { content: '历史摘要原文' } } : { tasks: [task, { ...task, id: 't2', status: 'completed', artifacts: [] }] } },
 })
 container.append(view)
 await Promise.resolve()
 assert.match(view.textContent, /任务历史/)
 assert.equal(view.querySelectorAll('.task-history-item').length, 2)
 const filter = view.querySelector('select')
 filter.value = 'review_failed'; filter.onchange()
 assert.equal(view.querySelectorAll('.task-history-item').length, 1)
 assert.match(view.textContent, /因果不成立/)
 // 步骤清单与「当前任务」页共用组件：按目标分组，历史中不高亮当前步骤。
 assert.equal(view.querySelector('.task-nodes-target').textContent.startsWith('摘要'), true)
 assert.deepEqual([...view.querySelectorAll('.task-step')].map(item => item.className), ['task-step is-completed', 'task-step is-completed', 'task-step is-skipped'])
 assert.equal(view.querySelector('.task-step.is-current'), null)
 const snapshot = view.querySelector('.task-history-snapshot')
 snapshot.open = true; await snapshot.ontoggle()
 assert.match(view.textContent, /历史摘要原文/)
 assert.equal(calls.filter(value => value === 'version-2').length, 1)
 filter.value = 'running'; filter.onchange()
 assert.match(view.textContent, /没有符合条件/)
 await view.querySelector('.task-history-header button:last-child').onclick()
 assert.equal(calls.filter(value => !value).length, 2)
 view.querySelector('.task-history-header button').click()
 assert.equal(returned, true)
})

test('task history load failures offer refresh and recover', async t => {
 const { renderTaskHistory } = await import('../client/execution-history.js')
 const container = domSetup(t); let fail = true
 const view = renderTaskHistory({ id: 'p', title: '测试项目' }, { back: () => {}, load: async () => {
  if (fail) throw new Error('断网')
  return { tasks: [] }
 } })
 container.append(view); await Promise.resolve()
 assert.match(view.textContent, /加载失败：断网/)
 fail = false
 await view.querySelector('.task-history-header button:last-child').onclick()
 assert.match(view.textContent, /暂无任务历史/)
 assert.match(view.textContent, /全部剧集/)
})

test('shot table and seconds are separate top-level tabs with scoped history', async t => {
 const { tabs } = await import('../client/flow-view.js')
 assert.deepEqual(tabs.map(tab => tab.label), ['摘要', '剧情', '镜头表', '每秒指令', '成片', '合成'])
 const container = domSetup(t), project = episodeFixture(), calls = []
 const actions = {perform:async()=>{},fail:()=>{},openHistory:(project,scope)=>calls.push(scope)}
 for (const [step,label] of [['shots','镜头表'],['seconds','每秒指令']]) {
  container.replaceChildren(renderStage(step,project,actions,{}))
  assert.equal(container.querySelector('.shot-subtabs'),null)
  const entry=container.querySelector('.task-history-entry')
  assert.equal(entry.textContent,`查看${label}任务历史 →`)
  entry.click()
 }
 assert.deepEqual(calls,['shots','seconds'])
})


test('stage toolbar groups status, history, skills and generation controls', t => {
 const container = domSetup(t), project = episodeFixture()
 const actions = {perform:async()=>{},fail:()=>{},openHistory:()=>{},openSkill:()=>{}}
 for (const step of ['summary','script','shots','seconds','film','assembly']) {
  container.replaceChildren(renderStage(step,project,actions,{}))
  const toolbar=container.querySelector('.stage-history-toolbar')
  assert.equal(toolbar.firstElementChild.className,'stage-status')
  assert.equal(Boolean(toolbar.querySelector('.task-history-entry')), true)
  assert.ok(toolbar.querySelector('.stage-primary-actions button.primary'),step)
  assert.equal(container.querySelectorAll('.custom-skill-field').length,0)
  if (step === 'script') {
   const groups = container.querySelectorAll('.outline-head > .story-node-actions')
   assert.equal(groups.length,3)
   for (const group of groups) {
    assert.ok(group.parentElement.querySelector('h3'))
    assert.ok(group.querySelector('.task-history-entry'))
    assert.ok(group.querySelector('[data-skill]'))
   }
  }
 }
})

test('film history entries stay in each shot header and navigate to the corresponding shot', t => {
 const container=domSetup(t),project=episodeFixture(),calls=[]
 const actions={perform:async()=>{},fail:()=>{},openHistory:(value,scope)=>calls.push([value,scope])}
 container.append(renderStage('film',project,actions,{}))
 assert.ok(container.querySelector('.stage-history-toolbar .task-history-entry'))
 const cards=[...container.querySelectorAll('.shot-card')]
 assert.equal(cards.length,project.shots.items.length)
 for(const [index,card] of cards.entries()){
  const entry=card.querySelector(':scope > .shot-head > .task-history-entry')
  assert.ok(entry)
  assert.equal(card.querySelectorAll('.task-history-entry').length,1)
  assert.equal(entry.textContent,'历史')
  entry.click()
  assert.equal(card.dataset.expanded,index === 0 ? 'true' : 'false')
 }
 assert.deepEqual(calls,project.shots.items.map(shot=>[project,`film:${shot.id}`]))
 container.replaceChildren(renderStage('film',project,actions,{onlyShot:'S02'}))
 assert.equal(container.querySelectorAll('.task-history-entry').length,2)
 container.querySelector('.shot-head .task-history-entry').click()
 assert.equal(calls.at(-1)[1],'film:S02')
})

test('shot film history filters exact shot targets including batch nodes and artifact-only records', async t => {
 const { renderTaskHistory } = await import('../client/execution-history.js')
 const container=domSetup(t),project={id:'p',episodeId:'e'},copies=[],promptCalls=[]
 window.HTMLDialogElement.prototype.show=function(){this.open=true}
 const task=(id,action,nodes=[],artifacts=[])=>({id,action,nodes,artifacts,status:'completed',actor:'model'})
 const s1={id:'one',kind:'video_submit',target:'film:S01',status:'completed',prompts:[{id:'p1'}]}
 const s2={id:'two',kind:'video_generate',target:'film:S02',status:'completed'}
 const a1={target:'film:S01',version:1,artifactId:'a1'}
 const a2={target:'film:S02',version:1,artifactId:'a2'}
 let tasks=[task('single','film',[s1]),task('batch','produce-all',[s1,s2],[a1,a2]),
  task('other','film',[s2]),task('similar','film',[{...s1,target:'film:S010'}]),
  task('outside','seconds',[{...s1,target:'seconds:S01'}]),task('old','films',[],[a1]),
  task('edit','text-shot-edit',[{...s1,target:'storyboard:S01'}]),
  task('bind','storyboard-bind',[{...s1,target:'storyboard:S01'}]),task('tail','tail-frame',[s1])]
 tasks = tasks.filter(task => [...task.nodes, ...task.artifacts].some(item => ['film:S01', 'storyboard:S01'].includes(item.target))).map(task => ({...task,nodes:task.nodes.filter(item => ['film:S01','storyboard:S01'].includes(item.target)),artifacts:task.artifacts.filter(item => ['film:S01','storyboard:S01'].includes(item.target))}))
 const before=structuredClone(tasks)
 const view=renderTaskHistory(project,{historyScope:'film:S01',back:()=>{},
  load:async artifactId=>artifactId ? (copies.push(artifactId),{artifact:{content:'本镜视频快照'}}) : {tasks},
  loadPrompts:async(task,step)=>{promptCalls.push([task.id,step.id]);return {prompts:[]}}})
 container.append(view);await Promise.resolve()
 assert.equal(view.querySelector('h2').textContent,'S01 · 成片任务历史')
 assert.deepEqual([...view.querySelectorAll('[data-task-id]')].map(el=>el.dataset.taskId),['single','batch','old','edit','bind','tail'])
 const batch=view.querySelector('[data-task-id="batch"]')
 assert.equal(batch.querySelectorAll('.task-step').length,1)
 assert.equal(batch.querySelectorAll('.task-history-snapshot').length,1)
 assert.doesNotMatch(batch.textContent,/S02/)
 const snapshot=batch.querySelector('.task-history-snapshot');snapshot.open=true;await snapshot.ontoggle()
 assert.deepEqual(copies,['a1'])
 batch.querySelector('.task-step-prompt').click();await Promise.resolve()
 assert.deepEqual(promptCalls,[['batch','one']])
 tasks[0]={...tasks[0],status:'running',nodes:[{...s1,status:'running',startedAt:new Date().toISOString()}]}
 await view.refresh()
 assert.ok(view.querySelector('[data-task-id="single"] .task-step.is-current'))
 assert.equal(view.querySelectorAll('[data-task-id]').length,6)
 assert.deepEqual(before[1],tasks[1])
})

test('step list groups by target and shows the current step with elapsed time, attempts and remote task', async t => {
 const { renderSteps, tickElapsed } = await import('../client/task-nodes.js')
 const container = domSetup(t), start = new Date(Date.now() - 65000).toISOString()
 const nodes = [
  { kind: 'generate', target: 'storyboard:S01', status: 'completed', startedAt: start, endedAt: start },
  { kind: 'review', target: 'storyboard:S01', status: 'completed', verdict: 'fail', reasons: ['位置：S01；原因：动作冲突；修正要求：保持动作连续'], attempts: [{ label: '程序审核', status: 'completed' }, { label: '大模型审核', status: 'completed' }] },
  { kind: 'revise', target: 'storyboard:S01', status: 'running', startedAt: start, attempts: [{ label: '续传 2/3（S02 起）', status: 'running' }] },
  { kind: 'video_submit', target: 'film:S01', status: 'pending' },
  { kind: 'override', target: 'shots', status: 'completed', verdict: 'pass', actor: 'human' },
 ]
 const view = renderSteps(nodes, { live: true })
 container.append(view)
 assert.deepEqual([...view.querySelectorAll('.task-nodes-target')].map(head => head.firstChild.textContent), ['文本提示词 · S01', '成片 · S01', '镜头表'])
 const current = view.querySelector('.task-step.is-current')
 assert.equal(current.getAttribute('aria-current'), 'step')
 assert.match(current.textContent, /修订/)
 assert.match(current.textContent, /尝试 1 次/)
 assert.match(current.textContent, /续传 2\/3（S02 起）：执行中/)
 assert.match(current.querySelector('.task-step-elapsed').textContent, /已用 1分0[5-9]秒/)
 tickElapsed(view, Date.now() + 60000)
 assert.match(current.querySelector('.task-step-elapsed').textContent, /已用 2分/)
 assert.match(view.textContent, /审核未通过：位置：S01；原因：动作冲突；修正要求：保持动作连续/)
 assert.match(view.textContent, /程序审核：完成/)
 assert.match(view.textContent, /大模型审核：完成/)
 assert.match(view.textContent, /人工放行，视为通过/)
 assert.ok(view.querySelector('.task-step-actor'))
 const video = renderSteps([{ kind: 'video_generate', target: 'film:S02', status: 'running', startedAt: start, remoteId: 'video_42' }], { live: true })
 assert.match(video.textContent, /远端任务：video_42/)
})

test('current task page lists running and queued tasks, stops a task and refreshes on push', async t => {
 const { renderCurrentTasks } = await import('../client/current-task.js')
 const container = domSetup(t), stopped = []
 let tasks = [
  { id: 'a', label: '一键成片', status: 'running', startedAt: new Date().toISOString(), nodes: [{ kind: 'video_submit', target: 'film:S01', status: 'completed' }, { kind: 'video_generate', target: 'film:S01', status: 'running', startedAt: new Date().toISOString(), remoteId: 'video_1' }] },
  { id: 'b', label: '写镜头表', status: 'queued', queuePosition: 1, nodes: [{ kind: 'generate', target: 'shots', status: 'pending' }] },
 ]
 let returned = false
 const view = renderCurrentTasks({ id: 'p', title: '测试剧', episodeId: 'e', episodeNumber: 2 }, { load: async () => ({ operations: tasks.map(task => ({ id:task.id, status:task.status, queuePosition:task.queuePosition, tasks:[task] })) }), stop: async task => { stopped.push(task.id) }, back: () => { returned = true } })
 container.append(view)
 await new Promise(resolve => setTimeout(resolve, 0))
 assert.match(view.textContent, /测试剧 · 第 2 集/)
 assert.equal(view.querySelectorAll('.current-task').length, 2)
 assert.match(view.textContent, /排队第 1 位/)
 assert.match(view.querySelector('.task-step.is-current').textContent, /远端任务：video_1/)
 await view.querySelector('.task-history-stop').onclick()
 assert.deepEqual(stopped, ['a'])
 tasks = []
 await view.refresh()
 assert.match(view.textContent, /当前没有进行中或排队中的任务/)
 view.querySelector('.task-history-header button').click()
 assert.equal(returned, true)
 view.remove()
})

test('failed text review offers a human override; an overridden node shows the original AI reasons', async t => {
 const { appendWorkflowReview } = await import('../client/workflow-review.js')
 const container = domSetup(t), events = []
 container.addEventListener('meiji-review-override', event => events.push(event.detail.key))
 const doc = container.ownerDocument, button = () => doc.createElement('button')
 doc.defaultView.confirm = () => true
 const failed = { id: 'shots', review: { text: '', revision: 0 }, check: { passed: false, failures: ['位置：因果剧情；原因：节奏太快；修正要求：减少事件'] } }
 let area = appendWorkflowReview(container, failed, true, false, button())
 area.querySelector('.workflow-review-override').click()
 assert.deepEqual(events, ['shots'])
 container.replaceChildren()
 area = appendWorkflowReview(container, failed, true, true, button())
 assert.equal(area.querySelector('.workflow-review-override'), null)
 area = appendWorkflowReview(container, { ...failed, id: 'film:S01' }, true, false, button())
 assert.equal(area.querySelector('.workflow-review-override'), null)
 area = appendWorkflowReview(container, { ...failed, check: { passed: true, failures: [], override: { at: 'now', reasons: ['位置：因果剧情；原因：节奏太快；修正要求：减少事件'] } } }, true, false, button())
 assert.match(area.querySelector('.workflow-review-overridden').textContent, /人工放行（原自审意见：位置：因果剧情；原因：节奏太快；修正要求：减少事件）/)
 assert.equal(area.querySelector('.workflow-review-override'), null)
})

test('image generation from an episode page repaints with the full project, not the episode view', async t => {
 const { episodeWork } = await import('../client/project-overview-view.js')
 const { rootProject } = await import('../client/drama-store.js')
 const e = await setupModel(t), root = await e.store.read(e.id), store = createModelStore()
 store.accept(root)
 const view = episodeWork(root, e.episodeId)
 assert.throws(() => store.accept(view), /Model 迁移/)
 assert.equal(rootProject(store, view), root)
 assert.equal(rootProject(store, root), root)
 assert.equal(rootProject(createModelStore(), view), null)
})

test('a ready candidate image can be confirmed even though images have no AI review', async t => {
 const { renderImageReview } = await import('../client/image-review.js')
 const container = domSetup(t), e = await setupModel(t)
 const root = await e.store.save(e.id, project => {
  const episode = project.episodes[0], image = episode.plot.characters.items[0].image
  episode.pendingImages = { d1: { draftId: 'd1', previewUrl: '/plugins/meiji/image-draft/d1', key: 'characters', itemId: 'C01', name: '旅人', target: 'snapshot' } }
  image.status = 'generating'; image.operation = operationRequest('image', { id: 'op', phase: 'awaiting-confirmation' })
  return project
 })
 assert.equal(root.episodes[0].plot.characters.items[0].image.check.passed, null)
 const calls = []
 const actions = { reviewImage: async (...args) => { calls.push(args.slice(2)) }, closeImageReview: async () => {}, regenerateImage: async () => {} }
 container.append(renderImageReview(root, actions, null))
 const [confirm, discard] = container.querySelectorAll('.image-review-actions button')
 assert.equal(confirm.disabled, false); assert.equal(discard.disabled, false)
 await confirm.onclick()
 assert.deepEqual(calls, [['d1', 'confirm-image']])
 // 仍在生成（还没有候选图）时不能确认或放弃。
 const generating = { ...root, episodes: [{ ...root.episodes[0], pendingImages: {} }] }
 container.replaceChildren(renderImageReview(generating, actions, operationRequest('image', { phase: 'generating', held: true, episodeId: e.episodeId, itemId: 'C01', name: '旅人' })))
 const [busyConfirm, busyDiscard] = container.querySelectorAll('.image-review-actions button')
 assert.equal(busyConfirm.disabled, true); assert.equal(busyDiscard.disabled, true)
})

test('detail page confirms an image without opening the review page', async t => {
 const container = domSetup(t), episode = episodeFixture(), calls = []
 episode.pendingImages = { d1: { draftId: 'd1', previewUrl: '/draft.png', itemId: 'C01', name: '旅人' } }
 const root = { id: 'p', title: '剧', revision: 1, episodes: [episode], summary: { content: '' } }
 const { renderSession } = await import('../client/project-session-view.js')
 container.append(renderSession(root, () => {}, {
  reviewImage: async (...args) => { calls.push(args.slice(1)) },
  closeImageReview: async () => {},
  regenerateImage: async () => {},
  beginImage: async () => {},
  perform: async () => {},
  fail() {},
  characterImageUrl: () => '',
 }, {
  character: { episodeId: episode.id, itemId: 'C01' },
  imageGate: operationRequest('image', { phase: 'ready', held: false, episodeId: episode.id, itemId: 'C01', name: '旅人', draftId: 'd1', previewUrl: '/draft.png', slot: '', track: '' }),
  onBackCharacter() {},
 }))
 assert.equal(container.querySelector('.image-review-overlay'), null)
 assert.equal(container.querySelector('.asset-still img').src.endsWith('/draft.png'), true)
 const labels = [...container.querySelectorAll('.detail-image-buttons button')].map(button => button.textContent)
 assert.deepEqual(labels, ['放弃', '确定'])
 assert.ok(container.querySelector('.studio-tools [aria-label="AI生成"]'))
 container.querySelector('.detail-image-buttons .primary').click()
 await Promise.resolve()
 assert.deepEqual(calls, [[episode.id, 'd1', 'confirm-image']])
})

test('scene cards stay read only and editing happens on the detail page', async t => {
 const container = domSetup(t), p = episodeFixture(), opened = []
 p.episodeId = p.id
 container.append(renderStage('script', p, { perform: async () => {}, beginImage: async () => {}, fail() {} }, { onOpenScene: (...args) => opened.push(args) }))
 assert.equal(container.querySelector('.image-text-editor'), null)
 assert.match(container.textContent, /南门北墙/)
 assert.match(container.textContent, /开阔庭院及远处山脉/)
 const open = container.querySelector('[aria-label="场景详情：庭院"]')
 open.click()
 assert.deepEqual(opened, [[p.episodeId, 'E01']])
 const { renderSceneDetail } = await import('../client/generation-stage-views.js')
 container.replaceChildren(renderSceneDetail(p, 'E01', { perform: async () => {}, beginImage: async () => {}, fail() {} }, {}))
 const prompt = container.querySelector('.image-text-prompt')
 assert.equal(prompt.textContent, '开阔庭院及远处山脉，完整门墙与通道')
 assert.ok(container.querySelector('[aria-label="地标"]'))
 assert.equal(container.querySelector('[aria-label="场景详情：庭院"]'), null)
})

test('image detail shows editable text and a prompt without field keys', async t => {
 const container = domSetup(t), p = episodeFixture(), calls = []
 p.episodeId = p.id
 const { renderCharacterDetail } = await import('../client/character-views.js')
 container.append(renderCharacterDetail(p, 'C01', { perform: async (...args) => calls.push(args), beginImage: async () => {}, fail() {} }, {}))
 const prompt = container.querySelector('.image-text-prompt')
 assert.equal(prompt.textContent, '中国，旅人，探险者，男性，古代，三十岁，一米八，结实，方脸')
 assert.equal(container.querySelector('.image-text-editor [aria-label="服装"]'), null)
 assert.equal(container.querySelector('.studio-parts'), null)
 assert.equal(/姓名|性别/.test(prompt.textContent), false)
 const name = container.querySelector('[aria-label="姓名"]')
 name.value = '武松'
 name.dispatchEvent(new window.Event('input'))
 assert.match(container.querySelector('.image-text-prompt').textContent, /^中国，武松，探险者，男性/)
 container.querySelector('.image-text-editor').requestSubmit()
 await Promise.resolve()
 assert.equal(calls[0][1], 'character-text')
 assert.equal(calls[0][2].fields.name, '武松')
 assert.equal(calls[0][2].fields.gender, '男性')
 assert.equal(calls[0][2].original.name, '旅人')
})

test('character detail lays out the portrait, reference and text without ancillary images', async t => {
 const container = domSetup(t), p = episodeFixture(), calls = []
 p.episodeId = p.id
 const { renderCharacterDetail } = await import('../client/character-views.js')
 container.append(renderCharacterDetail(p, 'C01', { perform: async () => {}, beginImage: async (...args) => calls.push(args), fail() {} }, {}))
 const aspect = container.querySelector('[aria-label="画幅"]')
 assert.equal(aspect.value, '9:16')
 assert.equal(container.querySelector('[aria-label="AI生成"]').disabled, false)
 assert.equal(container.querySelector('[aria-label="参考图生图"]'), null)
 assert.equal(container.querySelector('[aria-label="文字生图"]'), null)
 const pair = container.querySelector('.studio-pair')
 const text = container.querySelector('.image-text-editor')
 const parts = container.querySelector('.studio-parts')
 assert.equal(pair.compareDocumentPosition(text) & 4, 4)
 assert.equal(parts, null)
 container.querySelector('[aria-label="AI生成"]').click()
 await Promise.resolve()
 assert.equal(calls[0][1], 'image')
 assert.equal(calls[0][2].aspect, '9:16')
 assert.equal(calls[0][2].useReference, false)
 p.plot.characters.items[0].reference = { localPath: '/ref.png', mime: 'image/png' }
 container.replaceChildren(renderCharacterDetail(p, 'C01', { perform: async () => {}, beginImage: async (...args) => calls.push(args), fail() {} }, {}))
 const reference = container.querySelector('[aria-label="AI生成"]')
 assert.equal(reference.disabled, false)
 container.querySelector('[aria-label="画幅"]').value = '3:4'
 reference.click()
 await Promise.resolve()
 assert.equal(calls.at(-1)[2].aspect, '3:4')
 assert.equal(calls.at(-1)[2].useReference, true)
 p.plot.characters.items[0].image = { content: { localPath: '/portrait.png' } }
 container.replaceChildren(renderCharacterDetail(p, 'C01', { perform: async () => {}, beginImage: async () => {}, fail() {} }, {}))
 const dialog = container.querySelector('dialog.still-preview')
 dialog.show = () => { dialog.open = true }
 container.querySelector('[aria-label="查看大图：人物图片"]').click()
 const preview = container.querySelector('dialog.still-preview img')
 assert.equal(preview.src.endsWith('/portrait.png'), true)
 assert.equal(preview.alt, '旅人 · 人物图片')
})

test('successful modification clears submitted opinion even while focused or dirty, and not on acceptance', async t => {
 const { appendWorkflowReview } = await import('../client/workflow-review.js')
 const { node, begin, finish } = await import('../shared/drama-model.js')
 const container=domSetup(t), record=node('summary','摘要')
 const build=()=>{const root=document.createElement('div'),view=document.createElement('div');view.dataset.modelKey='opinion';const button=document.createElement('button');button.onclick=async()=>{};view.append(button);appendWorkflowReview(view,record,true,false,button);root.append(view);return root}
 container.append(build())
 const input=container.querySelector('input')
 input.value='增加悬念';input.dispatchEvent(new window.Event('input'))
 container.querySelector('.workflow-review-action').click();await Promise.resolve()
 assert.equal(input.value,'增加悬念')
 input.focus()
 begin(record,{id:'one',consumesReview:true});finish(record,{passed:true,failures:[]})
 renderModelView(container,build())
 assert.equal(container.querySelector('input'),input)
 assert.equal(input.value,'')
 assert.equal(input.dataset.dirty,undefined)
 assert.equal(container.querySelector('.workflow-review-action').disabled,true)
})

test('successful modification preserves a new opinion typed while task runs', async t => {
 const { appendWorkflowReview } = await import('../client/workflow-review.js')
 const { node, begin, finish } = await import('../shared/drama-model.js')
 const container=domSetup(t), record=node('summary','摘要')
 const build=()=>{const root=document.createElement('div'),view=document.createElement('div');view.dataset.modelKey='opinion';const button=document.createElement('button');button.onclick=async()=>{};view.append(button);appendWorkflowReview(view,record,true,false,button);root.append(view);return root}
 container.append(build())
 const input=container.querySelector('input')
 input.value='本次意见';input.dispatchEvent(new window.Event('input'));container.querySelector('.workflow-review-action').click()
 begin(record,{id:'one',consumesReview:true})
 input.value='下一次意见';input.dispatchEvent(new window.Event('input'));input.focus()
 finish(record,{passed:true,failures:[]});renderModelView(container,build())
 assert.equal(container.querySelector('input').value,'下一次意见')
 input.onblur()
})

test('failed modification preserves persisted opinion, and a new image candidate clears gate opinion', async t => {
 const { node, begin, finish, saveReview } = await import('../shared/drama-model.js')
 const { syncImageGate } = await import('../client/image-review.js')
 const record=node('summary','摘要');saveReview(record,'保留意见',0)
 begin(record,{id:'one',consumesReview:true});finish(record,{passed:false,failures:['失败']})
 assert.equal(record.review.text,'保留意见')
 const next=syncImageGate({episodes:[{id:'episode',pendingImages:{new:{draftId:'new',itemId:'C01',previewUrl:'/new.png'}}}]},
  {phase:'generating',episodeId:'episode',itemId:'C01',ignoreDraftId:'old',review:'旧修改意见'})
 assert.equal(next.review,'');assert.equal(next.phase,'ready')
})

test('image gate reads the image node error and ignores the episode story error', async t => {
 const { syncImageGate } = await import('../client/image-review.js')
 const episode=episodeFixture();episode.activityError='剧情旧错误';episode.plot.characters.items[0].image.error='图片生成失败'
 const failed=syncImageGate({episodes:[episode]},operationRequest('image', { phase:'generating', held:true, episodeId:episode.id, itemId:'C01' }))
 assert.equal(failed.phase,'error');assert.equal(failed.error,'图片生成失败')
 episode.plot.characters.items[0].image.error=null;episode.operationActivity='image:C01'
 const running=syncImageGate({episodes:[episode]},null)
 assert.equal(running.phase,'generating');assert.equal(running.error,'')
})

test('late draft acknowledgement cannot restore consumed opinion or block a newer draft save', async t => {
 const { appendWorkflowReview } = await import('../client/workflow-review.js')
 const { node, begin, finish } = await import('../shared/drama-model.js')
 const container=domSetup(t),record=node('summary','摘要'),saved=[]
 container.addEventListener('meiji-review-draft',event=>saved.push(event.detail))
 const build=()=>{const root=document.createElement('div'),view=document.createElement('div');view.dataset.modelKey='opinion';const button=document.createElement('button');button.onclick=async()=>{};view.append(button);appendWorkflowReview(view,record,true,false,button);root.append(view);return root}
 container.append(build());const input=container.querySelector('input')
 input.value='旧意见';input.dispatchEvent(new window.Event('input'));input.onblur()
 container.querySelector('.workflow-review-action').click();input.focus()
 record.review={text:'旧意见',revision:1};begin(record,{id:'one',consumesReview:true});finish(record,{passed:true,failures:[]})
 renderModelView(container,build());assert.equal(input.value,'')
 input.value='新意见';input.dispatchEvent(new window.Event('input'));input.onblur()
 saved[0].onSaved({text:'旧意见',revision:1})
 assert.equal(input.value,'新意见');assert.equal(saved.length,2)
 assert.equal(saved[1].text,'新意见');assert.equal(saved[1].revision,2)
 saved[1].onSaved({text:'新意见',revision:3})
 assert.equal(input.dataset.dirty,undefined)
})


test('story result cards keep skills and expose independent task history beside skills', t => {
 const container = domSetup(t), project = episodeFixture(), calls = []
 const actions = { perform: async () => {}, fail() {}, openHistory: (project, scope) => calls.push(scope), openSkill() {} }
 container.append(renderStage('script', project, actions, {}))
 const rows = [...container.querySelectorAll('.story-node-actions')]
 assert.equal(rows.length, 3)
 for (const row of rows) {
  assert.ok(row.querySelector('.task-history-entry'))
  assert.ok([...row.querySelectorAll('button')].some(button => button.textContent === '查看 skill'))
 }
 assert.equal(container.querySelectorAll('.task-history-entry').length, 5)
 container.querySelector('.stage-history-toolbar .task-history-entry').click()
 assert.deepEqual(calls, ['script'])
})
