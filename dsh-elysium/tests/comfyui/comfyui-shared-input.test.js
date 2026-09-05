import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { resolveSharedInput } from '../../src/infrastructure/comfyui/engine.js'
import { resolveComfyUiConfig } from '../../src/infrastructure/comfyui/service.js'

test('共享区内的文件直接按相对路径引用，不复制不上传', () => {
  const root = '/srv/comfyui/input'
  const resolved = resolveSharedInput(root, '/srv/comfyui/input/elysium/anchor-01.png')
  assert.equal(resolved.mode, 'shared-path')
  assert.equal(resolved.name, 'elysium/anchor-01.png')
  assert.equal(resolved.target, '/srv/comfyui/input/elysium/anchor-01.png')
})

test('共享区外的文件落进区内再引用，同名产物不互相覆盖', () => {
  const root = '/srv/comfyui/input'
  const a = resolveSharedInput(root, '/work/episode-01/anchors/frame.png')
  const b = resolveSharedInput(root, '/work/episode-02/anchors/frame.png')
  assert.equal(a.mode, 'shared-copy')
  assert.match(a.name, /^elysium\/[a-f0-9]{8}-frame\.png$/)
  assert.notEqual(a.name, b.name, '不同来源的同名文件必须落到不同引用名')
  assert.equal(a.target, path.join(root, ...a.name.split('/')))
})

test('引用名一律使用正斜杠，供 ComfyUI 的 input 子目录寻址', () => {
  const resolved = resolveSharedInput('/srv/in', '/srv/in/a/b/c.png')
  assert.equal(resolved.name, 'a/b/c.png')
  assert.ok(!resolved.name.includes('\\'))
})

test('未配置共享区时运行时不返回路径，保持既有上传行为', async t => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'elysium-shared-'))
  t.after(() => rm(workspace, { recursive: true, force: true }))
  const runtime = resolveComfyUiConfig({ workspace })
  assert.equal(runtime.sharedInputRoot, '')
})

test('配置共享区后运行时给出绝对路径', async t => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'elysium-shared-'))
  t.after(() => rm(workspace, { recursive: true, force: true }))
  const runtime = resolveComfyUiConfig({ workspace, comfyui: { sharedInputRoot: path.join(workspace, 'shared-input') } })
  assert.equal(runtime.sharedInputRoot, path.join(workspace, 'shared-input'))
  assert.ok(path.isAbsolute(runtime.sharedInputRoot))
})
