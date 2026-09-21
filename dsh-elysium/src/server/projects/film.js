// 职责：复用已完成镜头，按分镜顺序合成并登记一部项目成片。
import { createHash } from 'node:crypto'
import { execFile, spawn } from 'node:child_process'
import { Readable } from 'node:stream'
import { promisify } from 'node:util'
import { join } from 'node:path'
import { readdir } from '../../database/files.js'
import { projectsRoot } from '../../database/paths.js'
import { readJson } from '../../database/json.js'
import { connectBackend, getJob, jobSummary, localMediaInput, saveFilmJob, saveMedia, withLaunchLock } from '../../worker/index.js'
import { validProjectId } from '../../database/schemas/projects.js'
import { statusError } from '../../utils/errors.js'

const invalid = message => statusError(409, message)
const run = promisify(execFile)

async function filmInput(projectId, jobId) {
  const job = await getJob(jobId), summary = jobSummary(job)
  if (job.project_id !== projectId || !summary.has_video) throw invalid('镜头视频尚不可用，请先完成全部镜头')
  if (job.result?.local_media_path) return `file:${await localMediaInput(job)}`
  const target = new URL(job.result.comfyui_view_url)
  if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password) throw invalid('镜头媒体地址无效')
  if (job.server) {
    const original = new URL(job.server.base_url.replace(/\/?$/, '/'))
    if (target.origin !== original.origin || target.pathname !== new URL('view', original).pathname) throw invalid('镜头媒体与原任务服务器不一致')
    await connectBackend(job.server)
  }
  return target.href
}

function concatList(inputs) {
  return inputs.map(input => `file '${input.replaceAll("'", "'\\''")}'\n`).join('')
}

export async function composeFilm(store, id) {
  if (!validProjectId(id)) throw statusError(400, '项目 ID 无效')
  const project = await store.read(id), shots = project.acts.flatMap(act => act.shots)
  if (!shots.length || shots.some(shot => shot.status !== 'succeeded' || !shot.job_id)) throw invalid('请先完成全部镜头')
  const jobIds = shots.map(shot => shot.job_id)
  const filmId = createHash('sha256').update(JSON.stringify([id, jobIds])).digest('hex').slice(0, 32)
  if (project.deliverables.some(item => item.job_id === filmId)) return project
  const inputs = []
  for (const jobId of jobIds) inputs.push(await filmInput(id, jobId))
  const ffmpeg = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-protocol_whitelist', 'file,pipe,http,https,tcp,tls,crypto', '-i', 'pipe:0',
    '-map', '0:v:0', '-map', '0:a?', '-c', 'copy', '-movflags', '+frag_keyframe+empty_moov', '-f', 'mp4', 'pipe:1'], { stdio: ['pipe', 'pipe', 'pipe'] })
  ffmpeg.stdin.on('error', () => {})
  ffmpeg.stderr.resume()
  const complete = new Promise((resolve, reject) => {
    ffmpeg.once('error', error => reject(statusError(503, error.code === 'ENOENT' ? '本机未安装 FFmpeg' : '无法启动成片合成')))
    ffmpeg.once('close', code => code === 0 ? resolve() : reject(statusError(502, '成片合成失败，请检查镜头媒体或编码')))
  })
  // FFmpeg may exit while its stdout is still draining; attach the handler before saveMedia awaits completion.
  complete.catch(() => {})
  ffmpeg.stdin.end(concatList(inputs))
  try {
    const result = await saveMedia(id, filmId, Readable.toWeb(ffmpeg.stdout), { extension: '.mp4', kind: 'video', complete })
    await saveFilmJob(id, filmId, result)
    return store.addFilm(id, jobIds, { type: 'film', label: `${project.title} 成片`, job_id: filmId, created_at: Date.now() })
  } catch (error) {
    ffmpeg.kill()
    throw error
  }
}

