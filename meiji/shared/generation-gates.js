import { GenerationStatus, shotResults } from './drama-model.js'
import { feedbackOf } from './review-feedback.js'
import { shotSecondsReady } from './shot-timing.js'
import { outlineFailures } from './story-outline.js'
export const reviewSteps = ['summary', 'outline', 'characters', 'scenes', 'shots', 'storyboard', 'film']

export function reviewsOf(project) {
  return Object.fromEntries(reviewSteps.map(id => [id, feedbackOf(project, id).check.passed === true ? 'approved' : 'pending']))
}

const text = value => typeof value === 'string' && value.trim().length > 0
function outlineUnlocked(project) { return hasSummary(project) && project.summary.check?.passed === true }
export function hasSummary(project) { return text(project?.summary?.content) }
export function hasOutline(project) { return outlineFailures(project?.plot?.outline?.content).length === 0 }
export function hasCharacters(project) { return Array.isArray(project?.plot?.characters?.items) && project.plot.characters.items.length > 0 }
export function hasScenes(project) { return Array.isArray(project?.plot?.scenes?.items) && project.plot.scenes.items.length > 0 }
export function hasShots(project) { return Array.isArray(project?.shots?.items) && project.shots.items.length > 0 }
export function shotsReady(project) { return hasShots(project) && feedbackOf(project, 'shots').check.passed === true }
export function hasShotSeconds(project) {
  const items = project?.shots?.items || []
  return items.length > 0 && items.every(shotSecondsReady)
}
export function hasStoryboard(project) {
  const shots = project?.shots?.items || []
  const boards = shotResults(project, 'storyboard')
  return shots.length > 0 && boards.length === shots.length && new Set(boards.map(row => row.id)).size === shots.length && shots.every(shot => boards.some(row => row.id === shot.id))
}
export function hasFilm(project) {
  const rows = shotResults(project, 'storyboard')
  return hasStoryboard(project) && rows.every(row => project.shots.items.find(shot => shot.id === row.id)?.video.status === GenerationStatus.PASSED)
}

export function gateOf(project) {
  if (!outlineUnlocked(project)) return 'summary'
  if (!hasOutline(project)) return 'outline'
  if (!hasCharacters(project)) return 'characters'
  if (!hasScenes(project)) return 'scenes'
  if (!shotsReady(project)) return 'shots'
  if (!hasShotSeconds(project) || feedbackOf(project, 'seconds').check.passed !== true) return 'seconds'
  if (!hasStoryboard(project)) return 'storyboard'
  if (!hasFilm(project)) return 'film'
  return 'done'
}

export function canGenerate(project, step) {
  if (step === 'summary') return true
  if (step === 'outline') return outlineUnlocked(project)
  if (step === 'characters') return false
  if (step === 'scenes') return false
  if (step === 'shots') return hasScenes(project) && ['outline', 'characters', 'scenes'].every(key => feedbackOf(project, key).check.passed === true)
  if (step === 'storyboard') return shotsReady(project)
  if (step === 'film') return hasStoryboard(project)
  return false
}

export function gateMessage(project, step) {
  if (step === 'summary') {
    if (!hasSummary(project)) return '先填写或生成本集摘要。画幅沿用项目，时长沿用这一集。'
    return '这一集从剧情摘要开始。摘要写好后可以直接写大纲。重新生成大纲会清掉后面的角色、场景、镜头、分镜和成片。'
  }
  if (step === 'outline') {
    if (!canGenerate(project, 'outline')) return '请先写好本集摘要，再写故事大纲。'
    if (!hasOutline(project)) return '点击 AI生成，依次生成故事大纲、角色卡和场景卡，不生成图片或镜头。'
    if (hasOutline(project)) return '剧情资料已生成；大纲、角色和场景依次独立生成并审核，道具按空集合处理。重新生成会清空镜头及后续内容。'
  }
  if (step === 'characters' || step === 'scenes') return '角色和场景与故事大纲统一生成；图片可在卡片中单独生成。'
  if (step === 'shots') {
    if (!canGenerate(project, 'shots')) {
      const labels = { outline: '剧情大纲', characters: '人物角色', scenes: '场景卡' }
      const pending = Object.entries(labels).flatMap(([key, label]) => {
        const record = project.plot?.[key]
        if (key === 'scenes' && !hasScenes(project)) return [`${label}尚未生成`]
        if (record?.check?.passed === true) return []
        return [`${label}${record?.check?.passed === false ? '自审未通过' : '尚未通过自审'}`]
      })
      return `镜头表暂不可生成：${pending.join('；')}。`
    }
    if (!hasShots(project)) return '先写镜头表，再逐镜生成每秒指令并逐镜自审。单镜不超过 15 秒，总时长与本集相差不超过 10 秒。'
    if (!feedbackOf(project, 'shots').check.passed) return '镜头表尚未通过自审，请查看镜头表顶部的审核卡片。'
    if (!hasShotSeconds(project)) return '镜头表已通过自审，请先逐镜生成每秒指令并逐镜审核。'
    if (shotsReady(project)) return '镜头表已写好。下一步生成每秒指令，再在成片页编排提示词与提交视频。重新生成镜头表会清掉分镜和成片。'
  }
  if (step === 'storyboard') {
    if (!shotsReady(project)) return '请先让镜头表通过自检，再生成分镜表。'
    if (!hasStoryboard(project)) return '请先完成每秒指令；视频提示词由程序编排并绑定参考素材。'
    if (hasStoryboard(project)) return '文本分镜已写好。它是成片的依据。。'
  }
  if (step === 'film') {
    if (!canGenerate(project, 'film')) return '请先在镜头详情写好文本分镜，再逐镜提交成片。'
    if (hasFilm(project)) return '每条镜头都已生成。下一步是合成。全片拼接和背景音乐后期接入。'
    return '每个镜头单独成片。提示词用官方三段式。视频出现在这张镜头卡片上。'
  }
  if (step === 'assembly') return '全片拼接和背景音乐后期接入。卡片先留在这里。'
  return '步骤无效'
}
