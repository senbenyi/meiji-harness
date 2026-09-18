// 职责：在当前 Runpod 镜像内管理本模块启动的 ComfyUI 进程，不管理云实例或 Harness。
import { open, readFile, writeFile, rm } from 'node:fs/promises'
import { join, isAbsolute } from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { setTimeout } from 'node:timers/promises'
import { deployment } from './config.js'

export async function manageService(action, { root = deployment.root, port = deployment.port, venvSuffix = process.env.VENV_SUFFIX || deployment.venvSuffix,
  system = { spawn, spawnSync, kill: (pid, signal) => process.kill(pid, signal), pause: setTimeout, fetch } } = {}) {
  if (!['check', 'start', 'stop', 'restart'].includes(action)) throw new Error('服务操作仅支持 check/start/stop/restart')
  if (!isAbsolute(root) || !Number.isInteger(port) || port < 1 || port > 65535 || !/^[A-Za-z0-9_-]+$/.test(venvSuffix)) throw new Error('Runpod 服务目录、端口或虚拟环境参数无效')
  const comfyui = join(root, 'ComfyUI'), python = join(comfyui, `.venv-${venvSuffix}/bin/python`)
  const pidFile = join(root, 'comfyui.pid'), logFile = join(root, 'comfyui.log')
  const url = `http://127.0.0.1:${port}`
  if (action === 'check') {
    const response = await system.fetch(`${url}/system_stats`, { signal: AbortSignal.timeout(10000) })
    if (!response.ok) throw new Error(`ComfyUI HTTP ${response.status}`)
    return { status: 'ready', url }
  }
  const lock = await open(`${pidFile}.lock`, 'wx', 0o600)
  try {
    async function owner() {
      const text = await readFile(pidFile, 'utf8').catch(error => { if (error.code === 'ENOENT') return ''; throw error })
      if (!text) return null
      const pid = Number(text)
      if (!Number.isSafeInteger(pid) || pid <= 1) throw new Error('服务 PID 记录无效，未操作进程')
      const result = system.spawnSync('ps', ['-p', String(pid), '-o', 'args='], { encoding: 'utf8' })
      if (result.status === 1) { await rm(pidFile, { force: true }); return null }
      if (result.status !== 0 || !result.stdout.trim().startsWith(`${python} main.py `) || !new RegExp(`(?:^|\\s)--port ${port}(?:\\s|$)`).test(result.stdout)) throw new Error('服务进程身份不匹配，未操作进程')
      return pid
    }
    async function stop() {
      const pid = await owner()
      if (!pid) return { status: 'stopped', pids: [] }
      system.kill(pid, 'SIGTERM')
      for (let attempt = 0; attempt < 30; attempt++) {
        if (!await owner()) return { status: 'stopped', pids: [pid] }
        await system.pause(1000)
      }
      throw new Error('ComfyUI 未能停止，未强制终止进程')
    }
    async function start() {
      const existing = await owner()
      if (existing) return { status: 'running', pid: existing, url }
      const customArgs = (await readFile(join(root, 'comfyui_args.txt'), 'utf8')).split(/\r?\n/).map(line => line.replace(/#.*$/, '').trim()).filter(Boolean).flatMap(line => line.split(/\s+/))
      if (customArgs.some(arg => arg === '--port' || arg.startsWith('--port='))) throw new Error('comfyui_args.txt 不得覆盖受管理端口')
      const log = await open(logFile, 'a')
      try {
        const child = system.spawn(python, ['main.py', '--listen', '0.0.0.0', '--port', String(port), '--enable-cors-header', ...customArgs], { cwd: comfyui, detached: true, stdio: ['ignore', log.fd, log.fd] })
        await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject) })
        await writeFile(pidFile, String(child.pid), { mode: 0o600 })
        child.unref()
        return { status: 'started', pid: child.pid, log: logFile, url }
      } finally { await log.close() }
    }
    if (action === 'stop') return await stop()
    if (action === 'restart') await stop()
    return await start()
  } finally { await lock.close(); await rm(`${pidFile}.lock`, { force: true }) }
}
