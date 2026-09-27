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

test('review action sits next to feedback and submits the local opinion',async t=>{
 const container=domSetup(t),p=episodeFixture();p.episodeId=p.id
 p.shots.items[0].seconds.check={passed:false,failures:['朝向不连续']}
 const calls=[]
 container.replaceChildren(renderStage('shots',p,{perform:async(...args)=>calls.push(args),fail:()=>{}},{shotsPane:'seconds'}))
 const card=container.querySelector('.shot-card'),area=card.querySelector('.workflow-review-panel')
 assert.ok(area.classList.contains('workflow-review-failed'))
 assert.match(area.textContent,/朝向不连续/)
 const input=area.querySelector('input');input.value='保持面北'
 const button=area.querySelector('button');assert.equal(button.textContent,'按意见修订')
 assert.equal(card.querySelector('.shot-head').contains(button),false)
 button.click();await Promise.resolve()
 assert.equal(calls[0][1],'shot-seconds');assert.equal(calls[0][2].review,'保持面北')
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
