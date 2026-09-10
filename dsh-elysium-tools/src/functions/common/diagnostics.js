import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

const hash = bytes => createHash('sha256').update(bytes).digest('hex')

export async function codeVersion() {
  const pkg = JSON.parse(await readFile(new URL('../../../package.json', import.meta.url), 'utf8'))
  // Keep this explicit list aligned with every workflows/jobs module that participates in execution.
  const names = ['tool.js', 'diagnostics.js', '../comfyui/client.js', '../../config.js',
    ...['contracts.js', 'create.js', 'json.js', 'launch.js', 'launch-lock.py', 'query.js', 'wait.js',
      'comfy-submission.js', 'call-index.js', 'worker-owner.js'].map(name => `../../jobs/${name}`),
    '../../media/probe.js', '../../media/http-media.js',
    ...['comfy-execution', 'video-plan', 'media-plan', 'video-jobs', 'media-jobs', 'video-worker',
      'video-graph', 'media-graph', 'video-execution', 'media-execution', 'video-workflow',
      'video-artifacts', 'media-artifacts', 'video-plan-file', 'character', 'workflow-generate-video',
      'index'].map(name => `../../workflows/${name}.js`),
    ...['workflow_generate_video', 'workflow_director_video', 'workflow_generate_image',
      'workflow_generate_image_reference', 'workflow_concat_video'].map(name => `../../workflows/templates/${name}.json`)]
  const sources = await Promise.all(names.map(name => readFile(new URL(name, import.meta.url))))
  return { plugin_version: pkg.version, executor_sha256: hash(Buffer.concat(sources)) }
}

export function summarizeMedia(probe) {
  const video = probe.streams?.find(stream => stream.codec_type === 'video')
  const audio = probe.streams?.find(stream => stream.codec_type === 'audio')
  const gcd = (a, b) => b ? gcd(b, a % b) : a
  const width = Number(video?.width) || null
  const height = Number(video?.height) || null
  const ratio = video?.avg_frame_rate || video?.r_frame_rate
  const [n, d] = String(ratio || '').split('/').map(Number)
  return {
    format: probe.format?.format_name ?? null, width, height,
    aspect_ratio: width && height ? `${width / gcd(width, height)}:${height / gcd(width, height)}` : null,
    duration_seconds: Number(probe.format?.duration) || null,
    frame_rate: d && Number.isFinite(n / d) ? n / d : null,
    video_codec: video?.codec_name ?? null, audio_codec: audio?.codec_name ?? null,
    has_audio: Boolean(audio), sample_rate: Number(audio?.sample_rate) || null,
    channels: audio?.channels ?? null,
  }
}

export function traceDiagnostics(chain) {
  const spans = new Map()
  for (const item of chain) {
    if (!item.span_id || !item.timestamp) continue
    const time = Date.parse(item.timestamp)
    if (!Number.isFinite(time)) continue
    if (!spans.has(item.span_id)) spans.set(item.span_id, { span_id: item.span_id, capability: item.capability, start: time, end: time })
    spans.get(item.span_id).end = time
  }
  return {
    stage_timings: [...spans.values()].map(({ span_id, capability, start, end }) => ({
      span_id, capability, recorded_duration_ms: Math.max(0, end - start),
    })),
    resolved_config: chain.filter(item => item.stage === 'route' || item.stage === 'executor-config'),
    comfyui_status: chain.filter(item => item.stage === 'comfyui-status'),
    node_errors: chain.flatMap(item => item.node_errors || []),
  }
}
