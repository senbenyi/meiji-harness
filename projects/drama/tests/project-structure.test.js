import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createProject } from '../src/node_box/project/create_project.js'
import { createNode } from '../src/node_runtime/node_initializer.js'
import { nodeContract } from '../src/node_runtime/output_contract_renderer.js'
import { nodeDefinitions } from '../src/node_runtime/node_definition_registry.js'

const keys = value => Object.keys(value).sort()
test('新项目实际字段对应结构文档，独立节点规则状态无output副本，媒体节点保持原契约', async () => {
  const document = JSON.parse(await readFile(new URL('../docs/project_detail.json', import.meta.url), 'utf8'))
  const project = await createProject({name:'目标结构',original_script:'剧本正文',original_script_filename:'原文.md'})
  assert.deepEqual(keys(project), keys(document).filter(key=>!key.startsWith('$')))
  assert.deepEqual(keys(project.basic_info), keys(document.basic_info))
  assert.equal(project.basic_info.actual_script,'剧本正文')
  assert.match(project.basic_info.original_script_file_path,/\/原文\.md$/)
  assert.equal(project.basic_info.create_project_node.type,0)
  assert.equal(project.basic_info.script_revision_node.type,1)
  assert.equal(project.basic_info.script_revision_node.last_execution,null)
  assert.deepEqual(keys(nodeContract('script_revision').schema.properties),['actual_script','estimated_duration_seconds','summary'])
  for (const type of ['story_segments','group_setting','character_extraction','scene_extraction','shot_design','video_prompt']) {
    assert.deepEqual(keys(project[type]),keys(document[type]))
    assert.equal(project[type].node_state.type,1)
    assert.deepEqual(keys(project[type].node_state),keys(document.$defs.node_state))
    assert.equal(project[type].node_state.opinion,'')
    assert.equal(Object.hasOwn(project[type],'output'),false)
    assert.equal(Object.hasOwn(project[type],'rules'),false)
    const output = nodeDefinitions[type].output
    assert.deepEqual(keys(output.properties),keys(document[type]).filter(key=>!['assets','node_state'].includes(key)))
  }
  for(const type of ['costume_image','scene_image']) {
    const node=await createNode(type)
    assert.equal(node.address,'');assert.equal(node.node_state.type,1)
    assert.equal(Object.hasOwn(node,'output'),false)
  }
})
