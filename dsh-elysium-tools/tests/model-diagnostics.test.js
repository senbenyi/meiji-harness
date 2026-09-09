import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { inspectMedia, summarizeMedia, traceDiagnostics } from '../src/functions/common/diagnostics.js'

test('media dimensions are measured and never relabeled as 9:16', () => {
  const result = summarizeMedia({ format: { format_name: 'mov,mp4', duration: '5.2' }, streams: [
    { codec_type: 'video', codec_name: 'h264', width: 832, height: 1216, avg_frame_rate: '24000/1001' },
    { codec_type: 'audio', codec_name: 'aac', sample_rate: '44100', channels: 2 },
  ] })
  assert.equal(result.aspect_ratio, '13:19')
  assert.equal(result.duration_seconds, 5.2)
  assert.equal(result.frame_rate, 24000 / 1001)
  assert.equal(result.has_audio, true)
})

test('unavailable probe is not reported as validation passed', async () => {
  const root = await mkdtemp(join(tmpdir(), 'media-probe-'))
  const previous = process.env.FFPROBE_BIN
  try {
    process.env.FFPROBE_BIN = join(root, 'missing-ffprobe')
    const report = join(root, 'probe.json')
    const result = await inspectMedia(join(root, 'not-media.mp4'), report)
    assert.equal(result.media_probe, 'not_run')
    assert.equal(result.media_info, null)
    assert.ok(result.warnings.includes('FFPROBE_UNAVAILABLE'))
    assert.equal(JSON.parse(await readFile(report, 'utf8')).code, 'ENOENT')
  } finally {
    if (previous === undefined) delete process.env.FFPROBE_BIN
    else process.env.FFPROBE_BIN = previous
    await rm(root, { recursive: true, force: true })
  }
})

test('stage timing preserves existing prompt evidence', () => {
  const chain = [
    { stage: 'route', span_id: 's1', capability: 'text-to-video', timestamp: '2026-09-06T00:00:00Z' },
    { stage: 'comfyui-status', span_id: 's1', prompt_id: 'p1', timestamp: '2026-09-06T00:00:03Z', node_errors: [{ node_id: '7' }] },
  ]
  assert.equal(traceDiagnostics(chain).stage_timings[0].recorded_duration_ms, 3000)
  assert.deepEqual(traceDiagnostics(chain).node_errors, [{ node_id: '7' }])
})
