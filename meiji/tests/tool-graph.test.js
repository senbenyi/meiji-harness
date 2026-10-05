import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { operations } from '../server/flow/operations/operation-registry.js'
import { taskRegistry } from '../server/flow/tasks/task-registry.js'
import { stageCatalog } from '../skills/skill-catalog.js'
import { operationTools, waitImagesTool } from '../tools/session-operation-tools.js'
import { contextQueryTool } from '../tools/session-context-query-tool.js'
import { projectManageTool } from '../tools/session-project-manage-tool.js'
const graph = JSON.parse(readFileSync(new URL('../skills/tool-graph.json', import.meta.url)))
test('工具图谱覆盖会话操作与所有生成任务，依赖无环且声明顺序一致', () => {
  const tools = [...operationTools({}), waitImagesTool({}), contextQueryTool({}), projectManageTool({})]
  const names = tools.map(tool => tool.name)
  assert.equal(new Set(names).size, names.length)
  assert.deepEqual(new Set([...graph.tools, ...graph.stages.map(item => item.tool), ...graph.maintenance.map(item => item.tool).filter(Boolean)]), new Set(names))
  for (const tool of tools) assert.equal(tool.parameters.additionalProperties, false)
  const covered = new Set(['save', ...graph.panelOnlyTasks]), skills = new Set(stageCatalog.map(item => item.id))
  for (const row of [...graph.stages, ...graph.maintenance]) {
    assert.ok(operations[row.operation]); if (row.tool) assert.equal(operations[row.operation].session.tool, row.tool)
    for (const task of row.tasks) { assert.ok(taskRegistry[task]); covered.add(task) }
    for (const skill of row.skills) assert.ok(skills.has(skill), skill)
  }
  assert.deepEqual(covered, new Set(Object.keys(taskRegistry)))
  const seen = new Set()
  for (const row of graph.stages) { for (const dependency of row.after) assert.ok(seen.has(dependency)); seen.add(row.id) }
  assert.equal(operations['character-image'].agent, false); assert.equal(operations['scene-image'].agent, false); assert.equal(operations['prop-image'].agent, false)
  const session = readFileSync(new URL('../skills/session/panel.md', import.meta.url), 'utf8')
  assert.doesNotMatch(session, /meiji_content_generate|meiji_task_control|job_wait|job_read/)
  assert.match(session, /job_output/)
})
