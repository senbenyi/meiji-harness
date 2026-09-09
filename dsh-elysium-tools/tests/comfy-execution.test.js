import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { prepareComfyWorkflow } from '../src/workflows/comfy-execution.js'
import { readJson, saveJson } from '../src/jobs/json.js'

test('recovery keeps an old API snapshot without rebuilding or requiring a visual workflow', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'comfy-snapshot-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const saved = { plan: { duration: 1, prompts: ['original prompt'] }, graph: { original: {} },
    workflowName: 'workflow_generate_video', server_url: 'http://localhost:6016/' }
  await saveJson(join(directory, 'comfyui-workflow.json'), saved)
  const client = { url: new URL(saved.server_url), validate: () => assert.fail('must not revalidate a submitted graph') }
  const prepare = () => assert.fail('must not rebuild from new templates or reupload inputs')
  assert.deepEqual(await prepareComfyWorkflow(directory, client, saved.plan, prepare), saved)
  assert.equal(await readJson(join(directory, 'comfyui-workflow-ui.json')), null)
  await assert.rejects(prepareComfyWorkflow(directory, client, { ...saved.plan, duration: 2 }, prepare), /恢复请求或后端/)
  await assert.rejects(prepareComfyWorkflow(directory, { ...client, url: new URL('http://localhost:6017/') }, saved.plan, prepare), /恢复请求或后端/)
  assert.deepEqual(await readJson(join(directory, 'comfyui-workflow.json')), saved)
})
