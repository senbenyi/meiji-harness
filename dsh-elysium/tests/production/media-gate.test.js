import test from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { CONTRACT, CONTRACT_HASH } from '../../src/domain/media-gate-contract.js'
import { evaluateMedia } from '../../src/domain/media-gate.js'
import { probeMedia } from '../../src/infrastructure/media/probe.js'
import { artifactKinds, gateArtifact, receiptPathFor } from '../../src/application/media-gate-service.js'
import { contractHash } from '../../scripts/sync-media-gate-contract.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
// 契约定义源与样本集都在并列签出的 llm-ai-model 仓；独立安装时这些测试跳过。
const sourceContract = path.resolve(root, '../../llm-ai-model/contracts/media-gate-contract.json')
const fixtures = path.resolve(root, '../../llm-ai-model/tests/fixtures/media-gate')
const media = path.join(fixtures, 'media')
const config = { ffmpeg: 'ffmpeg', ffprobe: 'ffprobe' }

const samplesReady = fs.existsSync(media) && fs.readdirSync(media).length > 0

test('内联契约与自身 hash 自洽', () => {
  assert.equal(contractHash(CONTRACT), CONTRACT_HASH)
})

test('内联契约未与定义源发生漂移', { skip: !fs.existsSync(sourceContract) && '缺少并列的 llm-ai-model 仓' }, () => {
  const source = JSON.parse(fs.readFileSync(sourceContract, 'utf8'))
  assert.equal(contractHash(source), CONTRACT_HASH,
    '契约已在 llm-ai-model 侧变更，请运行 node scripts/sync-media-gate-contract.mjs 重新同步')
})

test('每个样本的判定与期望一致（与模型侧共用同一套样本）', { skip: !samplesReady && '样本缺失，先运行 llm-ai-model/tests/fixtures/media-gate/generate.sh' }, async t => {
  const expectations = JSON.parse(fs.readFileSync(path.join(fixtures, 'expectations.json'), 'utf8'))
  for (const sample of expectations.samples) {
    await t.test(sample.file, async () => {
      const kinds = sample.kind
      const technical = evaluateMedia(await probeMedia(config, path.join(media, sample.file), kinds), kinds, sample.request || null)
      const reported = technical.failures.map(item => item.ruleId)
      assert.equal(technical.pass ? 'pass' : 'fail', sample.verdict, `实际失败规则：${reported.join(', ')}`)
      for (const ruleId of sample.mustReportFailures) {
        assert.ok(reported.includes(ruleId), `少报了必须命中的规则 ${ruleId}`)
      }
    })
  }
})

test('全黑图不得放行——假成功的核心案例', { skip: !samplesReady && '样本缺失' }, async () => {
  const file = path.join(media, 'image-black.png')
  assert.ok(fs.statSync(file).size > 0, '样本非空，旧闸门会放行')
  const technical = evaluateMedia(await probeMedia(config, file, ['image']), ['image'])
  assert.equal(technical.pass, false)
})

test('合法暗场不得被误杀', { skip: !samplesReady && '样本缺失' }, async () => {
  const technical = evaluateMedia(await probeMedia(config, path.join(media, 'image-dark-valid.png'), ['image']), ['image'])
  assert.equal(technical.pass, true, JSON.stringify(technical.failures))
})

test('gateArtifact 通过时落 receipt 并带 outputHash', { skip: !samplesReady && '样本缺失' }, async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'elysium-gate-'))
  const file = path.join(workspace, 'ok.png')
  fs.copyFileSync(path.join(media, 'image-normal.png'), file)
  const receipt = await gateArtifact(config, file, ['image'], { taskId: 'anchor:a-1', inputHash: 'hash-1', attempt: 2 })
  assert.equal(receipt.qc.technical.pass, true)
  assert.equal(receipt.producedBy, 'plugin-local')
  assert.equal(receipt.taskId, 'anchor:a-1')
  assert.equal(receipt.attempt, 2)
  assert.match(receipt.outputHash, /^[a-f0-9]{64}$/)
  assert.equal(receipt.contractVersion, CONTRACT.contractVersion)
  assert.ok(fs.existsSync(receiptPathFor(file)))
  fs.rmSync(workspace, { recursive: true, force: true })
})

test('gateArtifact 失败时抛 QC_GATE_FAILED，且仍落 receipt 供重试参考', { skip: !samplesReady && '样本缺失' }, async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'elysium-gate-'))
  const file = path.join(workspace, 'black.png')
  fs.copyFileSync(path.join(media, 'image-black.png'), file)
  await assert.rejects(
    () => gateArtifact(config, file, ['image'], { taskId: 'anchor:a-2' }),
    error => {
      assert.equal(error.code, 'QC_GATE_FAILED')
      assert.match(error.message, /image\.not-flat|image\.not-dark/)
      return true
    },
  )
  const receipt = JSON.parse(fs.readFileSync(receiptPathFor(file), 'utf8'))
  assert.equal(receipt.qc.technical.pass, false)
  assert.ok(receipt.qc.technical.failures.length > 0)
  for (const failure of receipt.qc.technical.failures) assert.ok(failure.ruleId)
  fs.rmSync(workspace, { recursive: true, force: true })
})

test('每种任务类型都声明了产物媒体类型', () => {
  for (const type of ['asset', 'start_frame', 'keyframe', 'chapter', 'final', 'audio']) {
    assert.ok(artifactKinds(type).length > 0)
  }
  assert.throws(() => artifactKinds('unknown'), /未知任务类型/)
})
