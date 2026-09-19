// 职责：为跨进程任务启动提供可等待、可回收的目录锁。
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ModelTaskError } from '../../utils/errors.js'

const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))
const processAlive = pid => {
  try { process.kill(pid, 0); return true } catch (error) { return error.code === 'EPERM' }
}

async function acquireLaunchLock(lock, token, wait) {
  for (;;) {
    try {
      await mkdir(lock)
      try { await writeFile(join(lock, 'owner'), token, { mode: 0o600 }) }
      catch (error) { await rm(lock, { recursive: true, force: true }); throw error }
      return
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
    }
    const owner = await readFile(join(lock, 'owner'), 'utf8').catch(() => '')
    const pid = Number(owner.split(':', 1)[0])
    if (Number.isInteger(pid) && processAlive(pid)) {
      if (wait) { await pause(50); continue }
      throw new ModelTaskError('WORKFLOW_RECOVERY_REQUIRED', '任务正在启动，请稍后查询原任务', 409)
    }
    const stale = `${lock}.stale-${randomUUID()}`
    try { await rename(lock, stale); await rm(stale, { recursive: true }) } catch (error) {
      if (!['ENOENT', 'EEXIST'].includes(error.code)) throw error
    }
  }
}

export async function withLaunchLock(directory, callback, wait = false) {
  const lock = join(directory, 'launch.lock')
  const token = `${process.pid}:${randomUUID()}`
  try {
    await acquireLaunchLock(lock, token, wait)
    return await callback()
  } finally {
    if (await readFile(join(lock, 'owner'), 'utf8').catch(() => '') === token) await rm(lock, { recursive: true })
  }
}
