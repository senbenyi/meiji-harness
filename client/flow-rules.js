import { feedbackOf } from './feedback.js'
import { shotSecondsReady } from './shot-timing.js'
export const reviewSteps = ['brief', 'outline', 'characters', 'scenes', 'shots', 'storyboard', 'film']

export function reviewsOf(project) {
  return Object.fromEntries(reviewSteps.map(id => [id, feedbackOf(project, id).review.status === 'approved' ? 'approved' : 'pending']))
}

const text = value => typeof value === 'string' && value.trim().length > 0
function outlineUnlocked(project) {
  const reviews = reviewsOf(project)
  return text(project?.summary) || (hasBrief(project) && reviews.brief === 'approved')
}
export function hasBrief(project) { return text(project?.brief?.logline) && text(project?.brief?.style) }
export function hasOutline(project) { return text(project?.outline) }
export function hasCharacters(project) { return Array.isArray(project?.characters?.items) && project.characters.items.length > 0 }
export function hasScenes(project) { return Array.isArray(project?.scenes?.items) && project.scenes.items.length > 0 }
export function hasShots(project) { return Array.isArray(project?.shots?.items) && project.shots.items.length > 0 }
export function shotsReady(project) { return hasShots(project) && feedbackOf(project, 'shots').check.passed === true }
export function hasShotSeconds(project) {
  const items = project?.shots?.items || []
  return items.length > 0 && items.every(shotSecondsReady)
}
export function hasStoryboard(project) {
  const shots = project?.shots?.items || []
  const boards = project?.storyboard || []
  return shots.length > 0 && boards.length === shots.length && new Set(boards.map(row => row.id)).size === shots.length && shots.every(shot => boards.some(row => row.id === shot.id))
}
export function hasFilm(project) {
  const rows = Array.isArray(project?.storyboard) ? project.storyboard : []
  return hasStoryboard(project) && rows.every(row => project?.films?.[row.id]?.status === 'ready')
}

export function gateOf(project) {
  if (!outlineUnlocked(project)) return 'brief'
  if (!hasOutline(project)) return 'outline'
  if (!hasCharacters(project)) return 'characters'
  if (!hasScenes(project)) return 'scenes'
  if (!shotsReady(project)) return 'shots'
  if (!hasStoryboard(project)) return 'storyboard'
  if (!hasFilm(project)) return 'film'
  return 'done'
}

export function canGenerate(project, step) {
  if (step === 'brief') return true
  if (step === 'outline') return outlineUnlocked(project)
  if (step === 'characters') return hasOutline(project)
  if (step === 'scenes') return hasCharacters(project)
  if (step === 'shots') return hasScenes(project)
  if (step === 'storyboard') return shotsReady(project)
  if (step === 'film') return hasStoryboard(project)
  return false
}

export function gateMessage(project, step) {
  if (step === 'brief') {
    if (!hasBrief(project)) return '先根据这一集的剧情摘要写简报。画幅沿用项目，时长沿用这一集。'
    return '这一集从剧情摘要开始。摘要写好后可以直接写大纲。重新生成大纲会清掉后面的角色、场景、镜头、分镜和成片。'
  }
  if (step === 'outline') {
    if (!canGenerate(project, 'outline')) return '请先写好本集摘要，再写故事大纲。'
    if (!hasOutline(project)) return '大纲只写故事、世界规则和段落。不写景别、运镜和分镜。'
    if (hasOutline(project)) return '大纲已写好。下一步做角色卡。重新生成会清掉角色之后的内容。'
  }
  if (step === 'characters') {
    if (!canGenerate(project, 'characters')) return '请先写好故事大纲，再做角色卡。'
    if (!hasCharacters(project)) return '每个角色一张卡，写明国籍、身份、性别、年代、年龄、服装、身高、体型和面相。图片可以后补，不挡下一步。'
    if (hasCharacters(project)) return '角色卡已写好。下一步做场景卡。重新生成会清掉场景之后的内容。'
  }
  if (step === 'scenes') {
    if (!canGenerate(project, 'scenes')) return '请先写好角色卡，再做场景卡。'
    if (!hasScenes(project)) return '场景卡最多两张，只写重要场景的环境和地标。不出现人物。图片只给这两张。'
    if (hasScenes(project)) return '场景卡已写好。下一步写镜头表。重新生成会清掉镜头表之后的内容。'
  }
  if (step === 'shots') {
    if (!canGenerate(project, 'shots')) return '请先写好场景卡，再写镜头表。'
    if (!hasShots(project)) return '先写镜头表，再逐镜写每秒指令。单镜不超过 15 秒，总时长与本集相差不超过 10 秒。'
    if (!feedbackOf(project, 'shots').check.passed) return `镜头表还没通过自检：${(feedbackOf(project, 'shots').check.failures || []).slice(0, 3).join('；') || '请重新生成'}`
    if (!hasShotSeconds(project)) return '镜头表已通过自检。生成分镜表时会把缺的每秒指令一起写上。'
    if (shotsReady(project)) return '镜头表已写好。下一步一次生成全部分镜表，每秒指令会一起写上。重新生成镜头表会清掉分镜和成片。'
  }
  if (step === 'storyboard') {
    if (!shotsReady(project)) return '请先让镜头表通过自检，再生成分镜表。'
    if (!hasStoryboard(project)) return '一次生成全部分镜表。缺的每秒指令会先写满，再写成 MiniMax H3 的三段提示词。'
    if (hasStoryboard(project)) return '文本分镜已写好。它是成片的依据。铅笔分镜可以后补。'
  }
  if (step === 'boards') return '每秒一格的铅笔草图，用来预览这一镜。文本分镜仍是成片依据。'
  if (step === 'film') {
    if (!canGenerate(project, 'film')) return '请先在镜头详情写好文本分镜，再逐镜提交成片。'
    if (hasFilm(project)) return '每条镜头都已生成。下一步是合成。全片拼接和背景音乐后期接入。'
    return '每个镜头单独成片。提示词用官方三段式。视频出现在这张镜头卡片上。'
  }
  if (step === 'assembly') return '全片拼接和背景音乐后期接入。卡片先留在这里。'
  return '步骤无效'
}

