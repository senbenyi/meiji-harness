import { askSkill, textMaxTokens } from './chat.js'
import { checkContext, selectCheck, checkReasons } from '../data/self-checks.js'
import { skillSupplement } from '../data/custom-skills.js'
import { shotReferenceImages } from '../../client/reference-images.js'
import { shotSecondsReady } from '../../client/shot-timing.js'

// 正文不解析；只有审核首行使用固定标识，审核意见原样保存。
async function generate(skill, instructions, options) {
  const request = options.request || askSkill
  const original = checkContext.getStore()?.originalProject || options.project
  const action = { 'meiji-shots': 'shots', 'meiji-revise-shot': 'revise-shot', 'meiji-shot-seconds': 'shot-seconds', 'meiji-storyboard': 'shot-storyboard' }[skill]
  const reasons = [...new Set([options.review, checkContext.getStore()?.review, ...checkReasons(original, { action, track: options.shotId })].filter(Boolean))].join('\n')
  const shot = original.shots?.items?.find(item => item.id === options.shotId)
  const board = original.storyboard?.find(item => item.id === options.shotId)
  const previous = skill === 'meiji-shot-seconds' ? (shot?.secondsText || (shot?.seconds?.length ? JSON.stringify(shot.seconds) : ''))
    : skill === 'meiji-storyboard' ? (board?.prompt?.text || (board?.prompt ? JSON.stringify(board.prompt) : ''))
    : shot ? body(shot) : ''
  if (reasons) instructions += `\n本次自检未通过原因与人工意见：\n${reasons}`
  if (previous && reasons) instructions += `\n修改基稿（已有内容，不是本次待审结果）：\n${previous}\n在基稿基础上定向修改，只调整意见指出的问题及其必要的连带衔接；保留其余剧情、对白、调度和细节，不从头另写、不替换未涉及的段落。返回修改后的完整正文，不返回差异或修改说明。`
  const text = await request(skill, instructions, { ...options, maxTokens: textMaxTokens(options.project.durationSeconds) })
  if (!String(text || '').trim()) throw Object.assign(new Error('模型未返回内容'), { status: 502 })
  let reviewText
  let check
  try {
    reviewText = await request('meiji-content-review', `本次审核自由文本，不使用 JSON。首行只写 PASS 或 FAIL，后续用项目语言写审核意见。通过时只写 PASS。\n阶段：${skill}\n上游资料与生成要求：\n${instructions}${skillSupplement(options.project, skill)}\n本次修改后的待审原文（只审核此版本，核实意见是否已解决，不把旧问题直接当成新失败）：\n${text}`, { ...options, includeReview: false, json: false, maxTokens: 4096 })
    const verdict = reviewText.trim()
    check = verdict === 'PASS' ? { passed: true, failures: [] } : { passed: false, failures: [reviewText] }
  } catch (error) {
    reviewText = `审核未完成：${error.message}`
    check = { passed: false, failures: [reviewText] }
  }
  const context = checkContext.getStore()
  if (context) context.validation = check.failures
  return { text, reviewText, check }
}

function context(project) {
  return `项目：${project.title}\n风格：${project.style || project.brief?.style || ''}\n大纲：\n${project.outline || ''}\n角色资料：\n${JSON.stringify(project.characters?.items || [])}\n场景资料：\n${JSON.stringify(project.scenes?.items || [])}`
}
function body(shot) { return shot?.text || JSON.stringify(shot || {}) }
function plan(project) {
  const total = project.durationSeconds
  const count = Math.ceil(total / 15)
  const duration = Math.floor(total / count)
  return Array.from({ length: count }, (_, index) => ({ id: `S${String(index + 1).padStart(2, '0')}`, duration: duration + (index < total % count ? 1 : 0), cast: [], scene: '', secondsText: '', format: 'text' }))
}

export async function generateShots(options) {
  const { project, review = '', persist } = options
  const original = checkContext.getStore()?.originalProject || project
  const correcting = Boolean(review || checkContext.getStore()?.review || checkReasons(original, { action: 'shots' }).length)
  const slots = correcting && original.shots?.items?.length ? original.shots.items.map(item => ({ ...item, seconds: [], secondsText: '' })) : plan(project)
  const items = []
  const failures = []
  for (const slot of slots) {
    const result = await generate('meiji-shots', `${context(project)}\n程序安排的镜头时长：${slots.map(s => `${s.id} ${s.duration}s`).join('、')}\n已写镜头：\n${items.map(s => `${s.id}：${s.text}`).join('\n')}\n只写 ${slot.id}，${slot.duration} 秒。统筹全剧进度，按顺序展开大纲，不提前演完后续内容。正文自由表达剧情、调度、声音与衔接，不输出 JSON。\n审核意见：${review}`, { ...options, shotId: slot.id })
    items.push({ ...slot, ...result })
    failures.push(...result.check.failures.map(reason => `${slot.id}：${reason}`))
    if (persist) {
      if (checkContext.getStore()) checkContext.getStore().validation = []
      await persist({ items: [...items], format: 'text', check: { passed: false, failures } })
    }
  }
  const check = { passed: failures.length === 0, failures }
  if (checkContext.getStore()) checkContext.getStore().validation = failures
  return { items, format: 'text', check }
}

