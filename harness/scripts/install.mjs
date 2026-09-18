#!/usr/bin/env node

// 职责：安装 Harness、覆盖仓库托管的 Harness 配置，并安装 Elysium 插件包。
import { existsSync } from 'node:fs'
import { cp, mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { delimiter, dirname, isAbsolute, join, parse, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

function dshHome(value = process.env.DSH_HOME) {
  if (value === undefined) return join(homedir(), '.dsh')
  if (!value.trim() || !isAbsolute(value) || resolve(value) === parse(value).root || resolve(value) === homedir()) throw new Error('DSH_HOME 必须为独立的绝对目录，不能是根目录或用户主目录')
  return resolve(value)
}

const scriptsRoot = dirname(fileURLToPath(import.meta.url))
const harnessRoot = resolve(scriptsRoot, '..')
const repoRoot = resolve(harnessRoot, '..')
const source = join(harnessRoot, '.dsh')
const target = dshHome()
const plugin = join(repoRoot, 'dsh-elysium')
const webProfile = join(target, 'profiles', 'web')
const pnpmBin = process.env.PNPM_HOME || join(homedir(), process.platform === 'darwin' ? 'Library/pnpm' : '.local/share/pnpm')
const pathWithPnpm = `${pnpmBin}${delimiter}${process.env.PATH || ''}`
const run = (command, args, options = {}) => execFileSync(command, args, { stdio: 'inherit', ...options })
const hasCommand = name => pathWithPnpm.split(delimiter).some(directory => directory && existsSync(join(directory, name)))

if (!hasCommand('dsh')) {
  await mkdir(pnpmBin, { recursive: true })
  run('pnpm', ['add', '-g', '@deepseek-ai/dsh'], { env: { ...process.env, PNPM_HOME: pnpmBin, PATH: pathWithPnpm } })
}

await mkdir(target, { recursive: true })
for (const entry of ['.agent-presets', 'profiles', 'settings.yaml']) {
  await cp(join(source, entry), join(target, entry), { recursive: true, force: true, verbatimSymlinks: true })
}

run('pnpm', ['install', '--frozen-lockfile', '--ignore-scripts'], { cwd: plugin })
run('pnpm', ['build'], { cwd: plugin })
run('pnpm', ['package:registry'], { cwd: plugin })
run('pnpm', ['add', '--workspace-root', join(plugin, 'registry')], { cwd: webProfile })

console.log('安装完成，请运行 node harness/scripts/start.mjs')
