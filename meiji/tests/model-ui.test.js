import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from '../../harness/node_modules/jsdom/lib/api.js'
import { episodeFixture, setupModel } from './fixtures/model.js'
import { renderStage } from '../client/stages.js'
import { renderModelView, createModelStore } from '../client/model-store.js'
import { setContent } from '../client/drama-model.js'
function domSetup(t) {
 const dom=new JSDOM('<body><main></main></body>',{url:'http://localhost'})
 const prior={document:globalThis.document,window:globalThis.window,CustomEvent:globalThis.CustomEvent}
 Object.assign(globalThis,{document:dom.window.document,window:dom.window,CustomEvent:dom.window.CustomEvent})
 t.after(()=>{Object.assign(globalThis,prior);dom.window.close()})
 return dom.window.document.querySelector('main')
}
test('all production panes render directly from new models, including pencil and references',t=>{
 const container=domSetup(t),e=episodeFixture();e.episodeId=e.id
 e.plot.characters.items[0].image.content={imageUrl:'https://image.test/a',localPath:'/portrait'}
 e.shots.items[0].storyboard.content.referenceSnapshot=[{id:'C01',url:'https://image.test/a',localPath:'/portrait',kind:'characters',label:'旅人'}]
 e.shots.items[0].storyboard.content.prompt.text='<Subject 1> comes from <Picture 1>'
 const actions={perform:async()=>{},fail:()=>{}}
 for(const step of ['script','shots','film','assembly'])container.replaceChildren(renderStage(step,e,actions,{}))
 for(const shotsPane of ['table','seconds','board','pencil']){
  container.replaceChildren(renderStage(shotsPane === 'board' ? 'film' : 'shots',e,actions,{shotsPane}))
  if(shotsPane==='board'){assert.ok(container.querySelector('.reference-card img'));assert.match(container.textContent,/<Subject 1>/);assert.ok(container.querySelector('.storyboard-editor'))}
 }
})
test('partial refresh retains focused draft and does not detach nested reused components',t=>{
 const container=domSetup(t)
 const build=label=>{const root=document.createElement('div');root.innerHTML=`<article data-model-key="one"><input value="draft"><span data-model-key="inside">inside</span></article><article data-model-key="two">${label}</article>`;return root}
 renderModelView(container,build('old'));const input=container.querySelector('input');input.value='未提交文字';input.focus();input.setSelectionRange(2,3)
 renderModelView(container,build('new'));assert.equal(container.querySelector('input'),input);assert.equal(input.value,'未提交文字');assert.equal(document.activeElement,input);assert.equal(input.selectionStart,2);assert.equal(container.querySelector('[data-model-key=inside]').textContent,'inside');assert.equal(container.querySelector('[data-model-key=two]').textContent,'new')
})
test('model store notifies on newer revisions and rejects late responses',async t=>{const e=await setupModel(t),p=await e.store.read(e.id),store=createModelStore();let calls=0;store.subscribe(()=>calls++);store.accept(p);store.accept({...p,revision:p.revision+2,title:'新'});assert.equal(store.accept({...p,title:'旧'}).title,'新');assert.equal(calls,2)})
test('text draft survives reload and does not alter published storyboard',async t=>{const e=await setupModel(t);const before=(await e.read()).shots.items[0].storyboard.content.prompt.text;await e.store.saveReviewDraft(e.id,e.episodeId,'storyboard:S01','未提交正文',0,'text');const model=(await e.read()).shots.items[0].storyboard;assert.equal(model.content.prompt.text,before);assert.equal(model.draft.text,'未提交正文');assert.equal(model.status,'passed')})
test('replacing a picture refreshes snapshot URL without regenerating storyboard prose',async t=>{const e=await setupModel(t);await e.store.save(e.id,p=>{const ep=p.episodes[0];ep.plot.characters.items[0].image.content={imageUrl:'https://image.test/new'};ep.shots.items[0].storyboard.content.referenceSnapshot=[{id:'C01',url:'https://image.test/old',kind:'characters'}];return p});const ep=await e.read();assert.equal(ep.shots.items[0].storyboard.content.referenceSnapshot[0].url,'https://image.test/new');assert.match(ep.shots.items[0].storyboard.content.prompt.text,/旅人/);assert.equal(ep.shots.items[0].storyboard.status,'passed')})
test('project refresh marker reads nested pencil and video nodes', async t => {
 const { projectRefreshMark } = await import('../client/chat-bridge.js')
 const e = await setupModel(t), p = await e.store.read(e.id)
 const before = projectRefreshMark(p)
 p.episodes[0].shots.items[0].pencil.content = { url: '/new-pencil' }
 assert.notEqual(projectRefreshMark(p), before)
})
test('shot subtab cards show review failure and retain manual expansion across refresh', t => {
 const container = domSetup(t), e = episodeFixture(); e.episodeId = e.id
 e.shots.items[1] = structuredClone(e.shots.items[0]); e.shots.items[1].id = 'S02'
 e.shots.items[1].storyboard.check = { passed: false, failures: ['角色冲突'] }
 const actions = { perform: async () => {}, fail: () => {} }
 for (const shotsPane of ['table', 'seconds']) {
  const build = () => renderStage('shots', e, actions, { shotsPane })
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

test('failed review shows reasons instead of input and submits the unified modification',async t=>{
 const container=domSetup(t),p=episodeFixture();p.episodeId=p.id
 p.shots.items[0].seconds.check={passed:false,failures:['朝向不连续']}
 const calls=[]
 container.replaceChildren(renderStage('shots',p,{perform:async(...args)=>calls.push(args),fail:()=>{}},{shotsPane:'seconds'}))
 const card=container.querySelector('.shot-card'),area=container.querySelector('.workflow-review-panel')
 assert.ok(area.classList.contains('workflow-review-failed'))
 assert.match(area.textContent,/朝向不连续/)
 assert.equal(area.querySelector('input'),null)
 const button=area.querySelector('button');assert.equal(button.textContent,'提交修改')
 assert.equal(card.contains(button),false)
 assert.ok(area.compareDocumentPosition(card) & 4)
 assert.equal(container.querySelectorAll('.workflow-review-input').length,0)
 button.click();await Promise.resolve()
 assert.equal(calls[0][1],'seconds');assert.equal(calls[0][2].generationMode,'modify');assert.equal(calls[0][2].review,undefined)
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
 s.storyboard.content.tailReference={sourceShotId:'S01',imageUrl:'https://test/previous'}
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
 const { generateShots, reviseShot } = await import('../server/generate/shot-text.js')
 const container = domSetup(t), project = episodeFixture()
 const request = text => async skill => skill === 'skill-gongyong-content-review' ? 'PASS' : text
 project.shots = await generateShots({ project, request: request('## S01 / 5s\n标题：夜访庭院\n旅人走到门外。\n\n## S02 / 5s\n标题：叩门待应\n旅人敲门。') })
 assert.match(project.shots.items[0].content, /^标题：夜访庭院/)
 const actions = { perform: async () => {}, fail: () => {} }
 const checkCards = title => {
  for (const shotsPane of ['table', 'seconds', 'board', 'pencil']) {
   container.replaceChildren(renderStage('shots', project, actions, { shotsPane }))
   assert.ok([...container.querySelectorAll('h3')].some(el => el.textContent.includes(`S01 / 5s · ${title}`)), shotsPane)
  }
 }
 checkCards('夜访庭院')
 project.shots = await reviseShot({ project, shotId: 'S01', review: '改为风雪中抵达', request: request('- **标题：风雪抵达**\n旅人冒雪抵达门外。') })
 checkCards('风雪抵达')
})

test('log copy copies full content when expanded or collapsed, without duplicate buttons or toggling', async t => {
 const { appendLogCopy } = await import('../client/dom.js')
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
 container.append(renderStage('shots', project, {perform:async()=>{},fail:()=>{}}, {shotsPane:'seconds'}))
 const card=container.querySelector('[data-model-key="seconds:S01"]') || container.querySelector('.shot-card')
 assert.equal(card.querySelector('.shot-check-badge').textContent,'暂停')
 assert.ok([...container.querySelectorAll('.workflow-generation-row button')].some(button=>button.textContent==='重新生成' && !button.disabled))
 assert.equal(container.querySelector('.workflow-review input').value,'保留动作')
 assert.equal(card.querySelector('input'),null)
})

test('regenerate button never submits the visible previous opinion', async t => {
 const container=domSetup(t),p=episodeFixture();p.episodeId=p.id
 p.shots.seconds.review.text='旧人工意见'
 const calls=[]
 container.replaceChildren(renderStage('shots',p,{perform:async(...args)=>calls.push(args),fail:()=>{}},{shotsPane:'seconds'}))
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
  container.replaceChildren(renderStage('shots',p,{perform:async(...args)=>calls.push(args),fail:()=>{}},{shotsPane}))
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
  container.replaceChildren(renderStage('shots',p,{perform:async()=>{},fail:()=>{}},{shotsPane}))
  const area=container.querySelector('.workflow-review'),cards=container.querySelectorAll('.shot-card')
  assert.ok(area.compareDocumentPosition(cards[0]) & 4)
  assert.equal(container.querySelectorAll('.workflow-review').length,1)
  if(shotsPane==='seconds'){
   assert.match(area.textContent,/S01：第一镜失败/);assert.match(area.textContent,/S02：第二镜失败/)
   for(const card of cards){assert.equal(card.querySelector('input'),null);assert.doesNotMatch(card.textContent,/提交修改|重新生成|第一镜失败|第二镜失败/)}
  }
 }
})
test('single shot seconds detail is read only',async t=>{
 const container=domSetup(t),p=episodeFixture(),{renderShotPage}=await import('../client/stages.js')
 container.append(renderShotPage(p,p.shots.items[0],{perform:()=>assert.fail('read only')},{shotTab:'seconds'}))
 assert.match(container.textContent,/卡片集顶部统一/)
 assert.equal(container.querySelector('.workflow-review'),null)
})
test('shared review is absent without generated content and shows only current failures',async t=>{
 const container=domSetup(t),{appendWorkflowReview}=await import('../client/workflow-review.js')
 const record={id:'film:S01',review:{text:'',revision:0},check:{passed:false,failures:['失败原因']}}
 let area=appendWorkflowReview(container,record,false,false,document.createElement('button'))
 assert.equal(container.querySelector('.workflow-review'),null)
 area=appendWorkflowReview(container,record,true,false,document.createElement('button'))
 assert.match(area.textContent,/失败原因/)
 container.replaceChildren()
 area=appendWorkflowReview(container,{...record,check:{passed:true,failures:['旧原因']}},true)
 assert.equal(area.querySelector('.workflow-review-failures'),null)
 assert.ok(area.querySelector('input'))
 assert.equal(area.querySelector('.workflow-review-heading'),null)
})
test('character and scene group reviews precede their lists',t=>{
 const container=domSetup(t),p=episodeFixture()
 container.append(renderStage('script',p,{perform:async()=>{},beginImage:async()=>{},fail:()=>{}},{}))
 for(const key of ['characters','scenes']){
  const review=container.querySelector(`[data-review-target="${key}"]`)
  const card=review.parentElement.querySelector(key==='characters'?'.character-list':'.story-asset')
  assert.ok(review);assert.ok(card);assert.ok(review.compareDocumentPosition(card)&4)
 }
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
