import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, mkdtemp, readFile, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const run = promisify(execFile)
const root = await realpath(await mkdtemp(join(tmpdir(), 'concat-tools-')))
const artifacts = join(root, 'artifacts')
await mkdir(artifacts)
process.env.LLM_AI_MODEL_ROOT = process.env.TEST_MODEL_ROOT || fileURLToPath(new URL('../../../llm-ai-model', import.meta.url))
process.env.ARTIFACTS_ROOT = artifacts
process.env.ELYSIUM_TOOLS_STATE_ROOT = join(root, 'state')
after(() => rm(root, { recursive: true, force: true }))
const { runModelTask } = await import('../src/index.js')
// Legacy CLI compatibility is checked separately from the native plugin workflow.
const tool = { execute: args => runModelTask('video-concat', args, undefined, 60000) }
let available = true
try {
  await run('ffmpeg', ['-version'])
  await run('ffprobe', ['-version'])
} catch { available = false }

async function clip(name, color, size = '64x64', audio = true) {
  const path = join(artifacts, name)
  await run('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', `color=c=${color}:s=${size}:r=24:d=1`,
    ...(audio ? ['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=1'] : []),
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', ...(audio ? ['-c:a', 'aac'] : []), path])
  return path
}

test('12 existing clips reach the real endpoint and return one validated movie in input order', { skip: !available }, async () => {
  const red = await clip("red ' clip.mp4", 'red')
  const blue = await clip('blue.mp4', 'blue')
  const paths = Array.from({ length: 12 }, (_, i) => i % 2 ? blue : red)
  const result = await tool.execute({ video_paths: paths })
  assert.equal(result.status, 'succeeded')
  assert.match(result.path, /output\/final.mp4$/)
  assert.equal(result.validation.full_decode, 'passed')
  assert.equal(result.validation.specification_match, 'passed')
  assert.equal(result.media_info.has_audio, true)
  assert.ok(Math.abs(result.media_info.duration_seconds - 12) < 0.5)
  assert.equal(result.warnings.includes('COMFYUI_METADATA_MISSING'), false)
  const report = JSON.parse(await readFile(`${result.path}.validation.json`, 'utf8'))
  assert.deepEqual(report.inputs, paths)
  const { stdout } = await run('ffmpeg', ['-v', 'error', '-i', result.path, '-vf', "select='eq(n,0)+eq(n,24)',scale=1:1",
    '-vsync', '0', '-frames:v', '2', '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-'], { encoding: 'buffer' })
  assert.ok(stdout[0] > stdout[2], 'first segment is red')
  assert.ok(stdout[5] > stdout[3], 'second segment is blue')
  await assert.rejects(run('bash', [join(process.env.LLM_AI_MODEL_ROOT, 'scripts/endpoint/concat_video.sh'),
    '--inputs-file', join(root, 'state/jobs', result.job_id, 'input/concat-inputs.json'), '--output', result.path]), /不能覆盖素材/)
})

test('incompatible clip dimensions fail instead of returning an invalid movie', { skip: !available }, async () => {
  const a = await clip('small.mp4', 'red')
  const b = await clip('wide.mp4', 'blue', '128x64')
  await assert.rejects(tool.execute({ video_paths: [a, b] }), { code: 'MODEL_GENERATION_FAILED' })
})

test('silent clips concatenate without inventing an audio track', { skip: !available }, async () => {
  const a = await clip('silent.mp4', 'red', '64x64', false)
  const result = await tool.execute({ video_paths: [a, a] })
  assert.equal(result.media_info.has_audio, false)
  assert.equal(result.validation.full_decode, 'passed')
})

test('invalid or missing input lists are rejected before execution', async () => {
  for (const video_paths of [undefined, [], ['one.mp4'], ['/tmp/outside.mp4', '/tmp/outside.mp4']]) {
    await assert.rejects(tool.execute({ video_paths }), { code: 'MODEL_INPUT_INVALID' })
  }
})
