import { parseSecondsResponse } from '../../shared/seconds-content.js'
import { referencedEntities } from '../../shared/entity-references.js'
import { compileVideoPrompt } from '../prompts/video-prompt-renderer.js'
import { h3PromptFailures } from './film.js'
import { scopedCheck } from '../../shared/feedback.js'
import { runTextSteps, reviewStep } from './text-steps.js'
import { buildTablePrompts, buildSingleShotPrompts, buildSecondsPrompts, buildAllSecondsPrompts } from '../prompts/shot-prompts.js'
import { node, shotModel, setContent, shotResults, updateShotResults } from '../../shared/drama-model.js'
import { selectCheck } from '../data/review-checks.js'
import { checkContext } from '../data/operation-context.js'
import { shotSecondsReady } from '../../shared/shot-timing.js'

import { runStep } from '../data/task-store.js'

function body(shot) { return shot?.content || '' }
// 只读取片段标题中的传输元数据；剧情正文保持原文，不解析 JSON。
export function readShotSections(text, offset = 0) {
  const marks = [...text.matchAll(/^## S(\d+) \/ (\d+)s[ \t]*$/gm)]
  if (!marks.length || text.slice(0, marks[0].index).trim()) throw new Error('镜头表需按「## S01 / 12s」分段，标题前不要添加说明')
  return marks.map((mark, index) => {
    const id = `S${String(offset + index + 1).padStart(2, '0')}`
    const duration = Number(mark[2])
    const body = text.slice(mark.index + mark[0].length, marks[index + 1]?.index ?? text.length).trim()
    if (Number(mark[1]) !== offset + index + 1 || duration < 1 || duration > 15 || !body) throw new Error(`${id} 的编号、1–15秒时长或正文不完整`)
    return shotModel({ id, duration, text: body, cast: [], scene: '', format: 'text' })
  })
}

export async function generateShots(options) {
  const { project, persist } = options
  const original = checkContext.getStore()?.originalProject || project
  const timingFailures = text => {
    referencedEntities(text, project)
    const total = readShotSections(text).reduce((sum, shot) => sum + shot.duration, 0)
    return Math.abs(total - project.durationSeconds) > 10 ? [`镜头总时长 ${total}s，与目标 ${project.durationSeconds}s 相差超过10秒`] : []
  }
  const normalize = (text, check, reviewText = '') => {
    const items = readShotSections(text).map(item => {
      const previous = original.shots?.items?.find(shot => shot.id === item.id && shot.duration === item.duration && body(shot) === item.content)
      return previous ? { ...previous, ...item, cast: previous.cast || [], scene: previous.scene || '' } : item
    })
    return { ...node('shots'), revision: project.shots.revision + 1, items, failedOutput: '', reviewText, format: 'text', check }
  }
  const result = await runTextSteps({ target: 'shots', prompts: buildTablePrompts(options), options, check: timingFailures, canPersist: text => Boolean(readShotSections(text)), retainFailedDraft: true, persist: persist && ((text, check) => persist(normalize(text, check))) })
  const shots = normalize(result.text, result.check, result.reviewText)
  const failures = shots.check.failures
  if (persist) {
    if (checkContext.getStore()) checkContext.getStore().validation = []
    await persist(shots)
  }
  if (checkContext.getStore()) checkContext.getStore().validation = failures
  return shots
}

export async function reviseShot(options) {
  const { project, shotId } = options
  const shot = project.shots.items.find(item => item.id === shotId)
  if (!shot) throw new Error('没有这一镜')
  const result = await runTextSteps({ target: 'shots', prompts: buildSingleShotPrompts(options), options, check: text => { referencedEntities(text, project); return [] }, persist: options.persist && ((text, check) => options.persist({ ...project.shots, items: project.shots.items.map(item => item.id === shotId ? { ...item, content: text, check } : item), check })) })
  return { ...project.shots, items: project.shots.items.map(item => item.id === shotId ? { ...item, content: result.text, check: result.check } : item), check: result.check }
}

// Generate, review and revise the complete episode as one version.
export async function generateAllSeconds(options) {
  let { project } = options
  const ctx = checkContext.getStore()
  const upstream = { ...project, shots: { ...project.shots, items: project.shots.items.map(shot => ({ ...shot, seconds: { ...shot.seconds, content: null, check: { passed: null } } })) } }
  const parse = text => parseSecondsResponse(text, project.shots.items, project)

  if (ctx) ctx.target = { action: 'seconds' }
  const prompts = buildAllSecondsPrompts(options, upstream)
  const revise = prompts.revision
  let base = null, affected = null, correctionError = ''
  prompts.revision = (text, verdict) => {
    try { base = JSON.parse(text) } catch { base = null }
    const mentioned = [...new Set(verdict.match(/\bS\d{2,}\b/g) || [])]
    affected = base?.shots && mentioned.length ? project.shots.items.filter(s => mentioned.includes(s.id)).map(s => s.id) : project.shots.items.map(s => s.id)
    const message = revise(text, verdict)
    message.user += `\n【本轮程序限定修订范围，覆盖整集返回要求】\n只返回这些镜头的完整shots条目：${affected.join('、')}。保留其他镜头，程序负责合并并复核整集与相邻交接。`
    return message
  }
  const complete = (text, _message, requestOptions) => {
    if (requestOptions.logStage !== '自动修订' || !base?.shots) return text
    let correction
    try { correction = JSON.parse(text) } catch { return text }
    if (!Array.isArray(correction.shots)) return text
    if (correction.shots.some(s => !affected.includes(s.shotId))) { correctionError = '修订包含本轮限定范围外的镜头'; return text }
    const merged = base.shots.filter(s => !affected.includes(s.shotId))
    return JSON.stringify({ shots: [...merged, ...correction.shots] })
  }
  const result = await runTextSteps({ target: 'seconds', prompts, options, complete, check: text => { if (correctionError) throw new Error(correctionError); parse(text); return [] },
    persist: async (text, check) => {
      const sections = parse(text)
      const shots = { ...project.shots, seconds: setContent(structuredClone(project.shots.seconds), { version: 1, shots: sections }, check), items: project.shots.items.map((shot, i) => ({ ...shot, seconds: setContent(structuredClone(shot.seconds), sections[i], scopedCheck(check, shot.id)) })) }
      project = options.persist ? await options.persist(shots, 'draft') : { ...project, shots }
    },
  })
  if (!result.check.passed) throw Object.assign(new Error(`自检未通过：${result.check.failures.join('；')}`), { code: 'CONTENT_CHECK_FAILED', status: 422 })
  return project.shots
}

export async function generateShotSeconds(options) {
  const { project, shotId } = options
  const shot = project.shots.items.find(item => item.id === shotId)
  const parse = text => parseSecondsResponse(text, [shot], project)[0]
  const patch = (text, check) => ({ ...project.shots, items: project.shots.items.map(item => item.id === shotId ? { ...item, seconds: setContent(structuredClone(item.seconds), parse(text), check) } : item) })
  const result = await runTextSteps({ target: 'seconds', prompts: buildSecondsPrompts(options), options, check: text => { parse(text); return [] }, persist: options.persist && ((text, check) => options.persist(patch(text, check))) })
  return patch(result.text, result.check)
}

export async function generateShotStoryboard(options) {
  const { project, shotId } = options
  const shot = project.shots.items.find(item => item.id === shotId)
  if (!shot || !shotSecondsReady(shot) || shot.seconds.check.passed !== true || shot.seconds.stale) throw Object.assign(new Error('请先生成这一镜的每秒指令并通过自审'), { status: 409 })
  const item = await runStep('generate', () => {
    try { return compileVideoPrompt(project, shot) } catch (error) { return { invalid: error.message } }
  }, { target: `storyboard:${shotId}`, phase: 'reference-binding', label: '程序组装' })
  const result = await reviewStep({ target: `storyboard:${shotId}`, phase: 'reference-binding', text: item.prompt?.text || '',
    check: text => item.invalid ? [item.invalid] : h3PromptFailures(text, item.referenceSnapshot, item.video) })
  if (item.invalid) throw Object.assign(new Error(`自审未通过：${item.invalid}`), { code: 'CONTENT_CHECK_FAILED' })
  item.bindingCheck = result.check
  const byId = new Map(shotResults(project, 'storyboard').map(item => [item.id, item]))
  byId.set(shotId, { id: shotId, ...item })
  const rows = project.shots.items.map(shot => byId.get(shot.id)).filter(Boolean)
  if (options.persistDraft) await options.persistDraft(rows, result.check)
  if (result.check.passed !== true) throw Object.assign(new Error(`自审未通过：${result.check.failures.join('；')}`), { code: 'CONTENT_CHECK_FAILED' })
  return rows
}

export async function generateStoryboard(options) {
  let project = options.project
  for (const shot of project.shots.items) {
    if (options.beforeShot) project = await options.beforeShot(shot.id)
    await selectCheck(project, { action: 'shot-storyboard', track: shot.id })
    project = { ...project, ...updateShotResults(project, 'storyboard', await generateShotStoryboard({ ...options, project, shotId: shot.id, persistDraft: options.persist && ((rows) => options.persist(rows)) })) }
    if (options.persist) await options.persist(shotResults(project, 'storyboard'))
    if (checkContext.getStore()?.validation?.length) break
  }
  return shotResults(project, 'storyboard')
}
