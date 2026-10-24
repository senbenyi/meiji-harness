import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { createProject } from '../src/node_box/project/create_project.js'
import { createProjectView } from '../src/client/project-overview.js'
import { renderNodeRules } from '../src/node_runtime/output_contract_renderer.js'

async function setup(t, options = {}) {
  const dom = new JSDOM('<main/>'), previous = globalThis.document
  globalThis.document = dom.window.document
  const root = document.querySelector('main'), project = await createProject({ name: '制作测试', original_script: '原始剧本' })
  const state = {}, view = createProjectView(root, { project, state, remove: async () => {}, ...options })
  t.after(() => { view.dispose(); globalThis.document = previous; dom.window.close() })
  const next = root.querySelector('.project-next')
  assert.equal(next.previousElementSibling.getAttribute('aria-label'), '删除项目')
  next.click()
  return { root, project, view, state, window: dom.window }
}
const tab = (root, name) => [...root.querySelectorAll('[role=tab]')].find(node => node.textContent === name)

test('下一步进入当前项目七阶段，空模型可切换并返回原详情，保留选中阶段', async t => {
  const { root, state } = await setup(t)
  assert.equal(state.mode, 'production')
  assert.deepEqual([...root.querySelectorAll('[role=tab]')].map(b => b.textContent), ['故事大纲','场景','角色','分镜','提示词','成片','分集'])
  for (const name of ['故事大纲','场景','角色','分镜','提示词','成片','分集']) {
    tab(root, name).click()
    assert.equal(root.querySelector('[role=tab][aria-selected=true]').textContent, name)
    assert.ok(root.querySelector('[role=tabpanel]').textContent.includes(name === '角色' ? '暂无人物资料' : `暂无${name}`))
  }
  root.querySelector('[aria-label="返回项目详情"]').click()
  assert.equal(state.mode, 'overview')
  assert.equal(root.querySelector('[role=tablist]'), null)
  assert.ok(root.querySelector('.original-script').textContent.includes('原始剧本'))
  root.querySelector('.project-next').click()
  assert.equal(root.querySelector('[aria-selected=true]').textContent, '分集')
})

test('节点数据正确分区，模型更新不跳页，输出按纯文本展示且不修改模型', async t => {
  const { root, project, view } = await setup(t)
  const next = structuredClone(project)
  next.story_segments.segments = [{ id:'seg_1', title:'重逢', body:'故事正文' }]
  next.character_extraction.characters = [{ id:'char_1', name:'小雨', social_role:'学生', costumes:[{id:'costume_1',name:'校服',description:'蓝白色'}] }]
  next.scene_extraction.scenes = [{ id:'scene_1',name:'车站',layout:'站台两侧' }]
  next.shot_design.shots = [{ id:'shot_1',title:'镜头一',beats:[{action:'奔跑',audio:'等等！'}] }]
  next.clip_arrangement.clips = [{id:'clip_1',duration_seconds:8,mode:'文生',sources:[{shot_id:'shot_1',start_beat:1,end_beat:1}]}]
  next.video_prompt.items = [{clip_id:'clip_1',text_to_video:{prompt:{integrated_multimodal_description:'<img src=x onerror=alert(1)>奔跑'}}}]
  next.videos = [{clip_id:'clip_1',video_generation:{address:'/video.mp4',actual_duration_seconds:8}}]
  next.episodes = [{id:'ep_1',clip_ids:['clip_1'],actual_duration_seconds:8,address:'/episode.mp4'}]
  const unchanged = structuredClone(next)
  view.update(next)
  const examples = {故事大纲:'故事正文',角色:'小雨',场景:'站台两侧',分镜:'奔跑',提示词:'<img src=x onerror=alert(1)>奔跑',成片:'/video.mp4',分集:'/episode.mp4'}
  for (const [name, text] of Object.entries(examples)) {
    tab(root,name).click()
    assert.ok(root.querySelector('[role=tabpanel]').textContent.includes(text),name)
    if (name === '分镜') assert.ok(root.querySelector('[role=tabpanel]').textContent.includes('分片编排'))
  }
  assert.equal(root.querySelector('img'),null)
  assert.deepEqual(next,unchanged)
  const refreshed=structuredClone(next);refreshed.episodes[0].actual_duration_seconds=9
  view.update(refreshed)
  assert.equal(root.querySelector('[aria-selected=true]').textContent,'分集')
  assert.ok(root.querySelector('[role=tabpanel]').textContent.includes('实际时长（秒）：9'))
  assert.equal(root.querySelector('input,textarea'),null)
})

