import { join } from 'node:path'
import { modelRoutes } from '../../../../models/model-config.js'
import { feedbackOf } from '../../../../shared/review-feedback.js'
import { shotResults } from '../../../../shared/drama-model.js'
import { storyboardPromptText } from '../../../../shared/story-content.js'
import { shotReferenceImages } from '../../../../shared/reference-images.js'
import { aspectRatioOf } from '../../../../shared/project-rules.js'
import { gatewayVideoSize } from '../../../gateway/model-gateway.js'
import { insertSessionLog } from '../../../host/session-log.js'
import { writeFilm, formatFilmRequest } from '../../steps/shared/video-submit.js'
import { submitVideo } from '../../steps/step-submit-video.js'
import { generateVideo } from '../../steps/step-generate-video.js'
import { extractTailFrame } from '../../steps/step-extract-tail-frame.js'
import { videoReady } from '../../steps/shared/film-freshness.js'
import { checkContext } from '../../../runtime/operation-context.js'
export async function runVideo(context) {
  const shot = context.project.shots.items.find(item => item.id === context.operation.track)
  return context.operation.parts === 'tail' || !context.operation.parts && videoReady(shot) ? opTailFrame(context) : opFilm(context)
}

// if (operation.action === 'tail-frame')
export async function opTailFrame(c) {
  let { operation, deps, home, projects, project, trace } = c
  const track = operation.track, clip = project.shots.items.find(s => s.id === track)?.video.content
  if (clip?.status !== 'ready' || !clip.file) throw new Error('本镜视频尚未完成')
  await extractTailFrame({ projects, project, track, file: clip.file, directory: join(home, 'storages', 'meiji', 'projects', project.id, 'films', project.episodeId || ''), home, deps })
  return trace
}

// if (operation.action === 'film')
export async function opFilm(c) {
  let { operation, deps, home, projects, models, project, trace, note } = c
  if (feedbackOf(project, `storyboard:${operation.track}`).check.passed === false || feedbackOf(project, 'storyboard').check.passed === false) throw Object.assign(new Error('文本分镜自检未通过，请先修正'), { status: 409 })
  const track = String(operation.track || '')
  const item = shotResults(project, 'storyboard').find(entry => entry.id === track)
  if (!item || !/^S[0-9]{2,}$/.test(track)) throw Object.assign(new Error('请在对应镜头上提交这一条成片'), { status: 400 })
  if (!storyboardPromptText(item).trim()) throw Object.assign(new Error('请先生成这一镜的分镜'), { status: 409 })
  const route = (modelRoutes(await models.read())).video
  const images = item.video === 'text' ? [] : shotReferenceImages(project, item)
  try {
    const size = aspectRatioOf(project.aspectRatio)
    const { queued, payload } = await submitVideo({ project, item, track, home, projects, route, deps, size, images })
    const shot = queued.shots[0]
    await writeFilm(projects, project.id, track, { status: 'running', terminal: false, promptId: shot.promptId, request: { mode: payload.mode, prompt: payload.prompt, referenceImages: payload.referenceImages || [], continuityReference: payload.continuityReference || null }, assetIds: images.map(image => image.assetId).filter(Boolean), error: null })
    note('已执行：提交成片')
    note('文件：server/flow/steps/step-submit-video.js')
    note('函数：submitH3')
    note(`${track}，时长 ${shot.duration} 秒`)
    note(payload.note)
    note(formatFilmRequest({ model: 'elysium-video', seconds: shot.duration, mode: payload.mode, size: gatewayVideoSize(size), prompt: payload.prompt, referenceImages: payload.referenceImages, inputReference: payload.mode === 'first_frame' ? payload.note : '' }).join('\n'))
    note('视频还在生成。完成后出现在这一张镜头卡片上。')
    deps.defer((async () => {
      let saved
      try {
        saved = await generateVideo({ queued, shot, projects, project, track, home, deps })
      } catch (error) {
        // 取消后仍如实记录失败原因（远端任务可能仍在运行），不受晚到正文拦截。
        await checkContext.run({ ...checkContext.getStore(), settling: true }, () => writeFilm(projects, project.id, track, { status: 'error', terminal: error.code === 'VIDEO_TASK_TERMINAL', error: error.message || '成片生成失败' })).catch(() => {})
        throw error
      }
      if (operation.runVideoOnly) return
      insertSessionLog(deps.session, `${track} 成片已生成，正在提取尾帧`)
      await extractTailFrame({ projects, project, track, file: saved.file, directory: saved.directory, home, deps })
      insertSessionLog(deps.session, `${track} 尾帧已提取`)
    })().catch(async error => {
      insertSessionLog(deps.session, error.message || '成片生成失败', true)
      throw error
    }))
    return trace
  } catch (error) {
    await projects.save(project.id, {}, { final: true, error: error.message }).catch(() => {})
    throw error
  }
}
