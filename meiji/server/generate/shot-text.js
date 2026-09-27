import { previousTail } from '../../client/tail-frame.js'
import { runTextGeneration } from '../workers/text-generation-worker.js'
import { continuityReviewContext } from '../prompts/continuity-review.js'
import { GenerationStatus, node, shotModel, setContent, shotResults, updateShotResults } from '../../client/drama-model.js'
import { checkContext, selectCheck, checkReasons } from '../data/self-checks.js'
import { shotReferenceImages } from '../../client/reference-images.js'
import { shotSecondsReady } from '../../client/shot-timing.js'

// 正文不解析；只有审核首行使用固定标识，审核意见原样保存。
async function generate(skill, instructions, options) {
  const original = checkContext.getStore()?.originalProject || options.project
  const action = { 'skill-jingtou-jingtoubiao-table-generate': 'shots', 'skill-jingtou-jingtoubiao-shot-review': 'revise-shot', 'skill-jingtou-meimiao-seconds-generate': 'shot-seconds', 'skill-jingtou-wenben-storyboard-generate': 'shot-storyboard' }[skill]
  const reasons = checkContext.getStore()?.generationMode === 'regenerate' ? '' : [...new Set([options.review, checkContext.getStore()?.review, ...checkReasons(original, { action, track: options.shotId })].filter(Boolean))].join('\n')
  const shot = original.shots?.items?.find(item => item.id === options.shotId)
  const board = shotResults(original, 'storyboard')?.find(item => item.id === options.shotId)
  const previous = skill === 'skill-jingtou-meimiao-seconds-generate' ? (shot?.seconds.content || '')
    : skill === 'skill-jingtou-wenben-storyboard-generate' ? (board?.prompt?.text || (board?.prompt ? JSON.stringify(board.prompt) : ''))
    : shot ? body(shot) : ''
  if (reasons) instructions += `\n本次自检未通过原因与人工意见：\n${reasons}`
  const reviewInstructions = instructions
  if (previous && reasons) instructions += `\n修改基稿（已有内容，不是本次待审结果）：\n${previous}\n在基稿基础上定向修改，只调整意见指出的问题及其必要的连带衔接；保留其余剧情、对白、调度和细节，不从头另写、不替换未涉及的段落。返回修改后的完整正文，不返回差异或修改说明。`
  return runTextGeneration({
    skill, instructions, options, reviewInstructions,
    reviewContext: action === 'shot-storyboard' ? continuityReviewContext(options.project, options.shotId, options.reviewReferences) : '',
    canRevise: text => {
      if (action !== 'shots') return true
      try { readShotSections(text); return true } catch { return false }
    },
  })
}

