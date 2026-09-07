import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { publishVideo } from '../src/workflows/video-publication.js'
import { renderToolDebug } from '../src/functions/common/tool.js'
import { jobSummary } from '../src/http/media-jobs.js'

test('publish final movie for ComfyUI and expose one URL without server paths; reuse on later reads', async () => {
  const root = await mkdtemp(join(tmpdir(), 'video-publication-'))
  try {
    const path = join(root, 'final.mp4'), content = 'validated final movie'
    await writeFile(path, content)
    const job = { job_id: 'a'.repeat(32), capability: 'workflow-video', status: 'succeeded',
      result: { path, size_bytes: Buffer.byteLength(content), sha256: createHash('sha256').update(content).digest('hex') } }
    const options = { artifactsRoot: root, outputRoot: join(root, 'comfy-output'), publicUrl: 'http://127.0.0.1:6016/' }
    await publishVideo(job, options)
    const url = new URL(job.result.comfyui_view_url)
    assert.equal(url.origin, 'http://127.0.0.1:6016')
    assert.equal(url.pathname, '/view')
    assert.equal(url.searchParams.get('type'), 'output')
    const target = join(options.outputRoot, url.searchParams.get('subfolder'), url.searchParams.get('filename'))
    assert.equal(await readFile(target, 'utf8'), content)
    const before = await stat(target)
    await publishVideo(job, options)
    assert.equal((await stat(target)).mtimeMs, before.mtimeMs)
    const rendered = JSON.parse(renderToolDebug({}, { ...job, ...job.result, debug: { log_path: '/private/log' } })[0].text)
    assert.equal(rendered.comfyui_view_url, url.href)
    assert.equal(rendered.path, undefined)
    assert.equal(rendered.log_path, undefined)
    assert.equal(JSON.parse(renderToolDebug({}, job)[0].text).comfyui_view_url, url.href)
    assert.equal(JSON.parse(renderToolDebug({}, job)[0].text).path, undefined)
    assert.equal(jobSummary(job).comfyui_view_url, url.href)
    await assert.rejects(publishVideo({ ...job, job_id: '../escape' }, options), /identity/)
    await assert.rejects(publishVideo({ ...job, result: { ...job.result, size_bytes: 1 } }, options), /size/)
  } finally { await rm(root, { recursive: true, force: true }) }
})
