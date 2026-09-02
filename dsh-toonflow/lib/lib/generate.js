import { projectGet } from './project.js'
import { registerGeneratedAsset } from './assets.js'
import { updateCharacterRecord, updateShotRecord } from './shot.js'
import { ToonflowError, resolveProjectFile } from './store.js'

const GENERATE_TOOL = '_dsh_external_dsh_comfyui_generate'
const JOB_TOOL = '_dsh_external_dsh_comfyui_job'

const DEFAULT_MODELS = {
  characterImage: { template: 'anima-txt2img', args: { width: 768, height: 1024 } },
  shotImage: { template: 'anima-txt2img', args: { width: 1280, height: 720 } },
  shotVideo: { template: '', args: {} },
}

function modelConfig(config, key) {
  const configured = config.models?.[key] || {}
  const fallback = DEFAULT_MODELS[key]
  return {
    template: String(configured.template ?? fallback.template ?? '').trim(),
    args: configured.args && typeof configured.args === 'object' && !Array.isArray(configured.args)
      ? { ...fallback.args, ...configured.args }
      : { ...fallback.args },
    useReferenceImage: configured.useReferenceImage === true,
  }
}

function parseToolResult(value) {
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value)
  } catch {
    throw new ToonflowError('COMFYUI_INVALID_RESPONSE', 'dsh-comfyui returned invalid JSON', 502)
  }
}

async function callTool(ctx, name, args) {
  const tool = ctx.tools?.get?.(name)
  if (!tool) {
    throw new ToonflowError(
      'COMFYUI_UNAVAILABLE',
      'dsh-comfyui is not enabled in the current DSH profile',
      503,
    )
  }
  const controller = new AbortController()
  const result = parseToolResult(await tool.execute(args, { signal: controller.signal }))
  if (!result?.ok) {
    throw new ToonflowError(result?.code || 'COMFYUI_ERROR', result?.message || 'ComfyUI request failed', 502)
  }
  return result
}

function firstOutput(result, kind) {
  const output = result.outputs?.find(item => !kind || item.kind === kind) || result.outputs?.[0]
  if (!output?.path) throw new ToonflowError('NO_OUTPUT', `ComfyUI returned no ${kind} output`, 502)
  return output.path
}

function errorMessage(error) {
  return error?.message || String(error)
}

function characterPrompt(character) {
  return String(character.imagePrompt || character.description || character.name || '').trim()
}

function shotPrompt(shot, key) {
  return String(shot[key] || [shot.description, shot.camera].filter(Boolean).join(', ')).trim()
}

