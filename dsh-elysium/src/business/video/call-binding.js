// 职责：在 Harness 工具调用与本地视频任务之间建立可恢复索引。
import { requiredConfig } from '../../config.js'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const root = () => requiredConfig('ELYSIUM_STATE_ROOT')
const valid = value => typeof value === 'string' && value.length > 0 && value.length <= 256
const file = (sessionId, callId) => {
  if (!valid(sessionId) || !valid(callId)) throw new Error('Invalid call identity')
  return join(root(), 'runtime', 'calls', createHash('sha256').update(JSON.stringify([sessionId, callId])).digest('hex') + '.json')
}
export async function bindVideoCall(jobId, exec) {
  if (!exec?.agent || !exec.callId) return
  const sessionId = exec.agent.session.id
  const target = file(sessionId, exec.callId)
  await mkdir(join(root(), 'runtime', 'calls'), { recursive: true })
  const temporary = `${target}.${randomUUID()}.tmp`
  await writeFile(temporary, JSON.stringify({ session_id: sessionId, call_id: exec.callId, job_id: jobId }), { mode: 0o600 })
  await rename(temporary, target)
}
export async function findVideoCall(sessionId, callId, session) {
  try {
    return JSON.parse(await readFile(file(sessionId, callId), 'utf8')).job_id
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  // Older completed calls have no index: use only the host's authoritative paired result.
  if (session?.id !== sessionId) return null
  const events = session.snapshotEvents()
  const calls = events.filter(e => e.type === 'tool/call' && e.data.callId === callId)
  if (!calls.some(e => ['workflow_generate_video', 'workflow_resume_video', 'workflow_generate_image', 'workflow_resume_image'].includes(e.data.name))) return null
  for (const event of events) {
    if (event.type !== 'tool/result') continue
    for (const block of event.data.message?.content || []) {
      if (block.type !== 'tool-result' || block.toolCallId !== callId || block.isError) continue
      for (const item of block.content || []) {
        try {
          const value = JSON.parse(item.text)
          const id = value.job_id || value.output?.job_id
          if (/^[a-f0-9]{32}$/.test(id)) return id
        } catch { /* Non-JSON content has no trusted job identity. */ }
      }
    }
  }
  return null
}
