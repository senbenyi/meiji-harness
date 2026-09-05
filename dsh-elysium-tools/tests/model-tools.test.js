import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import {
  createModelAddVideoAudioTool,
  createModelEditImageTool,
  createModelGenerateImageTool,
  createModelGenerateLongVideoTool,
  createModelGenerateVideoTool,
  createModelInterpolateVideoTool,
  createModelJobResultTool,
  createModelJobStatusTool,
  createModelTools,
  createModelUpscaleVideoTool,
  createWorkflowImageToFinalVideoTool,
  createWorkflowTools,
} from '../src/index.js'

const JOB_ID = 'a'.repeat(32)
const COMPLETED_JOB = {
  job_id: JOB_ID,
  status: 'succeeded',
  result: {
    path: `/root/autodl-fs/artifacts/projects/api-${JOB_ID}/output.bin`,
    size_bytes: 123,
    sha256: 'b'.repeat(64),
  },
}

async function executeCompleted(tool, args) {
  const originalFetch = globalThis.fetch
  const calls = []
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url, options })
    if (calls.length === 1) return new Response(JSON.stringify({ job_id: JOB_ID, status: 'queued' }), { status: 202 })
    return new Response(JSON.stringify(COMPLETED_JOB))
  }
  try {
    const result = await tool.execute(args, {})
    return { calls, result }
  } finally {
    globalThis.fetch = originalFetch
  }
}

test('registers the model and workflow tools declared by the manifest', async () => {
  const expected = [
    'model_generate_image',
    'model_edit_image',
    'model_generate_video',
    'model_generate_long_video',
    'model_interpolate_video',
    'model_upscale_video',
    'model_add_video_audio',
    'model_job_status',
    'model_job_result',
    'workflow_image_to_final_video',
  ]
  const manifest = JSON.parse(await readFile(new URL('../dsh.plugin.json', import.meta.url), 'utf8'))
  assert.deepEqual(
    [...createModelTools(), ...createWorkflowTools()].map(tool => tool.name),
    expected,
  )
  assert.deepEqual(manifest.contributes.tools, expected)
})

test('model_generate_image maps JSON parameters and waits for completion', async () => {
  const { calls, result } = await executeCompleted(
    createModelGenerateImageTool(),
    { prompt: ' cinematic portrait ', preset: 'standard', seed: 7 },
  )
  assert.equal(calls[0].url, 'http://127.0.0.1:8010/v1/images/generations')
  assert.deepEqual(JSON.parse(calls[0].options.body), { prompt: 'cinematic portrait', preset: 'standard', seed: 7 })
  assert.equal(calls[1].url, `http://127.0.0.1:8010/v1/jobs/${JOB_ID}`)
  assert.equal(result.path, COMPLETED_JOB.result.path)
})

test('multipart model tools map to their Model API endpoints', async t => {
  const cases = [
    {
      tool: createModelEditImageTool(),
      args: { operation: 'remake', image_path: '/artifacts/input.png', prompt: 'new image', seed: 8 },
      endpoint: '/images/edits',
      fields: { operation: 'remake', image_path: '/artifacts/input.png', prompt: 'new image', seed: '8' },
    },
    {
      tool: createModelGenerateVideoTool(),
      args: { image_path: '/artifacts/input.png', prompt: 'move', preset: 'fast', seed: 9 },
      endpoint: '/videos/generations',
      fields: { image_path: '/artifacts/input.png', prompt: 'move', preset: 'fast', seed: '9' },
    },
    {
      tool: createModelGenerateLongVideoTool(),
      args: { image_path: '/artifacts/input.png', previous_video_path: '/artifacts/previous.mp4' },
      endpoint: '/videos/long-generations',
      fields: { image_path: '/artifacts/input.png', previous_video_path: '/artifacts/previous.mp4' },
    },
    {
      tool: createModelInterpolateVideoTool(),
      args: { video_path: '/artifacts/input.mp4', multiplier: 4 },
      endpoint: '/videos/interpolations',
      fields: { video_path: '/artifacts/input.mp4', multiplier: '4' },
    },
    {
      tool: createModelUpscaleVideoTool(),
      args: { video_path: '/artifacts/input.mp4', resolution: 1080, max_resolution: 1920, batch_size: 9 },
      endpoint: '/videos/upscales',
      fields: { video_path: '/artifacts/input.mp4', resolution: '1080', max_resolution: '1920', batch_size: '9' },
    },
    {
      tool: createModelAddVideoAudioTool(),
      args: { video_path: '/artifacts/input.mp4', prompt: 'rain', steps: 30, seed: 10 },
      endpoint: '/videos/audio-generations',
      fields: { video_path: '/artifacts/input.mp4', prompt: 'rain', steps: '30', seed: '10' },
    },
  ]

  for (const item of cases) {
    await t.test(item.tool.name, async () => {
      const { calls } = await executeCompleted(item.tool, item.args)
      assert.equal(calls[0].url, `http://127.0.0.1:8010/v1${item.endpoint}`)
      assert.deepEqual(Object.fromEntries(calls[0].options.body.entries()), item.fields)
    })
  }
})

test('model_job_status returns the raw persisted status', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async url => {
    assert.equal(url, `http://127.0.0.1:8010/v1/jobs/${JOB_ID}`)
    return new Response(JSON.stringify({ job_id: JOB_ID, status: 'running', started_at: 'now' }))
  }
  try {
    const value = await createModelJobStatusTool().execute({ job_id: JOB_ID }, {})
    assert.equal(value.status, 'running')
    assert.equal(value.started_at, 'now')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('model_job_result returns normalized metadata for a successful job', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => new Response(JSON.stringify(COMPLETED_JOB))
  try {
    const value = await createModelJobResultTool().execute({ job_id: JOB_ID }, {})
    assert.deepEqual(value, {
      job_id: JOB_ID,
      status: 'succeeded',
      path: COMPLETED_JOB.result.path,
      size_bytes: 123,
      sha256: 'b'.repeat(64),
      result_url: `/v1/jobs/${JOB_ID}/result`,
    })
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('failed jobs surface the Model API error', async () => {
  const originalFetch = globalThis.fetch
  let calls = 0
  globalThis.fetch = async () => {
    calls += 1
    if (calls === 1) return new Response(JSON.stringify({ job_id: JOB_ID, status: 'queued' }), { status: 202 })
    return new Response(JSON.stringify({ job_id: JOB_ID, status: 'failed', error: '输出未通过健康闸门' }))
  }
  try {
    await assert.rejects(
      createModelGenerateImageTool().execute({ prompt: 'test' }, {}),
      error => error.code === 'MODEL_GENERATION_FAILED' && /健康闸门/.test(error.message),
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('workflow_image_to_final_video maps one request and waits for the final artifact', async () => {
  const { calls, result } = await executeCompleted(
    createWorkflowImageToFinalVideoTool(),
    {
      image_path: '/artifacts/input.png',
      video_prompt: 'slow camera push',
      audio_prompt: 'rain and footsteps',
      preset: 'standard',
      seed: 11,
    },
  )
  assert.equal(calls[0].url, 'http://127.0.0.1:8010/v1/workflows/image-to-final-video/runs')
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    image_path: '/artifacts/input.png',
    video_prompt: 'slow camera push',
    audio_prompt: 'rain and footsteps',
    preset: 'standard',
    seed: 11,
  })
  assert.equal(calls[1].url, `http://127.0.0.1:8010/v1/jobs/${JOB_ID}`)
  assert.equal(result.path, COMPLETED_JOB.result.path)
})
