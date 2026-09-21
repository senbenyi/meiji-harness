// 职责：按分镜顺序把本集本地镜头合成为带字幕、响度统一的成片，并登记成片与 SRT。
import { createHash } from 'node:crypto'
import { execFile, spawn } from 'node:child_process'
import { Readable } from 'node:stream'
import { promisify } from 'node:util'
import { join } from 'node:path'
import { readdir } from '../../database/files.js'
import { projectsRoot } from '../../database/paths.js'
import { getJob, jobSummary, localMediaInput, saveFilmJob, saveMedia, withLaunchLock } from '../../worker/index.js'
import { validEpisode, validProjectId } from '../../database/schemas/projects.js'
import { statusError } from '../../utils/errors.js'

const invalid = message => statusError(409, message)
const run = promisify(execFile)
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 32)
const clock = seconds => {
  const ms = Math.round(seconds * 1000), part = (value, width = 2) => String(value).padStart(width, '0')
  return `${part(Math.floor(ms / 3600000))}:${part(Math.floor(ms / 60000) % 60)}:${part(Math.floor(ms / 1000) % 60)},${part(ms % 1000, 3)}`
}

function concatList(inputs) {
  return inputs.map(input => `file '${`file:${input}`.replaceAll("'", "'\\''")}'\n`).join('')
}

async function probe(input, entries) {
  try { return (await run('ffprobe', ['-v', 'error', ...entries, '-of', 'csv=s=x:p=0', input])).stdout.trim() }
  catch { throw statusError(502, '无法读取本集镜头媒体信息') }
}

// 各镜按实际时长累计；镜内多句对白按字数比例分配时间。
export function subtitleText(shots, durations) {
  const cues = []
  let start = 0
  for (const [index, shot] of shots.entries()) {
    const lines = shot.lines.flatMap(item => { const match = /^(.+?)（.+?）：(.+)$/.exec(item.text.trim()); return match ? [{ role: match[1], text: match[2] }] : [] }), total = lines.reduce((sum, line) => sum + [...line.text].length, 0)
    let cursor = start
    for (const line of lines) {
      const end = cursor + durations[index] * [...line.text].length / total
      cues.push(`${cues.length + 1}\n${clock(cursor)} --> ${clock(end)}\n${line.text.trim()}\n`)
      cursor = end
    }
    start += durations[index]
  }
  return cues.join('\n')
}

export async function composeEpisodeFilm(store, id, episode) {
  if (!validProjectId(id) || !validEpisode(episode)) throw statusError(400, '项目或集数无效')
  const project = await store.readEpisode(id, episode), shots = project.shots
  if (!shots.length || shots.some(shot => shot.status !== 'succeeded' || !shot.job_id)) throw invalid('请先完成本集全部镜头')
  const jobIds = shots.map(shot => shot.job_id), filmId = hash([id, episode, jobIds]), subtitleId = hash([filmId, 'srt'])
  if (project.film?.job_id === filmId) return project
  const inputs = []
  for (const shot of shots) {
    const job = await getJob(shot.job_id)
    if (job.project_id !== id || !jobSummary(job).has_video || !job.result?.local_media_path) throw invalid(`镜头 ${shot.id} 缺少本地文件，请重拍该镜`)
    inputs.push(await localMediaInput(job))
  }
  const size = await probe(inputs[0], ['-select_streams', 'v:0', '-show_entries', 'stream=width,height'])
  if (!/^\d+x\d+$/.test(size)) throw statusError(502, '本集首镜分辨率无效')
  const [width, height] = size.split('x').map(Number)
  const durations = []
  for (const input of inputs) durations.push(Number(await probe(input, ['-show_entries', 'format=duration'])))
  if (durations.some(value => !Number.isFinite(value) || value <= 0)) throw statusError(502, '本集镜头时长无效')
  const label = `第 ${episode} 集${project.series?.episodes[episode - 1] ? ` · ${project.series.episodes[episode - 1].title}` : ''}`
  const srt = subtitleText(shots, durations)
  let filters = `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,fps=24,format=yuv420p`
  if (srt) {
    const saved = await saveMedia(id, subtitleId, Readable.toWeb(Readable.from([Buffer.from(srt)])), { extension: '.srt', kind: 'file' })
    await saveFilmJob(id, subtitleId, saved)
    const path = join(projectsRoot(), id, saved.local_media_path)
    // 数据目录路径不含滤镜语法字符时才可直接写入，避免多层转义。
    if (/[\\':,;=[\]]/.test(path)) throw statusError(500, '数据目录路径包含字幕滤镜不支持的字符')
    filters += `,subtitles=filename=${path}:force_style='FontName=PingFang SC,FontSize=14,Outline=1,MarginV=24'`
  }
  const ffmpeg = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-protocol_whitelist', 'file,pipe', '-i', 'pipe:0',
    '-map', '0:v:0', '-map', '0:a:0', '-vf', filters, '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-ac', '2',
    '-movflags', '+frag_keyframe+empty_moov', '-f', 'mp4', 'pipe:1'], { stdio: ['pipe', 'pipe', 'pipe'] })
  ffmpeg.stdin.on('error', () => {})
  ffmpeg.stderr.resume()
  const complete = new Promise((resolve, reject) => {
    ffmpeg.once('error', error => reject(statusError(503, error.code === 'ENOENT' ? '本机未安装 FFmpeg' : '无法启动成片合成')))
    ffmpeg.once('close', code => code === 0 ? resolve() : reject(statusError(502, '本集合成失败，请检查镜头编码与音轨')))
  })
  // FFmpeg may exit while its stdout is still draining; attach the handler before saveMedia awaits completion.
  complete.catch(() => {})
  ffmpeg.stdin.end(concatList(inputs))
  try {
    const result = await saveMedia(id, filmId, Readable.toWeb(ffmpeg.stdout), { extension: '.mp4', kind: 'video', complete })
    await saveFilmJob(id, filmId, result)
    const now = Date.now(), total = Math.round(durations.reduce((sum, value) => sum + value, 0) * 100) / 100
    return store.addEpisodeFilm(id, episode, jobIds, [{ type: 'film', label, job_id: filmId, duration_sec: total, created_at: now },
      ...(srt ? [{ type: 'subtitle', label, job_id: subtitleId, created_at: now }] : [])])
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
      try { await store.read(project.name) } catch (error) { if (error.code === 'ENOENT') continue; throw error }
      const episodes = await readdir(join(projectsRoot(), project.name, 'episodes'), { withFileTypes: true }).catch(error => { if (error.code === 'ENOENT') return []; throw error })
      for (const entry of episodes) {
        const episode = Number(entry.name)
        if (!entry.isDirectory() || !validEpisode(episode)) continue
        const directory = join(projectsRoot(), project.name, 'episodes', entry.name)
        const task = (await store.readEpisode(project.name, episode)).film_task
        if (!task || !['pending', 'running'].includes(task.status)) continue
        pending = true
        if (active.size) continue
        active.add(directory)
        withLaunchLock(directory, async () => {
          const latest = await store.readEpisode(project.name, episode), current = latest.film_task
          if (current?.task_id !== task.task_id || !['pending', 'running'].includes(current.status)) return
          if (JSON.stringify(latest.shots.map(shot => shot.job_id)) !== JSON.stringify(task.job_ids)) {
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
