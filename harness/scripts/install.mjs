#!/usr/bin/env node

import { existsSync } from 'node:fs'
import { cp, mkdir, readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { delimiter, dirname, join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// 本机安装入口：安装 Harness、覆盖 .dsh 配置并安装 Elysium 插件依赖。
const scriptsRoot = dirname(fileURLToPath(import.meta.url))
const harnessRoot = resolve(scriptsRoot, '..')
const repoRoot = resolve(harnessRoot, '..')
const source = join(harnessRoot, '.dsh')
const target = join(homedir(), '.dsh')
const plugin = join(repoRoot, 'dsh-elysium')
const webProfile = join(target, 'profiles', 'web')
const run = (command, args, options = {}) => execFileSync(command, args, { stdio: 'inherit', ...options })
const hasCommand = name => (process.env.PATH || '').split(delimiter).some(directory => existsSync(join(directory, name)))

// 1. 仅在本机不存在 dsh 命令时安装 DeepSeek Harness。
if (!hasCommand('dsh')) run('pnpm', ['add', '-g', '@deepseek-ai/dsh'])

// 2. 逐项覆盖项目管理的 .dsh 内容，不删除本机已有的其他文件。
await mkdir(target, { recursive: true })
for (const entry of await readdir(source)) {
  await cp(join(source, entry), join(target, entry), { recursive: true, force: true, verbatimSymlinks: true })
}

// 3. 构建 registry 包并将工具插件安装为本机 Web profile 依赖。
run('pnpm', ['install', '--frozen-lockfile', '--ignore-scripts'], { cwd: plugin })
run('pnpm', ['build'], { cwd: plugin })
run('pnpm', ['package:registry'], { cwd: plugin })
run('pnpm', ['add', '--workspace-root', join(plugin, 'registry')], { cwd: webProfile })

console.log('安装完成，请运行 node harness/scripts/start.mjs')
