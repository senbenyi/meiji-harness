#!/usr/bin/env node
import { execFileSync, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')

function run(command, args) {
  execFileSync(command, args, { cwd: root, stdio: 'inherit' })
}

function dshBin() {
  const candidates = [
    process.env.DSH_BIN,
    join(homedir(), 'Library', 'pnpm', 'dsh'),
    join(homedir(), '.local', 'share', 'pnpm', 'dsh'),
  ].filter(Boolean)
  return candidates.find(candidate => existsSync(candidate)) || 'dsh'
}

run('pnpm', ['test'])
run('pnpm', ['build'])
run(process.execPath, ['scripts/package-registry.mjs'])
run(dshBin(), ['plugin', '--profile', 'web', 'add', '--workspace-root', join(root, 'registry')])

let output = ''
try {
  output = execFileSync('lsof', ['-tiTCP:3080', '-sTCP:LISTEN'], { encoding: 'utf8' })
} catch { /* no running web process */ }
for (const value of output.trim().split(/\s+/).filter(Boolean)) {
  const command = execFileSync('ps', ['-p', value, '-o', 'command='], { encoding: 'utf8' }).trim()
  if (!/dsh\/lib\/bin\.js web(?:\s|$)/.test(command)) throw new Error(`port 3080 is occupied by a non-DSH process (${value})`)
  process.kill(Number(value), 'SIGTERM')
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try { process.kill(Number(value), 0) } catch { break }
    await new Promise(resolveTimeout => setTimeout(resolveTimeout, 100))
  }
}

const child = spawn(dshBin(), ['web', '--no-open'], { cwd: resolve(root, '..'), detached: true, stdio: 'ignore' })
child.unref()
let ready = false
for (let attempt = 0; attempt < 30; attempt += 1) {
  try {
    const response = await fetch('http://127.0.0.1:3080/elysium/api/project.list', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })
    if (response.ok) { ready = true; break }
  } catch { /* still starting */ }
  await new Promise(resolveTimeout => setTimeout(resolveTimeout, 200))
}
if (!ready) throw new Error('local release installed, but dsh web did not become ready on port 3080')
console.log('local release installed; dsh web is ready on port 3080')
