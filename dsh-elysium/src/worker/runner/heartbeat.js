// 职责：记录本地 worker 活跃时间，并判断仍存活进程是否已失去进展信号。
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { saveJson } from '../../database/json.js'

const INTERVAL = 10_000
export const STALE_AFTER = 60_000

export function startHeartbeat(directory, jobId) {
  const write = state => saveJson(join(directory, 'heartbeat.json'), { job_id: jobId, pid: process.pid, state, updated_at: Date.now() })
  void write('running').catch(() => {})
  const timer = setInterval(() => void write('running').catch(() => {}), INTERVAL)
  timer.unref?.()
  return async () => { clearInterval(timer); await write('stopped') }
}

export async function heartbeatStale(directory, now = Date.now()) {
  try {
    const value = JSON.parse(await readFile(join(directory, 'heartbeat.json'), 'utf8'))
    return value.state === 'running' && (!Number.isFinite(value.updated_at) || now - value.updated_at > STALE_AFTER)
  } catch (error) {
    if (error.code === 'ENOENT') return false
    return true
  }
}
