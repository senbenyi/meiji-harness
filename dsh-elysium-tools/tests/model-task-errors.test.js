import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = await realpath(await mkdtemp(join(tmpdir(), 'model-errors-')))
after(() => rm(root, { recursive: true, force: true }))
process.env.LLM_AI_MODEL_ROOT = root
process.env.ARTIFACTS_ROOT = join(root, 'artifacts')
process.env.ELYSIUM_TOOLS_STATE_ROOT = join(root, 'state')
const { createModelTools, getJob } = await import('../src/index.js')
const tool = createModelTools().find(item => item.name === 'model_generate_image')

for (const [label, script, code] of [
  ['missing endpoint', null, 'MODEL_EXECUTOR_MISSING'],
  ['successful command without output', 'exit 0\n', 'MODEL_OUTPUT_MISSING'],
  ['failed command', 'echo execution-error >&2\nexit 3\n', 'MODEL_GENERATION_FAILED'],
]) {
  test(`${label} returns a queryable failed job and log`, async () => {
    if (script !== null) {
      await mkdir(join(root, 'scripts/endpoint'), { recursive: true })
      await writeFile(join(root, 'scripts/endpoint/generate_image.sh'), script)
    }
    let failure
    await assert.rejects(tool.execute({ prompt: 'a paper boat' }), error => {
      failure = error
      return error.code === code
    })
    assert.match(failure.job_id, /^[0-9a-f]{32}$/)
    assert.ok(failure.message.includes(failure.job_id))
    const job = await getJob(failure.job_id)
    assert.equal(job.status, 'failed')
    assert.equal(job.error_code, code)
    assert.equal(job.result, undefined)
    const statusTool = createModelTools().find(item => item.name === 'model_job_status')
    assert.ok(statusTool.output.render({}, job)[0].text.includes(code))
    const log = await readFile(join(root, 'state/jobs', failure.job_id, 'execution.log'), 'utf8')
    assert.ok(log.includes(job.error))
  })
}
