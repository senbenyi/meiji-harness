import { readFile, writeFile, readdir, mkdir, copyFile, rename } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { migrateFeedback } from './migrate-model-feedback.js'
import { GenerationStatus, schemaVersion, node, episodeModel, cardModel, shotModel, targetNode, allNodes, assertDrama, modelPatch, aggregateStatus, shotResults } from '../shared/drama-model.js'
import { pictureTargetSnapshot } from '../server/data/pictures.js'
const textOf = value => typeof value === 'string' ? value : value == null ? '' : JSON.stringify(value, null, 2)
function migrateEpisode(source) {
  const old = migrateFeedback(source)
  const { feedback, outline, characters, scenes, shots, storyboard, films, boards, assembly, brief, summary, ...rest } = old
  const episode = episodeModel(old.id, { ...rest, summary })
  episode.customSkills = structuredClone(old.customSkills || {})
  episode.pendingImages = structuredClone(old.pendingImages || {})
  episode.revision = old.revision || 0
  episode.summary.status = GenerationStatus.PASSED
  episode.summary.check.passed = true
  episode.plot.outline.content = outline
  for (const key of ['characters', 'scenes']) {
    episode.plot[key].items = (old[key]?.items || []).map(item => cardModel(item))
  }
  const ids = [...new Set([...(shots?.items || []).map(s => s.id), ...(storyboard || []).map(s => s.id), ...Object.keys(films || {}), ...Object.keys(boards || {})])]
  episode.shots.items = ids.map(id => {
    const raw = shots?.items?.find(s => s.id === id)
    const { seconds, secondsText, secondsReviewText, text, ...fields } = raw || { id }
    const shot = shotModel({ ...fields, text: text || textOf(raw || '') })
    shot.seconds.content = secondsText || (seconds?.length ? textOf(seconds) : null)
    const story = storyboard?.find(s => s.id === id)
    if (story) { const { id: _, ...content } = story; shot.storyboard.content = content }
    shot.pencil.content = boards?.[id] || null
    shot.video.content = films?.[id] || null
    return shot
  })
  episode.shots.failedOutput = episode.shots.items.length ? '' : shots?.rawText || ''
  episode.assembly.content = assembly
  for (const [key, value] of Object.entries(feedback)) {
    const target = targetNode(episode, key)
    if (!target) continue
    target.check = { ...target.check, ...value.check }
    target.review = { ...target.review, ...value.review }
    delete target.review.status
  }
  for (const draft of Object.values(episode.pendingImages)) {
    const target = draft.track ? shotResults(episode, 'storyboard').find(item => item.id === draft.track) : episode.plot[draft.key]?.items.find(item => item.id === draft.itemId)
    if (target) draft.target = pictureTargetSnapshot(target)
  }
  for (const value of allNodes(episode)) {
    if (value.content && value.check.passed === null && value.status === GenerationStatus.NOT_GENERATED) { value.status = GenerationStatus.FAILED; value.error = '尚未完成自检' }
    if (value.check.passed === false) value.status = GenerationStatus.FAILED
    else if (value.check.passed === true) value.status = GenerationStatus.PASSED
    if (value.content?.status === 'ready') { value.status = GenerationStatus.PASSED; value.check.passed = true; value.error = null }
    if (['error', 'interrupted'].includes(value.content?.status)) { value.status = GenerationStatus.FAILED; value.error = value.content.error || '任务已中断' }
    if (value.content?.status === 'stale') { value.status = GenerationStatus.FAILED; value.stale = true }
    if (value.content?.status === 'running' || old.activity) {
      // Migration is offline; no task from the former process may remain active.
      if (value.content?.status === 'running') { value.status = GenerationStatus.FAILED; value.error = '迁移前的视频任务已中断'; value.content.status = 'interrupted' }
    }
  }
  episode.activity = null
  episode.activityError = old.activity ? '迁移前的任务已中断，请重新发起' : old.activityError || null
  return modelPatch(episode, {})
}
export function migrateProject(source) {
  if (source.schemaVersion === schemaVersion) return assertDrama(structuredClone(source))
  const { version, feedback, outline, characters, scenes, shots, storyboard, films, boards, assembly, brief, summary, episodes, ...meta } = source
  const migrated = (episodes || [source]).map(migrateEpisode)
  return assertDrama({ ...meta, schemaVersion, lifecycle: source.status === 'completed' ? 'completed' : 'in-progress', status: aggregateStatus(migrated), summary: { ...node('summary', summary), status: GenerationStatus.PASSED, check: { passed: true, failures: [], revision: 0 } }, activity: null, activeOperation: null,
    episodes: migrated })
}
export async function migrateDirectory(home) {
  const root = join(home, 'storages/meiji/projects')
  const backup = join(home, 'backups', `model-v2-${new Date().toISOString().replace(/[:.]/g, '-')}`)
  const pending = []
  for (const file of await readdir(root)) {
    if (!/^[0-9a-f-]{36}\.json$/.test(file)) continue
    const path = join(root, file), source = JSON.parse(await readFile(path, 'utf8'))
    if (source.schemaVersion === schemaVersion) continue
    if (source.activity || source.episodes?.some(e => e.activity)) throw new Error(`${file} 有运行任务，先停止服务再迁移`)
    pending.push({ file, path, model: migrateProject(source) })
  }
  if (!pending.length) return { migrated: 0 }
  await mkdir(backup, { recursive: true })
  for (const item of pending) await copyFile(item.path, join(backup, item.file))
  for (const item of pending) {
    await writeFile(item.path + '.migrating', JSON.stringify(item.model, null, 2) + '\n', { mode: 0o600 })
    await rename(item.path + '.migrating', item.path)
  }
  return { migrated: pending.length, backup, projects: pending.map(item => ({ id: item.model.id, episodes: item.model.episodes.length, shots: item.model.episodes.reduce((sum, e) => sum + e.shots.items.length, 0) })) }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (!process.argv[2]) throw new Error('用法：node meiji/scripts/migrate-model.js <DSH_HOME>')
  console.log(JSON.stringify(await migrateDirectory(resolve(process.argv[2])), null, 2))
}
