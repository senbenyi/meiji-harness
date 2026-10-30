import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { createModelRecorder } from '@agent-modules/http-client/model-records'
import { HttpRecords } from '@agent-modules/http-client/records'
import { TaskManager } from '@agent-modules/task'
import { SQLiteTaskStore } from '@agent-modules/task/sqlite'
import {projectStages} from '../shared/production_stages.js'

export const historyNodeTypes=[...projectStages.map(stage=>({type:stage.id,label:stage.title})),{type:'memory_maintenance',label:'记忆整理'}]

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
