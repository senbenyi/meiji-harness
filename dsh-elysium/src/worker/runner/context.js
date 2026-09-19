// 职责：为 worker 进程内的一次执行创建 TaskContext，把状态、媒体与参考图能力注入模型层。
import { jobRoot } from '../store/paths.js'
import { failStatus, saveStatus, startStatus, succeedStatus } from '../store/status.js'
import { closeLocalMedia, openLocalMedia, readLocalMedia, saveMedia } from '../store/media.js'
import { codeVersion } from '../results/diagnostics.js'
import { ModelTaskError } from '../../utils/errors.js'
import { getJob } from './inspect.js'

const invalid = message => new ModelTaskError('MODEL_INPUT_INVALID', message, 422)

export function createTaskContext(projectId, jobId, { signal, provider } = {}) {
  const directory = jobRoot(jobId)
  return {
    jobId, projectId, directory, signal,
    start: async fields => startStatus(directory, { job_id: jobId, project_id: projectId, ...fields, code_version: await codeVersion(provider) }),
    save: status => saveStatus(directory, status),
    succeed: (status, result) => succeedStatus(directory, status, result),
    fail: (status, error, options) => failStatus(directory, status, error, options),
    saveMedia: (body, options) => saveMedia(projectId, jobId, body, options),
    imageReference,
  }
}

// 'job:<id>' 引用转为已完成图片的 data URI；其他引用由平台自行校验。
async function imageReference(value) {
  if (!value.startsWith('job:')) return value
  const job = await getJob(value.slice(4))
  if (job.status !== 'succeeded' || job.result?.media_kind !== 'image') throw invalid('参考素材必须是已完成图片')
  const media = await openLocalMedia(job)
  try {
    if (media.size > 20 * 1024 * 1024) throw invalid('本地参考图片最多20 MB')
    return `data:${media.contentType};base64,${(await readLocalMedia(media)).toString('base64')}`
  } finally { await closeLocalMedia(media) }
}
