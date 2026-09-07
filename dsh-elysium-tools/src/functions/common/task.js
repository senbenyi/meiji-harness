import { createHash, randomBytes } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, open, readFile, realpath, rename, stat, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { AsyncLocalStorage } from 'node:async_hooks'
import { codeVersion, inspectMedia, retryAdvice, traceDiagnostics } from './diagnostics.js'
import { dirname, extname, isAbsolute, join, relative } from 'node:path'

const PROJECT_ROOT = process.env.LLM_AI_MODEL_ROOT || '/root/autodl-tmp/project'
const ARTIFACTS_ROOT = process.env.ARTIFACTS_ROOT || '/root/autodl-fs/artifacts/projects'
const STATE_ROOT = process.env.ELYSIUM_TOOLS_STATE_ROOT || '/root/autodl-tmp/elysium-tools'
const IMAGE_SUFFIXES = new Set(['.jpg', '.jpeg', '.png', '.webp'])
const VIDEO_SUFFIXES = new Set(['.mp4', '.mov', '.mkv', '.webm'])
const AUDIO_SUFFIXES = new Set(['.wav', '.mp3', '.flac', '.m4a', '.ogg'])
const toolContext = new AsyncLocalStorage()
export const withToolContext = (name, input, run) => toolContext.run({ tool: name, input }, run)

async function readTrace(path) {
  const text = await readFile(path, 'utf8').catch(error => {
    if (error.code === 'ENOENT') return ''
    throw error
  })
  return text.split('\n').filter(Boolean).map(line => JSON.parse(line))
}

export const MODEL_TIMEOUTS = Object.freeze({
  image: 41 * 60 * 1000,
  video: 71 * 60 * 1000,
  longVideo: 151 * 60 * 1000,
  postprocess: 121 * 60 * 1000,
  workflow: 451 * 60 * 1000,
})

export class ModelTaskError extends Error {
  constructor(code, message, status = 500) {
    super(message)
    this.name = 'ModelTaskError'
    this.code = code
    this.status = status
  }
}

function now() {
  return new Date().toISOString()
}

function jobRoot(jobId) {
  return join(STATE_ROOT, 'jobs', jobId)
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.tmp`
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`)
  await rename(temporary, path)
}

async function sha256File(path) {
  const digest = createHash('sha256')
  for await (const chunk of createReadStream(path)) digest.update(chunk)
  return digest.digest('hex')
}

async function artifactPath(value, suffixes, field) {
  if (!isAbsolute(value || '')) throw new ModelTaskError('MODEL_INPUT_INVALID', `${field} 必须是绝对路径`, 422)
  const [root, path] = await Promise.all([realpath(ARTIFACTS_ROOT), realpath(value)])
  const child = relative(root, path)
  if (!child || child.startsWith('..') || isAbsolute(child)) {
    throw new ModelTaskError('MODEL_INPUT_INVALID', `${field} 必须位于 ${ARTIFACTS_ROOT}`, 422)
  }
  const info = await stat(path)
  if (!info.isFile() || info.size === 0 || !suffixes.has(extname(path).toLowerCase())) {
    throw new ModelTaskError('MODEL_INPUT_INVALID', `${field} 不是有效媒体文件`, 422)
  }
  return path
}

