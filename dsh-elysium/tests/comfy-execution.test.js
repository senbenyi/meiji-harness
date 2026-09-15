import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { prepareComfyWorkflow } from '../src/comfyui/execution.js'
import { readJson, saveJson } from '../src/business/jobs/store.js'

test('recovery keeps an old API snapshot without rebuilding or requiring a visual workflow', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'comfy-snapshot-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const saved = { plan: { duration: 1, prompts: ['original prompt'] }, graph: { original: {} },
    workflowName: 'workflow_generate_video', server_url: 'https://runpod.test/' }
  await saveJson(join(directory, 'comfyui-workflow.json'), saved)
  const client = { url: new URL(saved.server_url), validate: () => assert.fail('must not revalidate a submitted graph') }
  const prepare = () => assert.fail('must not rebuild from new templates or reupload inputs')
  assert.deepEqual(await prepareComfyWorkflow(directory, client, saved.plan, prepare), saved)
  assert.equal(await readJson(join(directory, 'comfyui-workflow-ui.json')), null)
  await assert.rejects(prepareComfyWorkflow(directory, client, { ...saved.plan, duration: 2 }, prepare), /恢复请求或后端/)
  await assert.rejects(prepareComfyWorkflow(directory, { ...client, url: new URL('https://other-runpod.test/') }, saved.plan, prepare), /恢复请求或后端/)
  assert.deepEqual(await readJson(join(directory, 'comfyui-workflow.json')), saved)
})

test('failed execution retains the original node history and prompt identity', async t => {
  const { ComfyClient } = await import('../src/comfyui/client.js')
  const { runComfyWorkflow } = await import('../src/comfyui/execution.js')
  const directory = await mkdtemp(join(tmpdir(), 'comfy-failed-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const history = { status: { completed: false, status_str: 'error', messages: [
    ['execution_error', { node_id: 's0_decode_video', exception_message: 'decoder failed' }],
  ] }, outputs: {} }
  const client = new ComfyClient('https://runpod.test')
  client.request = async route => {
    if (route === 'prompt') return { prompt_id: 'original' }
    assert.equal(route, 'history/original')
    return { original: history }
  }
  const status = { job_id: 'job' }
  await assert.rejects(runComfyWorkflow(directory, client, { graph: {}, workflowName: 'workflow_generate_video' }, status, 1000), { code: 'COMFYUI_EXECUTION_FAILED' })
  assert.deepEqual(await readJson(join(directory, 'comfyui-history.json')), history)
  assert.equal((await readJson(join(directory, 'status.json'))).comfyui_prompt_id, 'original')
  assert.equal((await readJson(join(directory, 'comfyui-submission.json'))).prompt_id, 'original')
})