test('键盘切换同步焦点与内容，重新挂载各项目独立保存自己的视图状态', async t => {
  const {root,project,view,state,window}=await setup(t)
  tab(root,'故事大纲').dispatchEvent(new window.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true,cancelable:true}))
  assert.equal(document.activeElement.textContent,'场景')
  assert.ok(root.querySelector('[role=tabpanel]').textContent.includes('暂无场景'))
  tab(root,'场景').dispatchEvent(new window.KeyboardEvent('keydown',{key:'End',bubbles:true,cancelable:true}))
  assert.equal(document.activeElement.textContent,'分集')
  const panel=root.querySelector('[role=tabpanel]')
  assert.equal(panel.getAttribute('aria-labelledby'),document.activeElement.id)
  assert.equal(document.activeElement.getAttribute('aria-controls'),panel.id)
  view.dispose()
  const secondState={},second=await createProject({name:'第二个项目'})
  const otherView=createProjectView(root,{project:second,state:secondState});root.querySelector('.project-next').click()
  assert.equal(root.querySelector('[aria-selected=true]').textContent,'故事大纲')
  assert.equal(root.querySelector('h2').textContent,'第二个项目');otherView.dispose()
  const restored=createProjectView(root,{project,state});t.after(()=>restored.dispose())
  assert.equal(root.querySelector('[aria-selected=true]').textContent,'分集')
  assert.equal(root.querySelector('h2').textContent,'制作测试')
})

test('AI节点历史和规则接入公共UI，过滤项目/节点并返回原tab及意见草稿', async t => {
  const paths=[]
  const {root,state,project,window}=await setup(t,{request:async path=>{paths.push(path);if(path.startsWith('node-rules?'))return {bases:Object.fromEntries(['generate','review','revise'].map(action=>[action,renderNodeRules(project.character_extraction.node_state,action).base]))};return {tasks:[],total:0}},save:async()=>{}})
  tab(root,'角色').click()
  const input=root.querySelector('[data-node-type=character_extraction] input');input.value='保持角色外貌';input.dispatchEvent(new window.Event('input'))
  const actions=root.querySelector('[data-node-type=character_extraction] .node-ui-buttons')
  assert.deepEqual([...actions.querySelectorAll('button')].map(b=>b.textContent),['任务历史','查看规则','提取人物'])
  assert.ok([...actions.querySelectorAll('.node-ui-execution button')].every(button=>button.disabled))
  assert.match(actions.querySelector('.node-ui-execution button').title,/请先生成故事大纲/)
  actions.querySelector('.node-ui-records button').click()
  await new Promise(resolve=>setImmediate(resolve))
  const url=new URL(paths.at(-1),'http://test/')
  assert.equal(url.searchParams.get('node_type'),'character_extraction');assert.equal(url.searchParams.get('project_id'),project.basic_info.id)
  let panel=root.firstElementChild.shadowRoot
  assert.equal(panel.querySelector('h2').textContent,'角色 · 任务记录')
  assert.ok(panel.textContent.includes('暂无任务记录'));panel.querySelector('header button').click()
  assert.equal(state.mode,'production');assert.equal(state.productionTab,'character_extraction');assert.equal(root.querySelector('[data-node-type=character_extraction] input').value,'保持角色外貌')
  root.querySelectorAll('[data-node-type=character_extraction] .node-ui-records button')[1].click()
  await new Promise(resolve=>setImmediate(resolve))
  panel=root.firstElementChild.shadowRoot
  assert.equal(panel.querySelector('h2').textContent,'角色规则')
  assert.equal(panel.querySelector('[data-action=generate] .skill-text').textContent,renderNodeRules(project.character_extraction.node_state,'generate').base)
  assert.ok([...panel.querySelectorAll('textarea')].some(input=>!input.readOnly))
  panel.querySelector('header button').click()
  assert.equal(state.mode,'production');assert.equal(root.querySelector('[data-node-type=character_extraction] input').value,'保持角色外貌')
  assert.equal(root.textContent.includes('按意见改编'),false)
})