function context(project, shotId) {
  const cleanCard = card => Object.fromEntries(['id', 'name', 'type', 'look', 'space', 'description', 'identity', 'clothes', 'props', 'hairstyles'].filter(key => card[key] != null).map(key => [key, Array.isArray(card[key]) ? card[key].map(cleanCard) : card[key]]))
  const rows = project.shots?.items || []
  const index = rows.findIndex(shot => shot.id === shotId)
  const neighbors = index < 0 ? [] : [rows[index - 1], rows[index + 1]].filter(Boolean)
  return `项目：${project.title}\n风格：${project.style || ''}\n本集摘要：${project.summary?.content || ''}\n大纲：\n${project.plot.outline.content || ''}\n角色资料：\n${JSON.stringify(project.plot.characters?.items.map(cleanCard) || [])}\n场景资料：\n${JSON.stringify(project.plot.scenes?.items.map(cleanCard) || [])}\n完整镜头表（仅作上下文，不扩大本次生成范围）：\n${rows.map(shot => `## ${shot.id} / ${shot.duration}s\n${body(shot)}`).join('\n\n')}\n相邻镜头已通过的每秒指令（用于承接，不重复执行）：\n${neighbors.filter(shot => shot.seconds?.check?.passed === true && !shot.seconds.stale).map(shot => `${shot.id}：${shot.seconds.content || ''}`).join('\n')}`
}
function body(shot) { return shot?.content || '' }
// 只读取片段标题中的传输元数据；剧情正文保持原文，不解析 JSON。
export function readShotSections(text) {
  const marks = [...text.matchAll(/^## S(\d+) \/ (\d+)s[ \t]*$/gm)]
  if (!marks.length || text.slice(0, marks[0].index).trim()) throw new Error('镜头表需按「## S01 / 12s」分段，标题前不要添加说明')
  return marks.map((mark, index) => {
    const id = `S${String(index + 1).padStart(2, '0')}`
    const duration = Number(mark[2])
    const body = text.slice(mark.index + mark[0].length, marks[index + 1]?.index ?? text.length).trim()
    if (Number(mark[1]) !== index + 1 || duration < 1 || duration > 15 || !body) throw new Error(`${id} 的编号、1–15秒时长或正文不完整`)
    return shotModel({ id, duration, text: body, cast: [], scene: '', format: 'text' })
  })
}

export async function generateShots(options) {
  const { project, persist } = options
  const original = checkContext.getStore()?.originalProject || project
  const draft = checkContext.getStore()?.generationMode === 'regenerate' ? '' : original.shots?.items?.map(s => `## ${s.id} / ${s.duration}s\n${body(s)}`).join('\n\n') || ''
  const instructions = `${context(checkContext.getStore()?.generationMode === 'regenerate' ? { ...project, shots: { ...project.shots, items: [] } } : project)}\n本集目标 ${project.durationSeconds} 秒。先统筹全集事件、场景转换、实际身体身份及片段首末状态，再决定片段数量与各自时长，每段1–15秒，不均分、不凑满15秒。总时长尽量等于目标，容差10秒。\n场景/时代/身体变化、完整对白和动作结果优先作为边界；比较首帧接续与多模态参考时状态衔接是否成立，不在本阶段选择最终模式或编造关键帧。\n一次返回完整镜头表。每段标题严格为「## S01 / 12s」，编号从S01连续递增，秒数按内容分配；分段下首行必须写「标题：简短剧情标题」，标题内容跟随项目语言，概括本镜核心事件，不能只有编号；随后自由文本描述事件、起止状态、切段理由和接续要求，不输出JSON。\n${draft ? `已有镜头表：\n${draft}\n有修订意见时以此为基稿，只改受影响的段落；意见涉及切段或衔接时允许调整相邻边界与时长，保留其他事件和细节。` : ''}`
  const result = await generate('skill-jingtou-jingtoubiao-table-generate', instructions, options)
  let items = []
  const failures = [...result.check.failures]
  try {
    items = readShotSections(result.text).map(item => {
      const previous = original.shots?.items?.find(shot => shot.id === item.id && shot.duration === item.duration && body(shot) === item.content)
      return previous ? { ...previous, ...item, cast: previous.cast || [], scene: previous.scene || '' } : item
    })
    const total = items.reduce((sum, item) => sum + item.duration, 0)
    if (Math.abs(total - project.durationSeconds) > 10) failures.push(`镜头总时长 ${total}s，与目标 ${project.durationSeconds}s 相差超过10秒`)
  } catch (error) { failures.push(error.message) }
  // 保存失败原文，不自动重试或把格式错误交给剧情重写循环。
  const shots = { ...node('shots'), revision: project.shots.revision + 1, items, failedOutput: items.length ? '' : result.text, reviewText: result.reviewText, format: 'text', check: { passed: failures.length === 0, failures } }
  if (persist) {
    if (checkContext.getStore()) checkContext.getStore().validation = []
    await persist(shots)
  }
  if (checkContext.getStore()) checkContext.getStore().validation = failures
  return shots
}

export async function reviseShot(options) {
  const { project, shotId, review = '' } = options
  const shot = project.shots.items.find(item => item.id === shotId)
  if (!shot) throw new Error('没有这一镜')
  const result = await generate('skill-jingtou-jingtoubiao-shot-review', `${context(checkContext.getStore()?.generationMode === 'regenerate' ? { ...project, shots: { ...project.shots, items: project.shots.items.filter(item => item.id !== shotId) } } : project, shotId)}\n只生成 ${shotId}，时长 ${shot.duration}s。${checkContext.getStore()?.generationMode === 'regenerate' ? '' : `当前正文：${body(shot)}\n审核意见：${review}`}\n直接返回修改后的完整正文，首行保留「标题：简短剧情标题」；原文缺标题时补充，核心事件未变时沿用原标题。`, options)
  return { ...project.shots, items: project.shots.items.map(item => item.id === shotId ? { ...item, content: result.text, check: result.check } : item), check: result.check }
}

export async function generateShotSeconds(options) {
  const { project, shotId, review = '' } = options
  const shot = project.shots.items.find(item => item.id === shotId)
  if (!shot) throw new Error('没有这一镜')
  const result = await generate('skill-jingtou-meimiao-seconds-generate', `${context(project, shotId)}\n只为 ${shotId} 生成 0–${shot.duration}s 的时间线。\n镜头原文：${body(shot)}\n审核意见：${review}\n自由文本分段写时间、动作、摄影机、空间、声音及交接，不输出 JSON。`, options)
  return { ...project.shots, items: project.shots.items.map(item => item.id === shotId ? { ...item, seconds: setContent(structuredClone(item.seconds), result.text, result.check) } : item) }
}

export async function generateShotStoryboard(options) {
  const { project, shotId, review = '' } = options
  const shot = project.shots.items.find(item => item.id === shotId)
  if (!shot || !shotSecondsReady(shot)) throw Object.assign(new Error('请先生成这一镜的每秒指令'), { status: 409 })
  const source = `${body(shot)}\n${shot.seconds.content || ''}`
  const characters = shot.cast?.length ? [...shot.cast] : [...new Set([ ...(project.plot.characters?.items || []).filter(person => person.name && source.includes(person.name)).map(person => person.name)])]
  const scenes = shot.scene ? [shot.scene] : [...new Set([ ...(project.plot.scenes?.items || []).filter(scene => scene.name && source.includes(scene.name)).map(scene => scene.name)])]
  const images = shotReferenceImages(project, { ...shot, characters, scenes })
  const tail = previousTail(project, shotId)
  if (tail) images.push({ url: tail.imageUrl, label: `上一镜 ${tail.sourceShotId} 尾帧（连续剧情承接状态，转场直接进入新场景）`, kind: 'tailFrame', sourceShotId: tail.sourceShotId, sourceVideoFile: tail.sourceVideoFile })
  if (images.length > 9) throw new Error('含尾帧的参考图超过9张，请减少角色附属素材')
  // 使用已确认的远程地址；不把尚待确认或仅有本地地址的图片送入视频接口。
  if (images.some(image => !/^https?:\/\//.test(image.url))) throw Object.assign(new Error('请先确认并上传本镜参考图片'), { status: 409 })
  const video = images.length ? 'reference' : 'text'
  const refs = images.map((image, i) => `<Picture ${i + 1}> ${image.label} URL: ${image.url}`).join('\n')
  const result = await generate('skill-jingtou-wenben-storyboard-generate', `${context(project, shotId)}\n镜头 ${shotId}，${shot.duration}s。\n镜头原文：${body(shot)}\n每秒指令原文：\n${shot.seconds.content || ''}\n视频模式由程序确定：${video}。\n程序关联角色：${characters.join('、')}\n关联场景：${scenes.join('、') || '未关联'}\n参考图片（固定顺序，仅使用此列表，不引用其他资产）：\n${refs || '无'}\n审核意见：${review}\n完整保留每秒指令中的剧情。首行返回 [opening-reference: previous-tail] 或 [opening-reference: none]。尾帧若在参考图片列表中，无论转场与否均须绑定其 Picture 编号，在主体定义、保留分析和开场描述中说明用途：连续剧情从该尾帧构图与动作状态开始，立即继续运动，不停留展示图片；场景切换、时间跳跃或身份变化直接从第一帧进入本镜新剧情，尾帧仅参考相容状态，不先展示旧场景、不插入静帧或第二帧转场、不重演前镜剧情；若没有尾帧则不虚构。首行统一使用 none，图片已纳入固定列表，不在提交时追加。首行后只返回最终视频提示词原文，不返回 JSON 或说明。`, { ...options, reviewReferences: images })
  const marker = /^\[opening-reference: (previous-tail|none)\][ \t]*\r?\n/.exec(result.text)
  const openingReference = video === 'reference' && project.shots.items[0].id !== shotId && marker?.[1] === 'previous-tail' ? 'previous-tail' : 'none'
  const promptText = marker ? result.text.slice(marker[0].length) : result.text
  const item = { tailReference: tail ? { sourceShotId: tail.sourceShotId, sourceVideoFile: tail.sourceVideoFile, imageUrl: tail.imageUrl } : null, openingReference, id: shotId, duration: shot.duration, title: shotId, format: 'text', video, scene: scenes[0] || '', scenes, characters, referenceSnapshot: structuredClone(images), prompt: { text: promptText }, reviewText: result.reviewText }
  const byId = new Map(shotResults(project, 'storyboard').map(item => [item.id, item]))
  byId.set(shotId, item)
  return project.shots.items.map(shot => byId.get(shot.id)).filter(Boolean)
}

export async function generateStoryboard(options) {
  let project = options.project
  for (const shot of project.shots.items) {
    const board = shot.storyboard
    if (!options.regenerateAll && board?.content?.prompt?.text?.trim() && board.status === GenerationStatus.PASSED && board.check.passed === true && !board.stale) continue
    if (options.beforeShot) project = await options.beforeShot(shot.id)
    await selectCheck(project, { action: 'shot-storyboard', track: shot.id })
    project = { ...project, ...updateShotResults(project, 'storyboard', await generateShotStoryboard({ ...options, project, shotId: shot.id })) }
    if (options.persist) await options.persist(shotResults(project, 'storyboard'))
    if (checkContext.getStore()?.validation?.length) break
  }
  return shotResults(project, 'storyboard')
}
