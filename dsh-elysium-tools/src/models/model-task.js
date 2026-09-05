import { createHash, randomBytes } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, open, readFile, realpath, rename, stat, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { dirname, extname, isAbsolute, join, relative } from 'node:path'

const PROJECT_ROOT = process.env.LLM_AI_MODEL_ROOT || '/root/autodl-tmp/project'
const ARTIFACTS_ROOT = process.env.ARTIFACTS_ROOT || '/root/autodl-fs/artifacts/projects'
const STATE_ROOT = process.env.ELYSIUM_TOOLS_STATE_ROOT || '/root/autodl-tmp/elysium-tools'
const IMAGE_SUFFIXES = new Set(['.jpg', '.jpeg', '.png', '.webp'])
const VIDEO_SUFFIXES = new Set(['.mp4', '.mov', '.mkv', '.webm'])

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

async function promptListFile(jobId, name, value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 6 ||
      value.some(item => !String(item || '').trim())) {
    throw new ModelTaskError('MODEL_INPUT_INVALID', `${name} 必须包含 1..6 条非空提示词`, 422)
  }
  const path = join(jobRoot(jobId), 'input', name)
  await writeJson(path, { prompts: value.map(item => String(item).trim()) })
  return path
}

async function runCommand(command, environment, logPath, signal, timeoutMs) {
  signal?.throwIfAborted()
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
    MVP_PROJECT_ID: projectId,
    ARTIFACTS_ROOT,
    COMFYUI_URL: process.env.COMFYUI_URL || 'http://127.0.0.1:6006',
  }

  if (capability === 'image-generate') {
    const prompt = String(params.prompt || '').trim()
    if (!prompt) throw new ModelTaskError('MODEL_INPUT_INVALID', 'prompt 不能为空', 422)
    return {
      command: ['bash', join(endpointRoot, 'generate_image.sh'), '--preset', params.preset, '--seed', String(params.seed), '--', prompt],
      environment,
      output: join(projectRoot, 'assets', 'characters', 'img.png'),
    }
  }

  if (capability === 'video-generate-long') {
    const image = await artifactPath(params.image_path, IMAGE_SUFFIXES, 'image_path')
    const prompts = await promptListFile(jobId, 'video-prompts.json', params.prompts)
    return {
      command: [
        'bash', join(endpointRoot, 'generate_video_long.sh'), '--input', image,
        '--prompt-file', prompts, '--preset', params.preset, '--segments', String(params.prompts.length),
        '--seed', String(params.seed), '--run-id', jobId,
      ],
      environment,
      output: join(projectRoot, 'assets', 'shots', 'shot-01.mp4'),
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
  const status = { job_id: jobId, capability, status: 'running', created_at: now(), started_at: now() }
  if (workflow) status.workflow = 'adult-short-video'
  await writeJson(statusPath, status)
  try {
    const execution = workflow
      ? await buildWorkflowExecution(jobId, params)
      : await buildModelExecution(jobId, capability, params)
    await runCommand(execution.command, execution.environment, join(jobRoot(jobId), 'execution.log'), signal, timeoutMs)
    const outputInfo = await stat(execution.output)
    if (!outputInfo.isFile() || outputInfo.size === 0) {
      throw new ModelTaskError('MODEL_OUTPUT_MISSING', '模型执行完成但没有有效输出文件')
    }
    status.status = 'succeeded'
    status.finished_at = now()
    status.result = {
      path: execution.output,
      size_bytes: outputInfo.size,
      sha256: await sha256File(execution.output),
    }
    await writeJson(statusPath, status)
    return completedResult(status)
  } catch (error) {
    status.status = 'failed'
    status.finished_at = now()
    status.error = String(error?.message || error).slice(0, 500)
    await writeJson(statusPath, status)
    if (error instanceof ModelTaskError) throw error
    throw new ModelTaskError('MODEL_GENERATION_FAILED', status.error)
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
    return JSON.parse(await readFile(join(jobRoot(jobId), 'status.json'), 'utf8'))
  } catch (error) {
    if (error?.code === 'ENOENT') throw new ModelTaskError('MODEL_JOB_NOT_FOUND', '任务不存在', 404)
    throw error
  }
}

export function completedResult(job) {
  if (job.status !== 'succeeded' || !job.result) {
    throw new ModelTaskError('MODEL_JOB_NOT_READY', `任务尚未成功：${job.status}`, 409)
  }
  return { job_id: job.job_id, status: job.status, ...job.result }
}
