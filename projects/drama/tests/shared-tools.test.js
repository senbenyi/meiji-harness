import test from 'node:test'
import assert from 'node:assert/strict'
import { apply } from '../src/session/index.js'

test('共享注册保留宿主工具和身份，业务工具与指导随插件销毁移除，重新挂载不重复', () => {
  const builtin = { name: 'read' }, project = { name: 'drama-create-project' }, optimize = { name: 'drama-optimize-script' }
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
    drama: { createProjectTool: project, optimizeScriptTool: optimize },
    tools: { register: item => register(tools, item) },
    systemPrompt: { getSectionOrder: () => 10200, section: item => register(sections, item) },
    effect(fn) { disposers.push(fn()) },
  }
  for (let pass = 0; pass < 2; pass++) {
    apply(ctx)
    assert.equal(tools.get('read'), builtin)
    assert.equal(tools.get(project.name), project)
    assert.equal(tools.get(optimize.name), optimize)
    assert.match(sections.get('drama:script-optimization').text, /completed/)
    assert.equal(sections.get(persona.name), persona)
    assert.match(sections.get('drama:project-creation').text, /仅当用户明确要求/)
    assert.match(sections.get('drama:project-creation').text, /标准模式新会话/)
    for (const dispose of disposers.splice(0).reverse()) dispose()
    assert.deepEqual([...tools.values()], [builtin])
    assert.deepEqual([...sections.values()], [persona])
  }
})