export async function reviseShot(options) {
  const { project, shotId, review = '' } = options
  const shot = project.shots.items.find(item => item.id === shotId)
  if (!shot) throw new Error('没有这一镜')
  const result = await generate('meiji-revise-shot', `${context(project)}\n完整镜头表：${project.shots.items.map(body).join('\n')}\n只改 ${shotId}，时长 ${shot.duration}s。当前正文：${body(shot)}\n审核意见：${review}\n直接返回修改后的原文。`, options)
  return { ...project.shots, items: project.shots.items.map(item => item.id === shotId ? { ...item, ...result, format: 'text', seconds: [], secondsText: '' } : item), check: result.check }
}

export async function generateShotSeconds(options) {
  const { project, shotId, review = '' } = options
  const shot = project.shots.items.find(item => item.id === shotId)
  if (!shot) throw new Error('没有这一镜')
  const result = await generate('meiji-shot-seconds', `${context(project)}\n完整镜头表：${project.shots.items.map(s => `${s.id}：${body(s)}`).join('\n')}\n只为 ${shotId} 生成 0–${shot.duration}s 的时间线。\n镜头原文：${body(shot)}\n审核意见：${review}\n自由文本分段写时间、动作、摄影机、空间、声音及交接，不输出 JSON。`, options)
  return { ...project.shots, items: project.shots.items.map(item => item.id === shotId ? { ...item, secondsText: result.text, secondsReviewText: result.reviewText, seconds: [] } : item) }
}

export async function generateShotStoryboard(options) {
  const { project, shotId, review = '' } = options
  const shot = project.shots.items.find(item => item.id === shotId)
  if (!shot || !shotSecondsReady(shot)) throw Object.assign(new Error('请先生成这一镜的每秒指令'), { status: 409 })
  const source = `${body(shot)}\n${shot.secondsText || JSON.stringify(shot.seconds || [])}`
  const characters = [...new Set([...(shot.cast || []), ...(project.characters?.items || []).filter(person => person.name && source.includes(person.name)).map(person => person.name)])]
  const scenes = [...new Set([...(shot.scene ? [shot.scene] : []), ...(project.scenes?.items || []).filter(scene => scene.name && source.includes(scene.name)).map(scene => scene.name)])]
  const images = shotReferenceImages(project, { ...shot, characters, scenes })
  // 使用已确认的远程地址；不把尚待确认或仅有本地地址的图片送入视频接口。
  if (images.some(image => !/^https?:\/\//.test(image.url))) throw Object.assign(new Error('请先确认并上传本镜参考图片'), { status: 409 })
  const video = images.length ? 'reference' : 'text'
  const refs = images.map((image, i) => `<Picture ${i + 1}> ${image.label} URL: ${image.url}`).join('\n')
  const result = await generate('meiji-storyboard', `${context(project)}\n镜头 ${shotId}，${shot.duration}s。\n镜头原文：${body(shot)}\n每秒指令原文：\n${shot.secondsText || JSON.stringify(shot.seconds)}\n视频模式由程序确定：${video}。\n程序关联角色：${characters.join('、')}\n关联场景：${scenes.join('、') || '未关联'}\n参考图片（固定顺序，仅使用此列表，不引用其他资产）：\n${refs || '无'}\n审核意见：${review}\n完整保留每秒指令中的剧情。只返回最终视频提示词原文，不返回 JSON 或说明。`, options)
  const item = { id: shotId, duration: shot.duration, title: shotId, format: 'text', video, scene: scenes[0] || '', scenes, characters, referenceSnapshot: structuredClone(images), prompt: { text: result.text }, reviewText: result.reviewText }
  const byId = new Map((project.storyboard || []).map(item => [item.id, item]))
  byId.set(shotId, item)
  return project.shots.items.map(shot => byId.get(shot.id)).filter(Boolean)
}

export async function generateStoryboard(options) {
  let project = options.project
  for (const shot of project.shots.items) {
    selectCheck(project, { action: 'shot-storyboard', track: shot.id })
    project = { ...project, storyboard: await generateShotStoryboard({ ...options, project, shotId: shot.id }) }
    if (options.persist) await options.persist(project.storyboard)
    if (checkContext.getStore()?.validation?.length) break
  }
  return project.storyboard
}
