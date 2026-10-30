import test from 'node:test'
import assert from 'node:assert/strict'
import { apply } from '../src/session/index.js'

test('共享注册保留宿主工具和身份，业务工具与指导随插件销毁移除，重新挂载不重复', () => {
  const builtin = { name: 'read' }, project = { name: 'drama-create-project' }, optimize = { name: 'drama-optimize-script' }, story = { name: 'drama-generate-story-outline' }
  const tools = new Map([['read', builtin]])
  const persona = { name: 'deployment:persona-prefix', text: '标准模式身份' }
  const sections = new Map([[persona.name, persona]])
  const disposers = []
  const register = (map, item) => {
    assert.equal(map.has(item.name), false)
    map.set(item.name, item)
    return () => map.delete(item.name)
  }
  const ctx = {
    drama: {documentVersion:2,createProjectTool:project,productionTools:[optimize,story]},
    tools: { register: item => register(tools, item) },
    systemPrompt: { getSectionOrder: () => 10200, section: item => register(sections, item) },
    effect(fn) { disposers.push(fn()) },
  }
  for (let pass = 0; pass < 2; pass++) {
    apply(ctx)
    assert.equal(tools.get('read'), builtin)
    assert.equal(tools.get(project.name), project)
    assert.equal(tools.get(optimize.name), optimize)
    assert.equal(tools.get(story.name), story)
    assert.equal(sections.get(persona.name), persona)
    assert.match(sections.get('drama:production').text,/仅当用户明确要求创建/)
    for (const dispose of disposers.splice(0).reverse()) dispose()
    assert.deepEqual([...tools.values()], [builtin])
    assert.deepEqual([...sections.values()], [persona])
  }
})

test('V2会话只注册当前新流程工具，不注入已退役的优化与大纲指导',()=>{
 const tools=[],sections=[];const ctx={drama:{documentVersion:2,createProjectTool:{name:'drama-create-project'}},tools:{register:tool=>{tools.push(tool.name);return ()=>{}}},systemPrompt:{getSectionOrder:()=>10200,section:section=>{sections.push(section);return ()=>{}}},effect:fn=>fn()}
 apply(ctx);assert.deepEqual(tools,['drama-create-project']);assert.deepEqual(sections.map(s=>s.name),['drama:production']);assert.match(sections[0].text,/前期不分集/);assert.match(sections[0].text,/纯程序/)
})


test('V2记忆工具与制作工具沿同一注册入口挂载，指导限制跨项目范围和来源',()=>{
 const tools=[],sections=[],memory=[{name:'drama-read-memory'},{name:'drama-write-memory'}],ctx={drama:{documentVersion:2,createProjectTool:{name:'drama-create-project'},productionTools:memory},tools:{register:tool=>{tools.push(tool.name);return ()=>{}}},systemPrompt:{getSectionOrder:()=>10200,section:s=>{sections.push(s);return ()=>{}}},effect:fn=>fn()}
 apply(ctx);assert.deepEqual(tools,['drama-create-project',...memory.map(t=>t.name)]);assert.match(sections[0].text,/只在Drama跨项目/);assert.match(sections[0].text,/保留原话/);assert.match(sections[0].text,/不自动提升AI推断或审核意见/)
})
