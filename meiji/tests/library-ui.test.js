import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from './fixtures/jsdom.js'
import { libraryEditor, renderProjectLibrary, cardLibraryControls } from '../client/project-library-view.js'
import { createLibraryEntry } from '../shared/library-rules.js'
import { goalRequest } from '../client/goal-request.js'
import { planRun } from '../shared/run-planner.js'
const settle = () => new Promise(resolve => setImmediate(resolve))

test('项目库已有图片的重新生成按钮规划实际生图步骤', async t => {
 const { project } = setup(t), calls = []
 const { entry } = createLibraryEntry(project, 'characters', { name: '角色', image: { content: { assetId: 'existing', assetCategory: 'characters' } } })
 const page = renderProjectLibrary(project, 'characters', { perform: async (_project, action, fields) => { calls.push(goalRequest(action, fields).goal); return { cancelled: true } } }, { entryId: entry.id })
 page.querySelector('[aria-label="重新生成角色图片：角色"]').click(); await settle()
 assert.equal(calls[0].mode, 'regenerate')
 assert.notEqual(planRun(project, calls[0]).steps.find(step => step.kind === 'image').status, 'skipped')
})
function setup(t) {
  const dom = new JSDOM('<body></body>'), keys = ['document', 'window', 'fetch'], prior = Object.fromEntries(keys.map(key => [key, globalThis[key]]))
  Object.assign(globalThis, { document: dom.window.document, window: dom.window, fetch: async () => ({ ok: true, json: async () => ({ assets: [] }) }) })
  dom.window.HTMLDialogElement.prototype.show = function() { this.open = true }
  dom.window.HTMLDialogElement.prototype.close = function() { this.dispatchEvent(new dom.window.Event('close')) }
  t.after(() => { Object.assign(globalThis, prior); dom.window.close() })
  const project = { id: 'project', library: { characters: [], scenes: [], props: [] }, episodes: [] }
  return { project, dom }
}
for (const kind of ['characters', 'scenes', 'props']) test(`${kind}新建库条目字段、照片与失败输入保留`, async t => {
  const { project, dom } = setup(t), seen = []
  const dialog = libraryEditor(project, kind, { perform: async (...args) => { seen.push(args); throw new Error('保存失败') }, stage() {} })
  document.body.append(dialog)
  dialog.querySelector('[aria-label=名称]').value = '新条目'
  assert.equal(Boolean(dialog.querySelector('[aria-label=必须出场]')), kind === 'characters')
  assert.ok(dialog.querySelector('[aria-label=指定照片]')); assert.ok(dialog.querySelector('[aria-label=从素材库选照片]'))
  dialog.querySelector('form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })); await settle()
  assert.equal(seen[0][1], 'entry-create'); assert.equal(seen[0][2].libraryKind, kind); assert.equal(dialog.querySelector('[aria-label=名称]').value, '新条目')
  assert.match(dialog.textContent, /保存失败/); assert.equal(dialog.querySelector('[type=submit]').disabled, false)
})
test('库详情默认、照片来源、关联角色删除入口；卡片提供关联与解除入口', async t => {
  const { project } = setup(t), { entry, variant } = createLibraryEntry(project, 'characters', { name: '角色', nationality: '中国', required: true, image: { content: { assetId: 'photo', assetCategory: 'characters', source: 'photo' } } })
  const card = { id: 'C01', type: 'role', name: entry.name, ref: { libraryId: entry.id, variantId: variant.id } }
  project.episodes.push({ id: 'episode', plot: { characters: { items: [card] } } })
  const page = renderProjectLibrary(project, 'characters', { perform() {}, back() {} }); document.body.append(page)
  page.querySelector('.character-item').click()
  assert.match(page.textContent, /必须出场/); assert.match(page.textContent, /指定照片/); assert.match(page.textContent, /关联 1 集/)
  assert.equal([...page.querySelectorAll('button')].find(button => button.textContent === '删除角色').disabled, false)
  const controls = cardLibraryControls(project, card, {})
  assert.match(controls.textContent, /复用库图/); assert.match(controls.textContent, /解除关联/); assert.doesNotMatch(controls.textContent, /新增造型|改变体/)
})

test('项目详情点击角色或场景直达详情，并提供编辑、重新生成和素材库导入', async t => {
  const { project } = setup(t), { entry } = createLibraryEntry(project, 'scenes', { name: '庭院', landmark: '老宅' })
  const page = renderProjectLibrary(project, 'scenes', { perform() {}, back() {} }, { entryId: entry.id }); document.body.append(page)
  assert.match(page.querySelector('h2').textContent, /场景详情/)
  assert.equal(page.querySelectorAll('.character-item').length, 0)
  assert.ok([...page.querySelectorAll('button')].some(button => button.textContent === '编辑资料'))
  assert.ok([...page.querySelectorAll('button')].some(button => button.textContent === '重新生成'))
  const importButton = [...page.querySelectorAll('button')].find(button => button.textContent === '从素材库导入')
  assert.ok(importButton)
  importButton.click()
  assert.ok(page.querySelector('dialog [aria-label="从素材库选照片"]'))
})

test('人物详情内联编辑，按服装ID展示图片；保存刷新资料且不会覆盖未保存输入',async t=>{
 const {project,dom}=setup(t),{entry,variant}=createLibraryEntry(project,'characters',{name:'角色',age:'三十岁',costumes:[{id:'daily',name:'常服',description:'蓝衣',context:''},{id:'formal',name:'礼服',description:'白衣',context:''}]})
 variant.image.content={localPath:'/main.png',costumes:{daily:{localPath:'/daily.png',description:'蓝衣'}}}
 const calls=[]
 const page=renderProjectLibrary(project,'characters',{back(){},load:async()=>({project}),perform:async(_p,action,input)=>{calls.push([action,input]);Object.assign(variant.fields,input.fields);return {completed:true}}},{entryId:entry.id})
 document.body.append(page)
 assert.equal(page.querySelectorAll('.wardrobe-image').length,2)
 assert.equal(page.querySelector('[data-costume-id="daily"] img').getAttribute('src'),'/daily.png')
 assert.match(page.querySelector('[data-costume-id="formal"]').textContent,/暂无图片/)
 const input=page.querySelector('[aria-label="年龄"]');input.value='四十岁';input.dispatchEvent(new dom.window.Event('input'))
 await page.refresh();assert.equal(page.querySelector('[aria-label="年龄"]').value,'四十岁')
 await page.querySelector('form').onsubmit({preventDefault(){}})
 assert.equal(calls[0][0],'entry-edit');assert.equal(calls[0][1].fields.age,'四十岁')
 assert.equal(calls[0][1].fields.costumes,undefined)
 assert.equal(page.querySelector('.character-costumes-editor'),null)
 assert.equal(page.querySelector('[aria-label="年龄"]').value,'四十岁')
 assert.equal(page.querySelector('button[type="submit"]').disabled,false)
})

for (const mode of ['save', 'cancel', 'error']) test(`服装独立编辑页图片与单套保存：${mode}`,async t=>{
 const {project,dom}=setup(t),{entry,variant}=createLibraryEntry(project,'characters',{name:'角色',age:'三十岁',costumes:[{id:'a',name:'常服',description:'蓝衣',context:'白天'},{id:'b',name:'礼服',description:'白衣',context:'夜晚'}]})
 variant.image.content={costumes:{a:{localPath:'/a.png',description:'蓝衣'}}}
 const calls=[]
 const page=renderProjectLibrary(project,'characters',{load:async()=>({project}),perform:async(_p,action,input)=>{
  calls.push(input)
  if(mode==='cancel')return {cancelled:true}
  if(mode==='error')throw new Error('保存失败')
  Object.assign(variant.fields,input.fields);return {completed:true}
 }},{entryId:entry.id});document.body.append(page)
 const age=page.querySelector('[aria-label="年龄"]');age.value='四十岁';age.dispatchEvent(new dom.window.Event('input'))
 assert.equal(page.querySelector('.character-costumes-editor'),null)
 const tile=page.querySelector('[data-costume-id="a"]')
 assert.equal(tile.querySelector('.wardrobe-name').textContent,'常服');assert.ok(tile.querySelector('img'))
 tile.querySelector('[aria-label="编辑服装：常服"]').click()
 const detail=page.querySelector('.costume-detail')
 assert.equal(detail.querySelector('img').getAttribute('src'),'/a.png')
 assert.equal(detail.querySelector('[aria-label="适用场景"]').value,'白天')
 const name=detail.querySelector('[aria-label="服装名称"]');name.value='新常服'
 await page.refresh();assert.equal(detail.querySelector('[aria-label="服装名称"]').value,'新常服')
 await detail.querySelector('form').onsubmit({preventDefault(){}})
 assert.equal(calls[0].fields.costumes[0].id,'a');assert.equal(calls[0].fields.costumes[1].name,'礼服')
 if(mode==='save'){
  assert.equal(page.querySelector('.costume-detail'),null)
  assert.equal(page.querySelector('[data-costume-id="a"] .wardrobe-name').textContent,'新常服')
  assert.equal(page.querySelector('[aria-label="年龄"]'),age);assert.equal(age.value,'四十岁')
 }else{
  assert.equal(page.querySelector('.costume-detail'),detail);assert.equal(name.value,'新常服')
  assert.equal(detail.querySelector('[type="submit"]').disabled,false)
  if(mode==='error')assert.match(detail.textContent,/保存失败/)
 }
})

test('新增和移除服装从独立页保存，返回不提交',async t=>{
 const {project}=setup(t),{entry,variant}=createLibraryEntry(project,'characters',{name:'角色',costumes:[{id:'a',name:'旧服',description:'蓝衣',context:''}]})
 let calls=0
 const page=renderProjectLibrary(project,'characters',{load:async()=>({project}),perform:async(_p,_action,input)=>{calls++;variant.fields.costumes=input.fields.costumes.map(row=>({...row,id:row.id||'new'}));return {completed:true}}},{entryId:entry.id});document.body.append(page)
 const add=()=>[...page.querySelectorAll('button')].find(button=>button.textContent==='＋ 添加服装').click()
 add();let detail=page.querySelector('.costume-detail');detail.querySelector('button').click();assert.equal(calls,0)
 add();detail=page.querySelector('.costume-detail');detail.querySelector('[aria-label="服装名称"]').value='新服';detail.querySelector('[aria-label="服装描述"]').value='红衣'
 await detail.querySelector('form').onsubmit({preventDefault(){}})
 assert.equal(page.querySelectorAll('.wardrobe-image').length,2)
 page.querySelector('[data-costume-id="a"] .costume-picture-preview').click();detail=page.querySelector('.costume-detail')
 ;detail.querySelector('[aria-label="删除服装：旧服"]').click();await settle()
 assert.deepEqual(variant.fields.costumes.map(row=>row.id),['new'])
 assert.equal(page.querySelectorAll('.wardrobe-image').length,1)
})

for(const kind of ['characters','scenes','props']) test(`${kind}详情移除合并控件但保留删除`,t=>{
 const {project}=setup(t),{entry}=createLibraryEntry(project,kind,{name:'条目'})
 createLibraryEntry(project,kind,{name:'另一条目'})
 const page=renderProjectLibrary(project,kind,{perform(){},back(){}},{entryId:entry.id})
 assert.equal(page.querySelector('[aria-label="合并目标"]'),null)
 assert.doesNotMatch(page.textContent,/合并条目|选择合并目标/)
 assert.ok(page.querySelector(`[aria-label="${kind==='characters'?'删除角色':'删除条目'}：条目"]`))
})


test('服装图加号底部选择、导入失败恢复、素材选择与减号不进入资料页',async t=>{
 const {dom}=setup(t),{costumeImageControls}=await import('../client/costume-image-controls.js'),calls=[]
 const costume={id:'a',name:'常服',description:'蓝衣'};let fail=true,opened=0,staged=0
 globalThis.fetch=async()=>({ok:true,json:async()=>({assets:[{id:'pic',category:'characters',mime:'image/png',originalName:'照片'}]})})
 const box=costumeImageControls({image:{content:{}}},costume,null,{onOpen:()=>opened++,onRemove:async()=>{calls.push({deleteCostume:true});return {}},stage:async file=>{assert.equal(file.name,'photo.png');staged++;return 'incoming'},onChange:async fields=>{calls.push(fields);if(fail)throw new Error('图片保存失败');return {src:fields.clear?'':'/saved.png'}}})
 document.body.append(box)
 box.querySelector('[aria-label="添加服装图片：常服"]').click()
 let sheet=box.querySelector('.costume-image-sheet');assert.ok(sheet.open)
 assert.ok([...sheet.querySelectorAll('button')].some(b=>b.textContent==='导入'));assert.equal(opened,0)
 const input=sheet.querySelector('input');Object.defineProperty(input,'files',{value:[new dom.window.File(['png'],'photo.png',{type:'image/png'})]})
 input.dispatchEvent(new dom.window.Event('change'));await settle()
 assert.equal(staged,1);assert.equal(calls[0].incomingId,'incoming');assert.match(sheet.textContent,/图片保存失败/)
 assert.equal(box.querySelector('[aria-label="添加服装图片：常服"]').disabled,false)
 fail=false
 ;[...sheet.querySelectorAll('button')].find(b=>b.textContent==='从素材库选择').click();await settle()
 sheet.querySelector('.costume-asset-option').click();await settle()
 assert.equal(box.querySelector('dialog'),null);assert.equal(box.querySelector('img').getAttribute('src'),'/saved.png')
 assert.deepEqual(calls.at(-1),{assetId:'pic',category:'characters'})
 box.querySelector('[aria-label="删除服装：常服"]').click();await settle()
 assert.deepEqual(calls.at(-1),{deleteCostume:true});assert.equal(box.querySelector('img'),null);assert.equal(opened,0)
})

test('人物与服装保存按钮置底，图片地址包含正确素材ID',async t=>{
 const {project}=setup(t),{entry,variant}=createLibraryEntry(project,'characters',{name:'角色',costumes:[{id:'a',name:'常服',description:'蓝衣',context:''}]})
 variant.image.content={costumes:{a:{assetId:'picture',assetCategory:'characters',description:'蓝衣'}}}
 const page=renderProjectLibrary(project,'characters',{perform(){},back(){}},{entryId:entry.id});document.body.append(page)
 let form=page.querySelector('form');assert.ok(form.lastElementChild.classList.contains('form-save-footer'))
 assert.match(page.querySelector('.wardrobe-image img').getAttribute('src'),/category=characters&id=picture/)
 page.querySelector('[aria-label="编辑服装：常服"]').click()
 form=page.querySelector('.costume-detail form');assert.ok(form.lastElementChild.classList.contains('form-save-footer'))
 assert.equal(form.lastElementChild.querySelector('button').textContent,'保存')
 assert.ok(page.querySelector('.costume-detail [aria-label="添加服装图片：常服"]'))
})

for(const outcome of ['success','cancel','error']) test(`列表减号删除未生图服装：${outcome}`,async t=>{
 const {project,dom}=setup(t),{entry,variant}=createLibraryEntry(project,'characters',{name:'角色',costumes:[{id:'a',name:'常服',description:'蓝衣',context:''},{id:'b',name:'礼服',description:'白衣',context:''}]})
 const page=renderProjectLibrary(project,'characters',{load:async()=>({project}),perform:async(_p,action,input)=>{
  assert.equal(action,'entry-edit');assert.deepEqual(input.fields.costumes.map(row=>row.id),['b'])
  if(outcome==='cancel')return {cancelled:true}
  if(outcome==='error')throw new Error('删除失败')
  variant.fields.costumes=input.fields.costumes;return {}
 }},{entryId:entry.id});document.body.append(page)
 const input=page.querySelector('[aria-label="姓名"]');input.value='新名';input.dispatchEvent(new dom.window.Event('input'))
 const remove=page.querySelector('[aria-label="删除服装：常服"]');assert.equal(remove.disabled,false)
 remove.click();await settle()
 assert.equal(page.querySelectorAll('.wardrobe-image').length,outcome==='success'?1:2)
 assert.equal(page.querySelector('[aria-label="姓名"]').value,'新名')
 if(outcome!=='success')assert.equal(remove.disabled,false)
 if(outcome==='error')assert.match(page.textContent,/删除失败/)
})