export async function composeEpisodeFilm(store, id, episode) {
  if (!validProjectId(id) || !Number.isInteger(episode) || episode < 1 || episode > 100) throw statusError(400, '项目或集数无效')
  const project = await store.readEpisode(id, episode), shots = project.acts.flatMap(act => act.shots)
  if (!shots.length || shots.some(shot => shot.status !== 'succeeded' || !shot.job_id)) throw invalid('请先完成本集全部镜头')
  const jobIds = shots.map(shot => shot.job_id)
  const filmId = createHash('sha256').update(JSON.stringify([id, episode, jobIds])).digest('hex').slice(0, 32)
  if (project.deliverables.some(item => item.job_id === filmId)) return project
  const inputs = []
  for (const jobId of jobIds) {
    const job = await getJob(jobId), summary = jobSummary(job)
    if (job.project_id !== id || !summary.has_video || !job.result?.local_media_path) throw invalid('本集镜头视频尚未保存在本地')
    inputs.push(await localMediaInput(job))
  }
  let size
  try {
    const { stdout } = await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=s=x:p=0', inputs[0]])
    size = /^\d+x\d+$/.test(stdout.trim()) ? stdout.trim() : null
  } catch { throw statusError(502, '无法读取本集首镜分辨率') }
  if (!size) throw statusError(502, '本集首镜分辨率无效')
  const [width, height] = size.split('x').map(Number)
  const ffmpeg = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-protocol_whitelist', 'file,pipe', '-i', 'pipe:0',
    '-map', '0:v:0', '-map', '0:a:0', '-vf', `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,fps=24,format=yuv420p`,
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-ac', '2',
    '-movflags', '+frag_keyframe+empty_moov', '-f', 'mp4', 'pipe:1'], { stdio: ['pipe', 'pipe', 'pipe'] })
  ffmpeg.stdin.on('error', () => {})
  ffmpeg.stderr.resume()
  const complete = new Promise((resolve, reject) => {
    ffmpeg.once('error', error => reject(statusError(503, error.code === 'ENOENT' ? '本机未安装 FFmpeg' : '无法启动成片合成')))
    ffmpeg.once('close', code => code === 0 ? resolve() : reject(statusError(502, '本集合成失败，请检查镜头编码与音轨')))
  })
  complete.catch(() => {})
  ffmpeg.stdin.end(concatList(inputs.map(input => `file:${input}`)))
  try {
    const result = await saveMedia(id, filmId, Readable.toWeb(ffmpeg.stdout), { extension: '.mp4', kind: 'video', complete })
    await saveFilmJob(id, filmId, result)
    return store.addEpisodeFilm(id, episode, jobIds, { type: 'film', label: `${project.title} 第 ${episode} 集`, job_id: filmId, created_at: Date.now() })
  } catch (error) {
    ffmpeg.kill()
    throw error
  }
}

export function createFilmDriver(store, logger = console) {
  const active = new Set()
  return async () => {
    const projects = await readdir(projectsRoot(), { withFileTypes: true }).catch(error => { if (error.code === 'ENOENT') return []; throw error })
    let pending = false
    for (const project of projects) {
      if (!project.isDirectory() || !validProjectId(project.name)) continue
      const episodes = await readdir(join(projectsRoot(), project.name, 'episodes'), { withFileTypes: true }).catch(error => { if (error.code === 'ENOENT') return []; throw error })
      for (const entry of episodes) {
        const episode = Number(entry.name)
        if (!entry.isDirectory() || !Number.isInteger(episode) || episode < 1 || episode > 100) continue
        const directory = join(projectsRoot(), project.name, 'episodes', entry.name)
        const task = await readJson(join(directory, 'film-task.json'))
        if (!task || !['pending', 'running'].includes(task.status)) continue
        pending = true
        if (active.size) continue
        active.add(directory)
        withLaunchLock(directory, async () => {
          const latest = await store.readEpisode(project.name, episode), current = latest.film_task
          if (current?.task_id !== task.task_id || !['pending', 'running'].includes(current.status)) return
          if (JSON.stringify(latest.acts.flatMap(act => act.shots.map(shot => shot.job_id))) !== JSON.stringify(task.job_ids)) {
            await store.updateEpisodeFilmTask(project.name, episode, task.task_id, { status: 'failed', error: '剧集分镜已变化，请重新提交合成' })
            return
          }
          await store.updateEpisodeFilmTask(project.name, episode, task.task_id, { status: 'running' })
          try {
            await composeEpisodeFilm(store, project.name, episode)
            await store.updateEpisodeFilmTask(project.name, episode, task.task_id, { status: 'succeeded' })
          } catch (error) {
            await store.updateEpisodeFilmTask(project.name, episode, task.task_id, { status: 'failed', error: error.message })
            logger?.error?.(`[elysium] film ${task.task_id}: ${error.message}`)
          }
        }).catch(error => { if (error.code !== 'WORKFLOW_RECOVERY_REQUIRED') logger?.error?.(`[elysium] film driver: ${error.message}`) })
          .finally(() => active.delete(directory))
      }
    }
    return { active: pending || active.size > 0 }
  }
}