test('AI节点意见按目标保存，失败保留输入和可见错误，草稿切换互不串写', async t => {
  const calls=[];let fail=true
  const {root,window}=await setup(t,{save:async command=>{calls.push(command);if(fail)throw Error('保存失败测试')}})
  const input=root.querySelector('input');input.value='故事段意见';input.dispatchEvent(new window.Event('input'));input.dispatchEvent(new window.Event('blur'))
  await new Promise(resolve=>setImmediate(resolve))
  assert.deepEqual(calls[0],{kind:'node_opinion',node_type:'story_segments',value:'故事段意见',previousValue:''})
  assert.equal(input.value,'故事段意见');assert.match(root.querySelector('.node-ui-failure').textContent,/保存失败测试/)
  fail=false;input.dispatchEvent(new window.Event('blur'));await new Promise(resolve=>setImmediate(resolve))
  assert.equal(root.querySelector('.node-ui-failure').textContent,'')
  tab(root,'场景').click();assert.equal(root.querySelector('input').value,'')
  const scene=root.querySelector('input');scene.value='场景意见';scene.dispatchEvent(new window.Event('input'))
  tab(root,'故事大纲').click();assert.equal(root.querySelector('input').value,'故事段意见')
  tab(root,'场景').click();assert.equal(root.querySelector('input').value,'场景意见')
})

test('程序节点只提供真实任务类型的历史入口，没有AI意见及规则', async t => {
  const paths=[]
  const {root}=await setup(t,{request:async path=>{paths.push(path);return {tasks:[],total:0}}})
  for(const [name,type] of [['分镜','clip_composition'],['成片','clip_video'],['分集','merge_video']]){
    tab(root,name).click()
    const section=root.querySelector(`[data-node-type="${type}"]`)
    assert.equal(section.querySelector('input'),null)
    assert.equal(section.querySelectorAll('.node-ui-records button').length,1)
    assert.equal(section.querySelector('.node-ui-execution button').disabled,true)
    section.querySelector('.node-ui-records button').click()
    await new Promise(resolve=>setImmediate(resolve))
    assert.equal(new URL(paths.at(-1),'http://test/').searchParams.get('node_type'),type)
    root.firstElementChild.shadowRoot.querySelector('header button').click()
    assert.equal(root.querySelector('[aria-selected=true]').textContent,name)
  }
})

