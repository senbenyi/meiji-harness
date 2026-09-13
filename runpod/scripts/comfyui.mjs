#!/usr/bin/env node

import { closeSync, openSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { spawn, spawnSync } from 'node:child_process'

// 服务器执行：管理当前 RunPod 镜像中的 ComfyUI 进程。
const root = '/workspace/runpod-slim'
const comfyui = join(root, 'ComfyUI')
const python = join(comfyui, `.venv-${process.env.VENV_SUFFIX || 'cu130'}/bin/python`)
const logFile = join(root, 'comfyui.log')
const action = process.argv[2]
const processPattern = 'python.*main.py.*--port 8188'
const sleep = milliseconds => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds)

async function check() {
  const response = await fetch('http://127.0.0.1:8188/system_stats')
  if (!response.ok) throw new Error(`ComfyUI HTTP ${response.status}`)
  console.log('ComfyUI 可用：http://127.0.0.1:8188')
}

async function start() {
  const customArgs = (await readFile(join(root, 'comfyui_args.txt'), 'utf8'))
    .split(/\r?\n/)
    .map(line => line.replace(/#.*$/, '').trim())
    .filter(Boolean)
    .flatMap(line => line.split(/\s+/))
  const log = openSync(logFile, 'a')
  const child = spawn(python, ['main.py', '--listen', '0.0.0.0', '--port', '8188', '--enable-cors-header', ...customArgs], {
    cwd: comfyui,
    detached: true,
    stdio: ['ignore', log, log],
  })
  closeSync(log)
  child.unref()
  console.log(`ComfyUI 已启动：PID ${child.pid}，日志 ${logFile}`)
}

function runningPids() {
  const result = spawnSync('pgrep', ['-f', processPattern], { encoding: 'utf8' })
  return result.stdout.trim().split(/\s+/).filter(Boolean)
}

function stop() {
  const pids = runningPids()
  for (const pid of pids) process.kill(Number(pid), 'SIGTERM')
  if (!pids.length) return console.log('ComfyUI 未运行')
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (!runningPids().length) return console.log(`ComfyUI 已停止：${pids.join(', ')}`)
    sleep(1000)
  }
  throw new Error(`ComfyUI 未能停止：${pids.join(', ')}`)
}

switch (action) {
  case 'check': await check(); break
  case 'start': await start(); break
  case 'stop': stop(); break
  case 'restart': stop(); await start(); break
  default: throw new Error('Usage: node runpod/scripts/comfyui.mjs <check|start|stop|restart>')
}
