// 状态稳定性约束：失败只记在步骤与内容节点上；服务端内容状态只经 shared/content-state.js 转换。
// 占用与并发规则见 state-locks、run-engine、run-service 测试。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runOperation } from './fixtures/operation.js'
import { setupModel } from './fixtures/model.js'

test('B2 步骤失败只记录在任务步骤与内容节点上，不写剧集级 activityError', async t => {
  const e = await setupModel(t)
  await assert.rejects(runOperation(e.op('shot-table', {}), { home: e.home, generateShots: async () => { throw new Error('镜头表生成失败') } }), /镜头表生成失败/)
  const episode = await e.read(), root = await e.store.read(e.id)
  assert.equal(episode.shots.error, '镜头表生成失败')
  assert.equal(episode.activityError ?? null, null)
  assert.equal(root.activityError ?? null, null)
})

const root = fileURLToPath(new URL('..', import.meta.url))
function serverFiles(dir = 'server') {
  return readdirSync(join(root, dir)).flatMap(name => {
    const path = `${dir}/${name}`
    return statSync(join(root, path)).isDirectory() ? serverFiles(path) : path.endsWith('.js') ? [path] : []
  })
}
test('B4 服务端不直接修改内容节点状态，只经 shared/content-state.js 转换', () => {
  // 任意 `.status =` 赋值（步骤状态 StepStatus 除外）或对象字面量 `status: GenerationStatus.` 都视为直接修改。
  const offenders = serverFiles().flatMap(file => readFileSync(join(root, file), 'utf8').split('\n').map((line, index) => ({ file, line, index }))
    .filter(({ line }) => (/\.status\s*=(?!=)/.test(line) && !/StepStatus/.test(line)) || /\bstatus:\s*GenerationStatus\./.test(line))
    .map(({ file, index }) => `${relative('.', file)}:${index + 1}`))
  assert.deepEqual(offenders, [])
})