test('大纲规则查看显示字段，读取失败可重试，补充规则仍保存原文和旧值', async t => {
  let fail = true, calls = [], saves = []
  const { root, project } = await setup(t, { request: async path => {
    calls.push(path); if (fail) throw new Error('读取失败测试')
    return { bases: Object.fromEntries(['generate','revise','review'].map(action => [action, renderNodeRules(project.story_segments.node_state, action).base])) }
  }, save: async command => { saves.push(command) } })
  root.querySelectorAll('.node-ui-records button')[1].click()
  await new Promise(resolve => setImmediate(resolve))
  const panel = root.firstElementChild.shadowRoot
  assert.match(panel.textContent, /读取失败测试/)
  fail = false; [...panel.querySelectorAll('button')].find(node => node.textContent === '重新加载').click()
  await new Promise(resolve => setImmediate(resolve))
  const text = panel.querySelector('[data-action=generate] .skill-text').textContent
  assert.match(text, /"segments"/); assert.match(text, /"key_anchors"/); assert.doesNotMatch(text, /\{\{output:/)
  assert.ok(calls.every(path => path === 'node-rules?node_type=story_segments'))
  const input = panel.querySelector('[data-action=generate] textarea')
  input.value = '额外要求 {{output:#/story_segments/output}}'
  input.oninput(); input.onblur(); await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(saves[0], { kind: 'rules', node_type: 'story_segments', action: 'generate', field: 'supplement', value: input.value, previousValue: '' })
  panel.querySelector('#tab-review').click()
  assert.match(panel.querySelector('[data-action=review] .skill-text').textContent, /"issues"/)
  assert.match(project.story_segments.node_state.rules.generate.base, /\{\{output:/)
  panel.querySelector('header button').click(); assert.equal(root.querySelector('[aria-selected=true]').textContent, '故事大纲')
})

test('团队卡单独打开团队规则和历史，返回保持团队意见草稿', async t => {
  const paths=[]
  const {root,state,project,window}=await setup(t,{request:async path=>{paths.push(path);if(path.startsWith('node-rules?'))return {bases:Object.fromEntries(['generate','review','revise'].map(action=>[action,renderNodeRules(project.group_setting.node_state,action).base]))};return{tasks:[],total:0}},save:async()=>{}})
  tab(root,'角色').click()
  const input=root.querySelector('[data-node-type=group_setting] input');input.value='保持团队气质';input.dispatchEvent(new window.Event('input'))
  root.querySelector('[data-node-type=group_setting] .node-ui-records button').click()
  await new Promise(resolve=>setImmediate(resolve))
  assert.equal(new URL(paths.at(-1),'http://test/').searchParams.get('node_type'),'group_setting')
  let overlay=root.firstElementChild.shadowRoot
  assert.equal(overlay.querySelector('h2').textContent,'团队 · 任务记录');overlay.querySelector('header button').click()
  root.querySelectorAll('[data-node-type=group_setting] .node-ui-records button')[1].click()
  await new Promise(resolve=>setImmediate(resolve))
  overlay=root.firstElementChild.shadowRoot
  assert.equal(overlay.querySelector('h2').textContent,'团队规则')
  assert.equal(overlay.querySelector('[data-action=generate] .skill-text').textContent,renderNodeRules(project.group_setting.node_state,'generate').base)
  overlay.querySelector('header button').click()
  assert.equal(state.productionTab,'character_extraction')
  assert.equal(root.querySelector('[data-node-type=group_setting] input').value,'保持团队气质')
  assert.equal(root.querySelector('[data-node-type=character_extraction] input').value,'')
})

test('场景标签通过项目视图发起独立任务，运行状态和生成结果更新不跳页',async t=>{
  const calls=[]
  const {root,project,view,window}=await setup(t,{extractScenes:async(instruction,id)=>{calls.push({instruction,id});return{group_id:'scene-ui',status:'queued'}}})
  const ready=structuredClone(project);ready.story_segments.segments=[{id:'segment_1',body:'车站内多次会面'}];view.update(ready);tab(root,'场景').click()
  const input=root.querySelector('input');input.value='保持站台与大厅连通';input.dispatchEvent(new window.Event('input'))
  const run=root.querySelector('.node-ui-execution button');run.click();run.click();await new Promise(resolve=>setImmediate(resolve))
  assert.equal(calls.length,1);assert.equal(calls[0].instruction,'保持站台与大厅连通');assert.match(root.querySelector('[aria-live]').textContent,/排队中/)
  const completed=structuredClone(ready);completed.scene_extraction.scenes=[{id:'station',name:'车站',layout:'大厅北侧通往站台'}];completed.scene_extraction.node_state.status='generated'
  view.update(completed,{sceneExecution:null})
  assert.equal(root.querySelector('[aria-selected=true]').textContent,'场景');assert.ok(root.querySelector('.production-text').textContent.includes('大厅北侧通往站台'))
  assert.equal(root.querySelector('.node-ui-execution button').disabled,false);assert.equal(root.querySelector('.node-data-tag').textContent,'已生成')
})

test('已有场景显示重新生成和修改，重新生成传递独立模式并阻止执行中再次提交',async t=>{
  const calls=[];let complete
  const {root,project,view,window}=await setup(t,{extractScenes:(...args)=>{calls.push(args);return new Promise(resolve=>{complete=resolve})}})
  const ready=structuredClone(project)
  ready.story_segments.segments=[{id:'segment_1',body:'车站内会面'}]
  ready.scene_extraction.scenes=[{id:'station',name:'车站',layout:'大厅北侧通往站台'}]
  ready.scene_extraction.node_state.status='expired'
  view.update(ready);tab(root,'场景').click()
  const input=root.querySelector('input');input.value='保留大厅';input.dispatchEvent(new window.Event('input'))
  const buttons=[...root.querySelectorAll('.node-ui-execution button')]
  assert.deepEqual(buttons.map(b=>b.textContent),['重新生成','按意见修改'])
  buttons[0].click();buttons[1].click();buttons[0].click()
  await new Promise(resolve=>setImmediate(resolve))
  assert.equal(calls.length,1);assert.deepEqual(calls[0][2],{regenerate:true});assert.match(calls[0][0],/保留大厅/)
  assert.equal([...root.querySelectorAll('.node-ui-execution button')].every(b=>b.disabled),true)
  complete({group_id:'regenerate-ui',status:'queued'});await new Promise(resolve=>setImmediate(resolve))
  assert.match(root.querySelector('[aria-live]').textContent,/排队中/)
  assert.ok(root.querySelector('.production-text').textContent.includes('大厅北侧通往站台'))
})