export function createGenerationService(ctx, config) {
  const monitors = new Map()
  const submissions = new Set()
  let disposed = false

  async function monitor(key, jobId, kind, complete, fail) {
    if (monitors.has(key)) return monitors.get(key)
    const running = (async () => {
      try {
        while (!disposed) {
          const result = await callTool(ctx, JOB_TOOL, { job_id: jobId, action: 'wait', wait_s: 5 })
          if (result.status === 'running') continue
          await complete(firstOutput(result, kind))
          return
        }
      } catch (error) {
        if (!disposed) await fail(errorMessage(error))
      } finally {
        monitors.delete(key)
      }
    })()
    monitors.set(key, running)
    return running
  }

  async function submitCharacter(projectId, characterId) {
    const pending = await updateCharacterRecord(config, projectId, characterId, character => ({
      ...character,
      imageStatus: 'image_queued',
      imageJobId: null,
    }))
    const character = pending.character
    const submissionKey = `character:${projectId}:${characterId}`
    submissions.add(submissionKey)
    try {
      const model = modelConfig(config, 'characterImage')
      if (!model.template) throw new ToonflowError('MODEL_NOT_CONFIGURED', 'Character image template is not configured')
      const result = await callTool(ctx, GENERATE_TOOL, {
        ...model.args,
        template: model.template,
        prompt: characterPrompt(character),
        wait_s: 0,
      })
      const queued = await updateCharacterRecord(config, projectId, characterId, current => ({
        ...current,
        imageStatus: 'image_queued',
        imageJobId: result.job_id,
        lastError: null,
      }))
      void monitor(
        `character:${projectId}:${characterId}`,
        result.job_id,
        'image',
        async outputPath => {
          const imagePath = await registerGeneratedAsset(config, {
            projectId, scope: 'characters', entityId: characterId, kind: 'image', outputPath,
          })
          await updateCharacterRecord(config, projectId, characterId, current => ({
            ...current, imagePath, imageStatus: 'image_ready', lastError: null,
          }))
        },
        message => updateCharacterRecord(config, projectId, characterId, current => ({
          ...current, imageStatus: 'failed', lastError: message,
        })),
      )
      return queued
    } catch (error) {
      await updateCharacterRecord(config, projectId, characterId, current => ({
        ...current, imageStatus: 'failed', lastError: errorMessage(error),
      }))
      throw error
    } finally {
      submissions.delete(submissionKey)
    }
  }

  async function referenceImage(projectId, shot, model) {
    if (!model.useReferenceImage) return undefined
    const data = await projectGet(config, { projectId })
    const linkedCharacter = data.characters.find(character =>
      shot.characterIds?.includes(character.id) && character.imagePath,
    )
    const candidate = shot.referenceImages?.[0] || linkedCharacter?.imagePath
    if (!candidate) return undefined
    return resolveProjectFile(config, projectId, candidate)
  }

  async function submitShot(projectId, shotId, stage, { retry = false } = {}) {
    const queuedStatus = stage === 'video' ? 'video_queued' : 'image_queued'
    const readyStatus = stage === 'video' ? 'video_ready' : 'image_ready'
    const jobField = stage === 'video' ? 'videoJobId' : 'imageJobId'
    const pathField = stage === 'video' ? 'videoPath' : 'imagePath'
    const modelKey = stage === 'video' ? 'shotVideo' : 'shotImage'
    const pending = await updateShotRecord(config, projectId, shotId, shot => {
      if (retry && stage !== 'video' && (shot.retryCount || 0) >= 3) throw new ToonflowError('RETRY_LIMIT', 'Shot retry limit reached')
      if (stage === 'video' && !shot.imagePath) throw new ToonflowError('IMAGE_REQUIRED', 'Generate the first frame before video')
      return {
        ...shot,
        status: queuedStatus,
        [jobField]: null,
        failedStage: null,
        retryCount: retry ? (shot.retryCount || 0) + 1 : (shot.retryCount || 0),
      }
    })
    const shot = pending.shot
    const submissionKey = `shot:${projectId}:${shotId}:${stage}`
    submissions.add(submissionKey)
    try {
      const model = modelConfig(config, modelKey)
      if (!model.template) throw new ToonflowError('MODEL_NOT_CONFIGURED', `${stage === 'video' ? 'Video' : 'Shot image'} template is not configured`)
      const image = stage === 'video'
        ? await resolveProjectFile(config, projectId, shot.imagePath)
        : await referenceImage(projectId, shot, model)
      const result = await callTool(ctx, GENERATE_TOOL, {
        ...model.args,
        template: model.template,
        prompt: shotPrompt(shot, stage === 'video' ? 'videoPrompt' : 'imagePrompt'),
        ...(image ? { image } : {}),
        wait_s: 0,
      })
      const queued = await updateShotRecord(config, projectId, shotId, current => ({
        ...current, status: queuedStatus, [jobField]: result.job_id, lastError: null,
      }))
      void monitor(
        `shot:${projectId}:${shotId}:${stage}`,
        result.job_id,
        stage,
        async outputPath => {
          const assetPath = await registerGeneratedAsset(config, {
            projectId, scope: 'shots', entityId: shotId, kind: stage, outputPath,
          })
          await updateShotRecord(config, projectId, shotId, current => ({
            ...current, status: readyStatus, [pathField]: assetPath, failedStage: null, lastError: null,
          }))
        },
        message => updateShotRecord(config, projectId, shotId, current => ({
          ...current, status: 'failed', failedStage: stage, lastError: message,
        })),
      )
      return queued
    } catch (error) {
      await updateShotRecord(config, projectId, shotId, current => ({
        ...current, status: 'failed', failedStage: stage, lastError: errorMessage(error),
      }))
      throw error
    } finally {
      submissions.delete(submissionKey)
    }
  }

  async function reconcile(projectId) {
    const data = await projectGet(config, { projectId })
    for (const character of data.characters) {
      if (character.imageStatus !== 'image_queued') continue
      if (!character.imageJobId) {
        if (submissions.has(`character:${projectId}:${character.id}`)) continue
        await updateCharacterRecord(config, projectId, character.id, current => ({
          ...current,
          imageStatus: 'failed',
          lastError: current.lastError || 'Generation was interrupted before a job was created',
        }))
        continue
      }
      void monitor(
        `character:${projectId}:${character.id}`,
        character.imageJobId,
        'image',
        async outputPath => {
          const imagePath = await registerGeneratedAsset(config, {
            projectId, scope: 'characters', entityId: character.id, kind: 'image', outputPath,
          })
          await updateCharacterRecord(config, projectId, character.id, current => ({
            ...current, imagePath, imageStatus: 'image_ready', lastError: null,
          }))
        },
        message => updateCharacterRecord(config, projectId, character.id, current => ({
          ...current, imageStatus: 'failed', lastError: message,
        })),
      )
    }
    for (const shot of data.shots) {
      const stage = shot.status === 'video_queued' ? 'video' : shot.status === 'image_queued' ? 'image' : null
      const jobId = stage === 'video' ? shot.videoJobId : shot.imageJobId
      if (!stage) continue
      if (!jobId) {
        if (submissions.has(`shot:${projectId}:${shot.id}:${stage}`)) continue
        await updateShotRecord(config, projectId, shot.id, current => ({
          ...current,
          status: 'failed',
          failedStage: stage,
          lastError: current.lastError || 'Generation was interrupted before a job was created',
        }))
        continue
      }
      void monitor(
        `shot:${projectId}:${shot.id}:${stage}`,
        jobId,
        stage,
        async outputPath => {
          const assetPath = await registerGeneratedAsset(config, {
            projectId, scope: 'shots', entityId: shot.id, kind: stage, outputPath,
          })
          await updateShotRecord(config, projectId, shot.id, current => ({
            ...current,
            status: stage === 'video' ? 'video_ready' : 'image_ready',
            [stage === 'video' ? 'videoPath' : 'imagePath']: assetPath,
            failedStage: null,
            lastError: null,
          }))
        },
        message => updateShotRecord(config, projectId, shot.id, current => ({
          ...current, status: 'failed', failedStage: stage, lastError: message,
        })),
      )
    }
    return data
  }

  return {
    submitCharacter,
    submitShotImage: (projectId, shotId) => submitShot(projectId, shotId, 'image'),
    submitShotVideo: (projectId, shotId) => submitShot(projectId, shotId, 'video'),
    retryShot: async (projectId, shotId) => {
      const data = await projectGet(config, { projectId })
      const shot = data.shots.find(item => item.id === shotId)
      if (!shot) throw new ToonflowError('SHOT_NOT_FOUND', `Shot not found: ${shotId}`, 404)
      if (shot.status !== 'failed' || !['image', 'video'].includes(shot.failedStage)) {
        throw new ToonflowError('NOT_RETRYABLE', 'Shot is not in a retryable failed state')
      }
      return submitShot(projectId, shotId, shot.failedStage, { retry: true })
    },
    batchStatus: async projectId => {
      await reconcile(projectId)
      return projectGet(config, { projectId })
    },
    dispose() { disposed = true },
  }
}