async function promptFile(jobId, name, value) {
  const text = String(value || '').trim()
  if (!text) throw new ModelTaskError('MODEL_INPUT_INVALID', `${name} 不能为空`, 422)
  const path = join(jobRoot(jobId), 'input', name)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${text}\n`)
  return path
}

async function promptListFile(jobId, name, value, maximum = 6) {
  if (!Array.isArray(value) || value.length < 1 || value.length > maximum ||
      value.some(item => typeof item !== 'string' || !item.trim())) {
    throw new ModelTaskError('MODEL_INPUT_INVALID', `${name} 必须包含非空提示词列表（最多 ${maximum} 条）`, 422)
  }
  const path = join(jobRoot(jobId), 'input', name)
  await writeJson(path, { prompts: value.map(item => String(item).trim()) })
  return path
}

async function runCommand(command, environment, logPath, signal, timeoutMs) {
  signal?.throwIfAborted()
  const script = await stat(command[1]).catch(error => {
    if (error.code === 'ENOENT') return null
    throw error
  })
  if (!script?.isFile()) {
    throw new ModelTaskError('MODEL_EXECUTOR_MISSING', `模型执行入口未部署：${command[1]}`)
  }
  await mkdir(dirname(logPath), { recursive: true })
  const log = await open(logPath, 'a')
  try {
    const child = spawn(command[0], command.slice(1), {
      cwd: PROJECT_ROOT,
      env: { ...process.env, ...environment },
      stdio: ['ignore', log.fd, log.fd],
    })
    await new Promise((resolveProcess, rejectProcess) => {
      let timedOut = false
      const timer = setTimeout(() => {
        timedOut = true
        child.kill('SIGTERM')
      }, timeoutMs)
      const abort = () => child.kill('SIGTERM')
      const cleanup = () => {
        clearTimeout(timer)
        signal?.removeEventListener('abort', abort)
      }
      signal?.addEventListener('abort', abort, { once: true })
      child.once('error', error => {
        cleanup()
        rejectProcess(error)
      })
      child.once('close', code => {
        cleanup()
        if (signal?.aborted) {
          rejectProcess(new ModelTaskError('MODEL_TASK_ABORTED', '模型任务已取消', 499))
        } else if (timedOut) {
          rejectProcess(new ModelTaskError('MODEL_GENERATION_TIMEOUT', '模型任务超时', 504))
        } else if (code !== 0) {
          rejectProcess(new ModelTaskError('MODEL_GENERATION_FAILED', `模型执行失败，退出码 ${code}；日志：${logPath}`))
        } else {
          resolveProcess()
        }
      })
    })
  } finally {
    await log.close()
  }
}

async function buildModelExecution(jobId, capability, params) {
  const endpointRoot = join(PROJECT_ROOT, 'scripts', 'endpoint')
  const projectId = `tool-${jobId}`
  const projectRoot = join(ARTIFACTS_ROOT, projectId)
  const environment = {
    PROJECT_ID: projectId,
    MVP_PROJECT_ID: projectId,
    ARTIFACTS_ROOT,
    COMFYUI_URL: process.env.COMFYUI_URL || 'http://127.0.0.1:6006',
  }

  if (capability === 'image-generate') {
    const prompt = String(params.prompt || '').trim()
    if (!prompt) throw new ModelTaskError('MODEL_INPUT_INVALID', 'prompt 不能为空', 422)
    return {
      command: ['bash', join(endpointRoot, 'generate_image.sh'), '--preset', params.preset, '--seed', String(params.seed), '--prompt', prompt],
      environment,
      output: join(projectRoot, 'assets', 'characters', 'img.png'),
    }
  }

  if (capability === 'video-concat') {
    if (!Array.isArray(params.video_paths) || params.video_paths.length < 2) {
      throw new ModelTaskError('MODEL_INPUT_INVALID', '合片至少需要两个按镜头顺序排列的 MP4 路径', 422)
    }
    const videos = []
    for (const path of params.video_paths) {
      if (typeof path !== 'string') throw new ModelTaskError('MODEL_INPUT_INVALID', 'video_paths 必须为 MP4 路径列表', 422)
      try {
        videos.push(await artifactPath(path, new Set(['.mp4']), 'video_paths'))
      } catch (error) {
        if (error.code === 'ENOENT') throw new ModelTaskError('MODEL_INPUT_INVALID', '合片输入文件不存在', 422)
        throw error
      }
    }
    const inputs = join(jobRoot(jobId), 'input', 'concat-inputs.json')
    await mkdir(dirname(inputs), { recursive: true })
    await writeJson(inputs, videos)
    const output = join(projectRoot, 'output', 'final.mp4')
    return {
      command: ['bash', join(endpointRoot, 'concat_video.sh'), '--inputs-file', inputs, '--output', output],
      environment,
      output,
    }
  }

  if (capability === 'video-generate-long') {
    if (!Array.isArray(params.prompts) || params.prompts.length < 2 ||
        !Number.isInteger(params.duration) || params.duration <= 15 || params.duration < params.prompts.length || params.duration > params.prompts.length * 15) {
      throw new ModelTaskError('MODEL_INPUT_INVALID', '长视频总时长必须超过 15 秒，提供至少 2 段提示词且每段不超过 15 秒', 422)
    }
    if (!['long_fast', 'long_standard', 'long_vertical_standard', 'long_vertical_preview'].includes(params.preset)) {
      throw new ModelTaskError('MODEL_INPUT_INVALID', '长视频 preset 无效；默认使用 long_vertical_preview，不支持旧的 long_mvp 档位', 422)
    }
    const image = await artifactPath(params.image_path, IMAGE_SUFFIXES, 'image_path')
    const prompts = await promptListFile(jobId, 'video-prompts.json', params.prompts, Infinity)
    return {
      command: [
        'bash', join(endpointRoot, 'generate_video_long.sh'), '--input', image,
        '--prompt-file', prompts, '--preset', params.preset, '--segments', String(params.prompts.length),
        '--seed', String(params.seed), '--run-id', jobId,
        '--duration', String(params.duration),
      ],
      environment,
      output: join(projectRoot, 'assets', 'shots', 'shot-01.mp4'),
    }
  }

  if (capability === 'video-generate') {
    if (!Number.isInteger(params.duration) || params.duration < 1 || params.duration > 15) {
      throw new ModelTaskError('MODEL_INPUT_INVALID', '短视频时长必须为 1..15 秒；超过 15 秒请使用 model_generate_video_long', 422)
    }
    const mode = String(params.mode || '').toLowerCase()
    const prompt = await promptFile(jobId, 'video-prompt.txt', params.prompt)
    if (!['text', 'image', 'reference'].includes(mode)) {
      throw new ModelTaskError('MODEL_INPUT_INVALID', 'mode 必须是 text、image 或 reference', 422)
    }
    const image = String(params.image_path || '').trim()
      ? await artifactPath(params.image_path, IMAGE_SUFFIXES, 'image_path') : null
    const video = String(params.video_path || '').trim()
      ? await artifactPath(params.video_path, VIDEO_SUFFIXES, 'video_path') : null
    const audio = String(params.audio_path || '').trim()
      ? await artifactPath(params.audio_path, AUDIO_SUFFIXES, 'audio_path') : null
    if (mode === 'text' && (image || video || audio)) {
      throw new ModelTaskError('MODEL_INPUT_INVALID', 'text 不接受参考媒体', 422)
    }
    if (mode === 'image' && (!image || video || audio)) {
      throw new ModelTaskError('MODEL_INPUT_INVALID', 'image 只接受且必须提供 image_path', 422)
    }
    if (mode === 'reference' && !image && !video && !audio) {
      throw new ModelTaskError('MODEL_INPUT_INVALID', 'reference 至少需要一个参考媒体', 422)
    }
    const output = join(projectRoot, 'output', 'video.mp4')
    const command = [
      'bash', join(endpointRoot, 'generate_video.sh'), '--mode', mode,
      '--prompt-file', prompt, '--output', output,
      '--run-id', jobId, '--seed', String(params.seed),
      '--duration', String(params.duration),
    ]
    if (image) command.push('--input', image)
    if (video) command.push('--video', video)
    if (audio) command.push('--audio', audio)
    return {
      command,
      environment: {
        ...environment,
        MINIMAX_H3_COMFYUI_URL: process.env.MINIMAX_H3_COMFYUI_URL || 'http://127.0.0.1:6016',
      },
      output,
    }
  }

  if (capability === 'dialogue-generate') {
    const text = await promptFile(jobId, 'dialogue.txt', params.text)
    const output = join(projectRoot, 'output', 'dialogue.mp3')
    return {
      command: ['bash', join(endpointRoot, 'generate_dialogue.sh'), '--text-file', text,
        '--language', params.language, '--seed', String(params.seed), '--output', output],
      environment,
      output,
    }
  }

  const outputRoot = join(projectRoot, 'output')
  await mkdir(outputRoot, { recursive: true })
  const video = await artifactPath(params.video_path, VIDEO_SUFFIXES, 'video_path')
  if (capability === 'video-interpolate') {
    const output = join(outputRoot, 'interpolated.mp4')
    return {
      command: ['bash', join(endpointRoot, 'interpolate_video.sh'), '--input', video, '--output', output, '--run-id', jobId, '--multiplier', String(params.multiplier)],
      environment,
      output,
    }
  }
  if (capability === 'video-upscale') {
    const output = join(outputRoot, 'upscaled.mp4')
    return {
      command: [
        'bash', join(endpointRoot, 'upscale_video.sh'), '--input', video, '--output', output,
        '--run-id', jobId, '--resolution', String(params.resolution),
        '--max-resolution', String(params.max_resolution), '--batch-size', String(params.batch_size),
      ],
      environment,
      output,
    }
  }
  if (capability === 'video-audio') {
    const output = join(outputRoot, 'with-audio.mp4')
    const command = [
      'bash', join(endpointRoot, 'generate_video_audio.sh'), '--input', video, '--output', output,
      '--run-id', jobId, '--steps', String(params.steps), '--seed', String(params.seed),
    ]
    if (String(params.prompt || '').trim()) command.push('--prompt', String(params.prompt).trim())
    return { command, environment, output }
  }
  throw new ModelTaskError('MODEL_CAPABILITY_UNKNOWN', `未注册模型能力：${capability}`, 400)
}

async function buildWorkflowExecution(jobId, params) {
  if (params.authorized_adults !== true) {
    throw new ModelTaskError('MODEL_INPUT_INVALID', '必须确认素材仅包含虚拟或已授权成年人', 422)
  }
  const imagePrompt = await promptFile(jobId, 'image-prompt.txt', params.image_prompt)
  const videoPrompts = await promptListFile(jobId, 'video-prompts.json', params.video_prompts)
  const command = [
    'bash', join(PROJECT_ROOT, 'scripts', 'workflow', 'adult_short_video.sh'),
    '--image-prompt-file', imagePrompt, '--video-prompt-file', videoPrompts,
    '--preset', params.preset, '--segments', String(params.video_prompts.length),
    '--seed', String(params.seed), '--run-id', jobId, '--confirm-authorized-adults',
  ]
  if (String(params.reference_path || '').trim()) {
    command.push('--reference', await artifactPath(params.reference_path, IMAGE_SUFFIXES, 'reference_path'))
  }
  if (String(params.audio_prompt || '').trim()) {
    command.push('--audio-prompt-file', await promptFile(jobId, 'audio-prompt.txt', params.audio_prompt))
  }
  if (String(params.dialogue || '').trim()) {
    command.push('--dialogue-file', await promptFile(jobId, 'dialogue.txt', params.dialogue))
  }
  const projectId = `production-${jobId}`
  return {
    command,
    environment: {
      MVP_PROJECT_ID: projectId,
      ARTIFACTS_ROOT,
      COMFYUI_URL: process.env.COMFYUI_URL || 'http://127.0.0.1:6006',
    },
    output: join(ARTIFACTS_ROOT, projectId, 'output', 'final.mp4'),
  }
}

async function execute(capability, params, signal, timeoutMs, workflow = false) {
  const jobId = randomBytes(16).toString('hex')
  const statusPath = join(jobRoot(jobId), 'status.json')
  const logPath = join(jobRoot(jobId), 'execution.log')
  const tracePath = join(jobRoot(jobId), 'trace.jsonl')
  const diagnosticPath = join(jobRoot(jobId), 'diagnostics.json')
  const started = performance.now()
  let phaseStarted = started
  const status = { job_id: jobId, capability, status: 'running', created_at: now(), started_at: now() }
  status.debug = JSON.parse(JSON.stringify({
    plugin: '@dsh-external/dsh-elysium-tools', ...toolContext.getStore(),
    effective_input: params, log_path: logPath, trace_path: tracePath, diagnostic_path: diagnosticPath, chain: [],
  }))
  status.trace_id = jobId
  status.parent_job_id = null // Workflow stages share this job; they are traced as spans, not invented child jobs.
  status.stage = 'prepare'
  status.timings = {}
  status.code_version = await codeVersion()
  if (workflow) status.workflow = 'adult-short-video'
  await writeJson(statusPath, status)
  try {
    const execution = workflow
      ? await buildWorkflowExecution(jobId, params)
      : await buildModelExecution(jobId, capability, params)
    execution.environment.MODEL_TRACE_FILE = tracePath
    execution.environment.MODEL_TRACE_ID = jobId
    status.debug.command = execution.command
    status.debug.expected_output = execution.output
    status.timings.prepare_ms = Math.round(performance.now() - phaseStarted)
    phaseStarted = performance.now()
    status.stage = 'execute'
    await writeJson(statusPath, status)
    await runCommand(execution.command, execution.environment, logPath, signal, timeoutMs)
    status.timings.execute_ms = Math.round(performance.now() - phaseStarted)
    phaseStarted = performance.now()
    status.stage = 'inspect-output'
    await writeJson(statusPath, status)
    status.debug.chain = await readTrace(tracePath)
    const outputInfo = await stat(execution.output).catch(error => {
      if (error.code === 'ENOENT') return null
      throw error
    })
    if (!outputInfo?.isFile() || outputInfo.size === 0) {
      throw new ModelTaskError('MODEL_OUTPUT_MISSING', `模型执行完成但没有有效输出文件：${execution.output}`)
    }
    status.status = 'succeeded'
    status.finished_at = now()
    status.result = {
      path: execution.output,
      size_bytes: outputInfo.size,
      sha256: await sha256File(execution.output),
    }
    const artifacts = status.debug.chain.filter(event => event.stage === 'comfyui-output')
    const outputPath = await realpath(execution.output)
    let primary
    for (const artifact of artifacts) {
      if (await realpath(artifact.local_path).catch(() => null) === outputPath) primary = artifact
    }
    status.result.comfyui_artifacts = artifacts
    status.result.comfyui_prompt_id = primary?.prompt_id ?? null
    status.result.comfyui_artifact_id = primary?.artifact_id ?? null
    status.result.comfyui_view_url = primary?.view_url ?? null
    status.result.comfyui_metadata_status = primary ? 'available' : workflow ? 'local-final-see-stage-artifacts' : 'not-reported-by-executor'
    status.debug.media_probe_path = join(jobRoot(jobId), 'media-probe.json')
    const inspection = await inspectMedia(execution.output, status.debug.media_probe_path)
    status.result.media_info = inspection.media_info
    status.result.validation = {
      file_exists: 'passed', nonempty: 'passed', media_probe: inspection.media_probe,
      full_decode: 'not_run', specification_match: 'not_run', human_review: 'not_run',
    }
    if (capability === 'video-concat') {
      const report = JSON.parse(await readFile(`${execution.output}.validation.json`, 'utf8'))
      if (report.validation?.full_decode !== 'passed' || report.validation?.specification_match !== 'passed') {
        throw new ModelTaskError('MODEL_OUTPUT_INVALID', '合片未通过解码与规格验证')
      }
      Object.assign(status.result.validation, report.validation)
      status.result.comfyui_metadata_status = 'not-applicable-local-concat'
    }
    const requested = status.debug.chain.findLast(item => item.stage === 'executor-config' && item.span_id === primary?.span_id)?.parameters
    if (inspection.media_info && requested?.width && requested?.height) {
      status.result.validation.specification_match = inspection.media_info.width === requested.width && inspection.media_info.height === requested.height ? 'passed' : 'failed'
    }
    status.result.warnings = inspection.warnings
    if (status.result.validation.specification_match === 'failed') status.result.warnings.push('OUTPUT_DIMENSIONS_MISMATCH')
    if (!primary && !workflow && capability !== 'video-concat') status.result.warnings.push('COMFYUI_METADATA_MISSING')
    if (primary?.url_scope === 'server-local') status.result.warnings.push('COMFYUI_URL_SERVER_LOCAL')
    status.stage = 'completed'
    status.timings.inspect_ms = Math.round(performance.now() - phaseStarted)
    status.timings.total_ms = Math.round(performance.now() - started)
    status.finished_at = now()
    Object.assign(status.debug, traceDiagnostics(status.debug.chain))
    await writeJson(diagnosticPath, status)
    await writeJson(statusPath, status)
    return completedResult(status)
  } catch (error) {
    const failure = error instanceof ModelTaskError ? error
      : new ModelTaskError('MODEL_GENERATION_FAILED', String(error?.message || error))
    status.status = 'failed'
    status.finished_at = now()
    status.error_code = failure.code
    status.error = failure.message.slice(0, 500)
    status.failed_stage = status.stage
    status.stage = 'failed'
    status.timings.failed_stage_ms = Math.round(performance.now() - phaseStarted)
    status.timings.total_ms = Math.round(performance.now() - started)
    status.debug.chain = await readTrace(tracePath).catch(() => status.debug.chain)
    Object.assign(status.debug, traceDiagnostics(status.debug.chain))
    Object.assign(status, retryAdvice(failure.code, status.debug.chain))
    await mkdir(dirname(logPath), { recursive: true })
    await writeFile(logPath, `\n[FAIL] ${status.error}\n`, { flag: 'a' })
    await writeJson(statusPath, status)
    await writeJson(diagnosticPath, status)
    failure.job_id = jobId
    failure.debug = status.debug
    failure.message = `${status.error}；job_id: ${jobId}；日志：${logPath}`
    throw failure
  }
}

export function runModelTask(capability, params, signal, timeoutMs) {
  return execute(capability, params, signal, timeoutMs)
}

export function runWorkflowTask(params, signal, timeoutMs) {
  return execute('workflow-adult-short-video', params, signal, timeoutMs, true)
}

export async function getJob(jobId) {
  if (!/^[0-9a-f]{32}$/.test(jobId || '')) throw new ModelTaskError('MODEL_JOB_NOT_FOUND', '任务不存在', 404)
  try {
    const job = JSON.parse(await readFile(join(jobRoot(jobId), 'status.json'), 'utf8'))
    if (job.status === 'running' && job.debug?.trace_path) {
      job.debug.chain = await readTrace(job.debug.trace_path).catch(() => job.debug.chain || [])
      Object.assign(job.debug, traceDiagnostics(job.debug.chain))
    }
    return job
  } catch (error) {
    if (error?.code === 'ENOENT') throw new ModelTaskError('MODEL_JOB_NOT_FOUND', '任务不存在', 404)
    throw error
  }
}

export function completedResult(job) {
  if (job.status !== 'succeeded' || !job.result) {
    throw new ModelTaskError('MODEL_JOB_NOT_READY', `任务尚未成功：${job.status}`, 409)
  }
  return { job_id: job.job_id, status: job.status, trace_id: job.trace_id, parent_job_id: job.parent_job_id,
    stage: job.stage, timings: job.timings, code_version: job.code_version, ...job.result, debug: job.debug }
}
