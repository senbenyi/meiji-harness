import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { createModelRecorder } from '@agent-modules/http-client/model-records'
import { HttpRecords } from '@agent-modules/http-client/records'
import { TaskManager } from '@agent-modules/task'
import { SQLiteTaskStore } from '@agent-modules/task/sqlite'
import { nodeDefinitions } from '../node_runtime/node_definition_registry.js'

const labels = { project: '项目管理', script_rules: '剧本规则修改', script_revision: '剧本优化', story_segments: '故事大纲', story_rules: '大纲规则修改', group_setting: '团队设定', group_rules: '团队规则修改', character_extraction: '人物提取', scene_rules: '场景规则修改', scene_extraction: '场景提取', costume_image: '定妆照', scene_image: '场景图', shot_design: '镜头设计', video_prompt: '视频提示词', clip_video: '分片视频', clip_composition: '分片编排', merge_video: '合片' }
export const historyNodeTypes = ['project', 'script_rules', 'story_rules', 'scene_rules', 'group_rules', ...Object.keys(nodeDefinitions).filter(key => !key.startsWith('$')), 'clip_composition', 'clip_video', 'merge_video'].map(type => ({ type, label: labels[type] || type }))

/** 插件全局记录：执行器使用tasks提交任务，HTTP调用传入http.record；不读取其他项目。 */
export function createRecordService(root) {
  mkdirSync(root, { recursive: true })
  const database = new DatabaseSync(join(root, 'records.sqlite'))
  const store = new SQLiteTaskStore(undefined, { database })
  database.exec('CREATE TABLE IF NOT EXISTS drama_record_migrations(name TEXT PRIMARY KEY)')
  if (!database.prepare('SELECT 1 FROM drama_record_migrations WHERE name=?').get('network-error-code-v1')) store.atomic(() => {
    // 旧版本只保存中文错误；仅在显式迁移中提取已明确记录的网络失败事实。
    const rows = database.prepare(`SELECT scope,id,data FROM agent_task_steps
      WHERE scope='drama' AND json_extract(data,'$.step_status')='failed'
      AND json_extract(data,'$.error_reason') LIKE '网络连接失败%'
      AND json_extract(data,'$.result.error_code') IS NULL`).all()
    const update = database.prepare('UPDATE agent_task_steps SET data=? WHERE scope=? AND id=?')
    for (const row of rows) {
      const step = JSON.parse(row.data)
      step.result = { ...step.result, error_code: 'NETWORK_CONNECTION_FAILED' }
      update.run(JSON.stringify(step), row.scope, row.id)
    }
    database.prepare('INSERT INTO drama_record_migrations(name) VALUES(?)').run('network-error-code-v1')
  })
  const http = new HttpRecords(database)
  const models = createModelRecorder({ record: http.record })
  const tasks = new TaskManager({ store, autoStart: false })
  let closing
  return { scope: 'drama', http, tasks, models, nodeTypes: historyNodeTypes, dispose() {
    return closing ||= (async () => { try { await models.dispose(); await tasks.dispose() } finally { database.close() } })()
  } }
}
