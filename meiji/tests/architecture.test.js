import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// 依赖只能从高层指向低层：http/tools → flow → 文本执行/网关/提示词 → runtime → data → models → shared。
// host（Harness 适配层）与 shared（领域模块）可被任意服务端层引用；host 自身只依赖 shared。
// 服务端、工具与脚本不得 import client/（浏览器界面）。
const root = fileURLToPath(new URL('..', import.meta.url))
const layers = [
  ['server/http', 7], ['tools', 7], ['index.js', 8], ['session.js', 8],
  ['server/flow/steps', 4], ['server/flow', 6], ['server/gateway', 3.5], ['server/prompts', 3],
  ['server/media', 1],
  ['server/runtime/task-context.js', 0], ['server/runtime/task-state.js', 0], ['server/runtime/operation-context.js', 0],
  ['server/runtime', 2.5], ['server/data', 2], ['models', 1], ['skills', 1],
  ['server/host', 0], ['shared', 0],
]
const layerOf = file => layers.filter(([prefix]) => file === prefix || file.startsWith(prefix + '/')).sort((a, b) => b[0].length - a[0].length)[0]

function sources(dir = '') {
  const out = []
  for (const name of readdirSync(join(root, dir))) {
    const path = dir ? `${dir}/${name}` : name
    if (statSync(join(root, path)).isDirectory()) {
      if (!['node_modules', 'tests', 'reports', 'docs', 'client', 'config'].includes(name)) out.push(...sources(path))
    } else if (path.endsWith('.js')) out.push(path)
  }
  return out
}

function imports(file) {
  const source = readFileSync(join(root, file), 'utf8')
  return [...source.matchAll(/(?:from|import\()\s*['"](\.[^'"]+)['"]/g)].map(([, spec]) => relative(root, resolve(root, dirname(file), spec)).split('\\').join('/'))
}

test('server layers only depend downward', () => {
  const violations = []
  for (const file of sources()) {
    const from = layerOf(file)
    if (!from) continue
    for (const target of imports(file)) {
      if (target.startsWith('client/')) { violations.push(`${file} → ${target}（不得引用 client/）`); continue }
      const to = layerOf(target)
      if (!to || to === from) continue
      if (from[0] === 'server/host' && to[0] !== 'shared') { violations.push(`${file} → ${target}（host 只能依赖 shared）`); continue }
      if (to[1] === 0) continue
      if (to[1] >= from[1]) violations.push(`${file} → ${target}（${from[0]} 不得依赖 ${to[0]}）`)
    }
  }
  assert.deepEqual(violations, [])
})

test('scripts use shared modules instead of client/', () => {
  const dir = join(root, 'scripts')
  for (const name of readdirSync(dir).filter(file => file.endsWith('.js'))) {
    for (const target of imports(`scripts/${name}`)) assert.equal(target.startsWith('client/'), false, `scripts/${name} → ${target}`)
  }
})

// 上下文/状态是存储与执行共同使用的叶子；不能反向引用 data 或执行器。
test('runtime context and state stay independent of storage and execution', () => {
  const leaves = ['server/runtime/task-context.js', 'server/runtime/task-state.js', 'server/runtime/operation-context.js']
  for (const file of leaves) for (const target of imports(file)) {
    assert.ok(target.startsWith('shared/') || leaves.includes(target), `${file} → ${target}`)
  }
})

test('shared rules have no server or Node dependencies', () => {
  for (const file of sources('shared')) {
    for (const target of imports(file)) assert.ok(target.startsWith('shared/'), `${file} → ${target}`)
    const source = readFileSync(join(root, file), 'utf8')
    const external = [...source.matchAll(/(?:from|import\()\s*['"]([^.'"][^'"]*)['"]/g)]
    assert.deepEqual(external.map(match => match[1]), [], file)
  }
})

// 新目录必须有明确的依赖边界；同层模块也不能形成循环。
test('server directories are classified and module imports are acyclic', () => {
  const files = sources()
  for (const file of files.filter(file => file.startsWith('server/'))) assert.ok(layerOf(file), `未定义分层：${file}`)
  const graph = new Map(files.map(file => [file, imports(file)]))
  const done = new Set(), visiting = []
  const visit = file => {
    assert.ok(!visiting.includes(file), `循环依赖：${[...visiting, file].join(' → ')}`)
    if (done.has(file)) return
    visiting.push(file)
    for (const target of graph.get(file) || []) if (graph.has(target)) visit(target)
    visiting.pop()
    done.add(file)
  }
  for (const file of files) visit(file)
})
