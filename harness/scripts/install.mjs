#!/usr/bin/env node

import { existsSync } from 'node:fs'
import { chmod, cp, mkdir, readdir } from 'node:fs/promises'
import { dshHome, installStorage, verifyMedia } from './storage-template.mjs'
import { delimiter, dirname, join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// 本机安装入口：安装 Harness、覆盖 .dsh 配置并安装 Elysium 插件依赖。
const scriptsRoot = dirname(fileURLToPath(import.meta.url))
const harnessRoot = resolve(scriptsRoot, '..')
const repoRoot = resolve(harnessRoot, '..')
const source = join(harnessRoot, '.dsh')
const target = dshHome()
const plugin = join(repoRoot, 'dsh-elysium')
const webProfile = join(target, 'profiles', 'web')
const run = (command, args, options = {}) => execFileSync(command, args, { stdio: 'inherit', ...options })
const hasCommand = name => (process.env.PATH || '').split(delimiter).some(directory => existsSync(join(directory, name)))

const manifests = await verifyMedia(join(source, 'storages', 'elysium'))
for (const manifest of manifests) console.log(`离线案例媒体校验通过：${manifest.files.length} 份；镜头版本：${manifest.shot_variant}`)

// 1. 仅在本机不存在 dsh 命令时安装 DeepSeek Harness。
if (!hasCommand('dsh')) run('pnpm', ['add', '-g', '@deepseek-ai/dsh'])

// 2. 覆盖项目管理的配置；凭据始终由本机 Harness 管理。
await mkdir(target, { recursive: true })
for (const entry of await readdir(source)) {
  if (entry === '.credentials.yaml' || entry === '.env.example') continue
  if (entry === 'storages') {
    for (const storage of await readdir(join(source, entry))) await installStorage(join(source, entry, storage), join(target, entry, storage))
    continue
  }
  await cp(join(source, entry), join(target, entry), { recursive: true, force: true, verbatimSymlinks: true })
}
for (const name of ['.env', '.credentials.yaml']) {
  const sensitiveFile = join(target, name)
  if (existsSync(sensitiveFile)) await chmod(sensitiveFile, 0o600)
}

// 3. 构建 registry 包并将工具插件安装为本机 Web profile 依赖。
run('pnpm', ['install', '--frozen-lockfile', '--ignore-scripts'], { cwd: plugin })
run('pnpm', ['build'], { cwd: plugin })
run('pnpm', ['package:registry'], { cwd: plugin })
run('pnpm', ['add', '--workspace-root', join(plugin, 'registry')], { cwd: webProfile })

console.log('安装完成，请运行 node harness/scripts/start.mjs')
