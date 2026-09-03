#!/usr/bin/env node
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, watch } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { once } from 'node:events'

const root = resolve(import.meta.dirname, '..')
const tsdown = join(root, 'node_modules', '.bin', 'tsdown')
const serverConfig = join(root, 'tsdown.server.config.ts')
const outputDir = join(root, 'registry', 'lib')

function dshBin() {
  const candidates = [
    process.env.DSH_BIN,
    join(homedir(), 'Library', 'pnpm', 'dsh'),
    join(homedir(), '.local', 'share', 'pnpm', 'dsh'),
  ].filter(Boolean)
  return candidates.find(candidate => existsSync(candidate)) || 'dsh'
}

async function stopExistingWeb() {
  let output = ''
  try {
    output = execFileSync('lsof', ['-tiTCP:3080', '-sTCP:LISTEN'], { encoding: 'utf8' })
  } catch {
    return
  }
  for (const value of output.trim().split(/\s+/).filter(Boolean)) {
    const command = execFileSync('ps', ['-p', value, '-o', 'command='], { encoding: 'utf8' }).trim()
    if (!/dsh\/lib\/bin\.js web(?:\s|$)/.test(command)) {
      throw new Error(`port 3080 is occupied by a non-DSH process (${value})`)
    }
    process.kill(Number(value), 'SIGTERM')
    for (let attempt = 0; attempt < 30; attempt += 1) {
      try { process.kill(Number(value), 0) } catch { break }
      await new Promise(resolveTimeout => setTimeout(resolveTimeout, 100))
    }
  }
}

async function stop(child) {
  if (child === undefined || child.exitCode !== null) return
  child.kill('SIGTERM')
  await Promise.race([once(child, 'exit'), new Promise(resolveTimeout => setTimeout(resolveTimeout, 3000))])
  if (child.exitCode === null) child.kill('SIGKILL')
}

await stopExistingWeb()

let dsh
let closing = false
let restartTimer
let restartChain = Promise.resolve()

function startDsh() {
  dsh = spawn(dshBin(), ['web', '--no-open'], { cwd: resolve(root, '..'), stdio: 'inherit' })
  dsh.once('exit', code => {
    if (!closing && code !== 0 && code !== null) console.error(`dsh web exited with code ${code}`)
  })
}

function scheduleRestart() {
  clearTimeout(restartTimer)
  restartTimer = setTimeout(() => {
    restartChain = restartChain.then(async () => {
      console.log('server bundle updated; restarting dsh web')
      await stop(dsh)
      if (!closing) startDsh()
    })
  }, 150)
}

const builder = spawn(tsdown, ['--config', serverConfig, '--watch'], { cwd: root, stdio: 'inherit' })
const outputWatcher = watch(outputDir, (_event, filename) => {
  if (basename(String(filename)) === 'index.js') scheduleRestart()
})
startDsh()

async function shutdown(signal) {
  if (closing) return
  closing = true
  clearTimeout(restartTimer)
  outputWatcher.close()
  await Promise.all([stop(builder), stop(dsh)])
  process.exit(signal === 'SIGINT' ? 130 : 143)
}

process.once('SIGINT', () => void shutdown('SIGINT'))
process.once('SIGTERM', () => void shutdown('SIGTERM'))
