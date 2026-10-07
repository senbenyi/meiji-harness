import test from 'node:test'
import assert from 'node:assert/strict'
import { bundledProductionPipelineCompiler } from '../../lib/production/pipeline-compiler.js'

test('pipeline compiler materializes persisted tasks from the bundled manifest', () => {
  const compiler = bundledProductionPipelineCompiler()
  const task = compiler.task('episode-script', { id: 'run:ep-1', scopeId: 'ep-1', label: 'episode-script:ep-1', dependencies: ['plan'] })
  assert.deepEqual(task, {
    id: 'run:ep-1', kind: 'novel-text', scopeId: 'ep-1', dependencies: ['plan'],
    input: {
      pipelineId: 'novel-to-drama-text', pipelineVersion: 5, pipelineNodeId: 'episode-script',
      role: 'script', label: 'episode-script:ep-1', phase: '分集剧本',
    },
  })
})

test('pipeline compiler supplies prompt policy, output schema, retry and concurrency', () => {
  const compiler = bundledProductionPipelineCompiler()
  const request = compiler.request('source-summary', { label: 'source-summary:0', prompt: '原文片段' })
  assert.equal(request.role, 'story')
  assert.equal(request.phase, '故事分析')
  assert.equal(request.pipelineNodeId, 'source-summary')
  assert.deepEqual(request.retry, { maxAttempts: 2, timeoutMs: 300000, retryOn: ['timeout', 'invalid-output', 'retryable-error'] })
  assert.equal(request.schema.required.includes('citations'), true)
  assert.equal(JSON.stringify(request.schema).includes('$ref'), false)
  assert.match(request.prompt, /目标：提取当前原文区间/)
  assert.match(request.prompt, /引用不得超出当前原文区间/)
  assert.deepEqual(compiler.batches('source-summary', [1, 2, 3, 4]), [[1, 2, 3], [4]])

  const episodePlan = compiler.request('episode-plan', { label: 'episode-plan', prompt: '完整原文范围 0..100' })
  assert.equal(episodePlan.role, 'script')
  assert.match(episodePlan.prompt, /标题、空白和过渡文字并入相邻集/)
  assert.match(episodePlan.prompt, /分集 id 与 order 必须唯一/)
})

test('pipeline compiler executes proposal commits declared by agent and barrier nodes', async () => {
  const compiler = bundledProductionPipelineCompiler()
  const submitted = []
  const submit = async (kind, payload, pipeline) => { submitted.push([kind, payload, pipeline]); return { proposalId: kind } }
  assert.deepEqual(await compiler.commit('story-reconcile', { summary: 'story' }, submit), { proposalId: 'content_analysis' })
  assert.deepEqual(await compiler.commit('asset-commit', { characters: [] }, submit), { proposalId: 'asset_extraction' })
  assert.deepEqual(submitted, [
    ['content_analysis', { summary: 'story' }, { pipelineId: 'novel-to-drama-text', pipelineVersion: 5, pipelineNodeId: 'story-reconcile' }],
    ['asset_extraction', { characters: [] }, { pipelineId: 'novel-to-drama-text', pipelineVersion: 5, pipelineNodeId: 'asset-commit' }],
  ])
})
