// 职责：验证聊天项目工具只暴露读取和文档生成。
import test from 'node:test'
import assert from 'node:assert/strict'
import { createCallToolsProjectActions } from '../src/tools/project/project.js'

test('project chat tools cannot update projects or submit raw media tasks', () => {
  const tools = createCallToolsProjectActions({})
  assert.deepEqual(tools.map(tool => tool.name), ['call_tools_project_list', 'call_tools_project_read', 'call_tools_project_doc_generate'])
  assert.equal(tools.some(tool => /produce|create|update/.test(tool.name)), false)
})
