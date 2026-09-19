// 职责：受理侧的会话绑定：媒体工具名单、Harness 调用 ↔ 任务索引，以及同一会话的串行受理锁。
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { runtimeRoot } from '../../database/paths.js'
import { withLaunchLock } from '../store/lock.js'

// 媒体工具唯一名单；generate 创建或复用任务，recover 恢复原任务。
export const MEDIA_TOOLS = Object.freeze({
  image: Object.freeze({ generate: 'call_tools_image', recover: 'call_tools_image_recover' }),
  video: Object.freeze({ generate: 'call_tools_video', recover: 'call_tools_video_recover' }),
})
export const mediaToolNames = kind => kind ? Object.values(MEDIA_TOOLS[kind]) : Object.keys(MEDIA_TOOLS).flatMap(mediaToolNames)

// 同一会话的受理与恢复串行执行，避免并发调用重复建档。
export async function withSessionLock(invocation, callback) {
  if (!invocation?.sessionId) return callback()
  const directory = join(runtimeRoot(), 'sessions', createHash('sha256').update(invocation.sessionId).digest('hex'))
  await mkdir(directory, { recursive: true })
  return withLaunchLock(directory, callback, true)
}

const valid = value => typeof value === 'string' && value.length > 0 && value.length <= 256
const file = (sessionId, callId) => {
  if (!valid(sessionId) || !valid(callId)) throw new Error('Invalid call identity')
  return join(runtimeRoot(), 'calls', createHash('sha256').update(JSON.stringify([sessionId, callId])).digest('hex') + '.json')
}
export async function bindJobCall(jobId, invocation) {
  if (!invocation?.sessionId || !invocation.callId) return
  const target = file(invocation.sessionId, invocation.callId)
  await mkdir(join(runtimeRoot(), 'calls'), { recursive: true })
  const temporary = `${target}.${randomUUID()}.tmp`
  await writeFile(temporary, JSON.stringify({ session_id: invocation.sessionId, call_id: invocation.callId, job_id: jobId }), { mode: 0o600 })
  await rename(temporary, target)
}
export async function findJobCall(sessionId, callId, history) {
  try {
    return JSON.parse(await readFile(file(sessionId, callId), 'utf8')).job_id
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  // Older completed calls have no index: use only the host adapter's normalized paired result.
  if (history?.sessionId !== sessionId) return null
  return history.calls?.find(call => call.callId === callId)?.jobId || null
}
