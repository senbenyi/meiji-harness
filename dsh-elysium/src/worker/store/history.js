// 职责：追加任务执行与人工恢复审计事件，不参与状态机判定。
import { mkdir, writeFile } from '../../database/files.js'
import { join } from 'node:path'

export async function appendHistory(directory, event, fields = {}) {
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, 'history.jsonl'), JSON.stringify({ event, at: new Date().toISOString(), ...fields }) + '\n', { flag: 'a', mode: 0o600 })
}
