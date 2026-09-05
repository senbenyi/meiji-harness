import test from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { defaultPlan } from '../../src/domain/episode.js'
import { createOnelineService } from '../../src/application/oneline-service.js'

const SOURCE = '雨夜末班列车上两名旧识重逢，在到站前必须对一段未了结的关系作出选择。'

/** Producer Agent 的替身：返回结构与 planning-service 的 normalizeResult 一致。 */
function plannerStub() {
  const calls = []
  return {
    calls,
    async plan(body) {
      calls.push(body)
      const plan = defaultPlan(body, body.episodeId, body.targetDurationSec)
      return {
        plan: { ...plan, source: 'producer-agent' },
        script: { schemaVersion: 'elysium-script-2', source: 'producer-agent', synopsis: body.sourceText, scenes: [] },
        assets: [{ id: 'cast-main', type: 'character', name: '角色定妆表', prompt: '成年角色定妆', status: 'prompt_ready' }],
      }
    },
  }
}

function productionStub() {
  const calls = { start: [], retry: [], approve: [] }
  return {
    calls,
    async start(body) { calls.start.push(body); return { ok: true } },
    async retry(body) { calls.retry.push(body); return { ok: true } },
    async approve(body) { calls.approve.push(body); return { ok: true, state: {} } },
  }
}

async function fixture(t) {
  const workspace = await mkdtemp(path.join(tmpdir(), 'elysium-oneline-'))
  t.after(() => rm(workspace, { recursive: true, force: true }))
  const planner = plannerStub()
  const production = productionStub()
  return { config: { workspace }, planner, production, oneline: createOnelineService({ workspace }, planner, production) }
}

test('未授权提交只建草稿，不开工', async t => {
  const { oneline, production } = await fixture(t)
  const result = await oneline.submit({ sourceText: SOURCE })
  assert.equal(result.needsUser, 'consent')
  assert.equal(result.state, 'awaiting_authorization')
  assert.ok(result.projectId)
  assert.match(result.manifestId, /^manifest-[a-f0-9]{16}$/)
  assert.equal(result.manifestVersion, 1)
  // 授权是两处必要人工确认之一，模型不得代劳。
  assert.equal(production.calls.start.length, 0, '未授权时不得启动生产')
})

test('带授权提交才启动生产', async t => {
  const { oneline, production } = await fixture(t)
  const result = await oneline.submit({ sourceText: SOURCE, confirmAuthorizedContent: true })
  assert.equal(production.calls.start.length, 1)
  assert.equal(production.calls.start[0].confirmAuthorizedContent, true)
  assert.equal(production.calls.start[0].projectId, result.projectId)
})

test('一句话原样传给规划，不替用户扩写', async t => {
  const { oneline, planner } = await fixture(t)
  await oneline.submit({ sourceText: SOURCE })
  assert.equal(planner.calls.length, 1)
  assert.equal(planner.calls[0].sourceText, SOURCE)
  assert.equal(planner.calls[0].targetDurationSec, 20)
})

test('manifest 落盘且重复派生保持幂等', async t => {
  const { oneline, config } = await fixture(t)
  const first = await oneline.submit({ sourceText: SOURCE })
  const manifestPath = path.join(config.workspace, 'projects', first.projectId, 'episodes', first.episodeId, 'manifest.json')
  assert.ok(fs.existsSync(manifestPath), 'manifest 必须落盘')
  const stored = JSON.parse(await readFile(manifestPath, 'utf8'))
  assert.equal(stored.manifestId, first.manifestId)
  assert.equal(stored.shots.length, 6)

  const again = await oneline.persistManifest(first.projectId, first.episodeId)
  assert.equal(again.manifestId, first.manifestId, '故事未变时 manifestId 不得改变')
  assert.equal(again.manifestVersion, first.manifestVersion)
})

test('status 返回界面需要的字段，且不外露章节与锚点术语', async t => {
  const { oneline } = await fixture(t)
  const created = await oneline.submit({ sourceText: SOURCE })
  const status = await oneline.status({ projectId: created.projectId, episodeId: created.episodeId })
  assert.equal(status.state, 'awaiting_authorization')
  assert.equal(status.needsUser, 'consent')
  assert.ok(Number.isInteger(status.progress.total))
  assert.deepEqual(status.artifacts, [])
  assert.equal(status.final, null)
  // 非 needs_attention 时不把问题清单推给用户。
  assert.deepEqual(status.issues, [])
  for (const key of ['plan', 'tasks', 'chapters', 'anchors']) {
    assert.ok(!(key in status), `status 不应外露 ${key}`)
  }
})

test('重做单镜转发到生产层的局部重试', async t => {
  const { oneline, production } = await fixture(t)
  const created = await oneline.submit({ sourceText: SOURCE })
  await oneline.redo({ projectId: created.projectId, episodeId: created.episodeId, taskId: 'anchor:chapter-01-anchor-01' })
  assert.equal(production.calls.retry.length, 1)
  assert.equal(production.calls.retry[0].taskId, 'anchor:chapter-01-anchor-01')
  await assert.rejects(() => oneline.redo({ projectId: created.projectId, episodeId: created.episodeId }), /请指定要重做的镜头/)
})

test('授权动作必须显式确认', async t => {
  const { oneline } = await fixture(t)
  const created = await oneline.submit({ sourceText: SOURCE })
  await assert.rejects(
    () => oneline.authorize({ projectId: created.projectId, episodeId: created.episodeId }),
    /必须明确确认内容授权/,
  )
})

test('空输入直接拒绝', async t => {
  const { oneline } = await fixture(t)
  await assert.rejects(() => oneline.submit({}), /请给出一句话描述/)
  await assert.rejects(() => oneline.submit({ sourceText: '   ' }), /请给出一句话描述/)
})

test('聊天工具不得暴露授权与终审——模型不能自我批准', async () => {
  const host = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/presentation/dsh/studio-host.js')
  const source = await readFile(host, 'utf8')
  // handlers 表是模型唯一能调用的动作集合。
  const handlers = source.slice(source.indexOf('const handlers = {'), source.indexOf('const handler = handlers[input.action]'))
  assert.ok(handlers.includes('oneline_submit:'), '提交动作应当开放')
  assert.ok(handlers.includes('oneline_status:'), '查询动作应当开放')
  assert.ok(!handlers.includes('oneline_authorize'), '授权不得进入聊天工具动作表')
  assert.ok(!handlers.includes('oneline_approve'), '终审不得进入聊天工具动作表')
})
