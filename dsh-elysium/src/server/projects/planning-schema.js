// 职责：定义短剧五步规划的结构化输出及服务端安全边界。
import { statusError } from '../../utils/errors.js'

const string = { type: 'string' }
const integer = { type: 'integer' }
const number = { type: 'number' }
const object = properties => ({ type: 'object', additionalProperties: false, properties, required: Object.keys(properties) })
const array = items => ({ type: 'array', items })
const character = object({ id: string, name: string, appearance: string, voice: string, personality: string, image_prompt: string })
const scene = object({ id: string, name: string, description: string })
const dialogue = object({ role: string, text: string })
const timedDialogue = object({ role: string, text: string, tone: string })

export const planningSteps = ['series', 'timeline', 'storyboard', 'shot-prompt']
export const planningSchema = {
  series: object({ logline: string, genre: string, episode_count: integer, episode_seconds: integer, world: string,
    characters: array(character), scenes: array(scene), episodes: array(object({ number: integer, title: string, summary: string, hook: string })) }),
  timeline: object({ beats: array(object({ start: number, end: number, scene_id: string, roles: array(string),
    plot: string, emotion: string, dialogue: array(timedDialogue) })) }),
  storyboard: object({ shots: array(object({ scene_id: string, roles: array(string), shot_size: string, camera: string,
    action: string, duration: number, dialogue: array(dialogue) })) }),
  'shot-prompt': object({ prompt: string, keyframe_prompt: string }),
}

const invalid = message => statusError(502, `规划结果无效：${message}`)
const text = value => typeof value === 'string' && value.trim() && value.length <= 20000
const ids = items => new Set(items.map(item => item.id))

export function validatePlanningResult(step, value, context = {}) {
  if (!planningSteps.includes(step) || !value || typeof value !== 'object' || Array.isArray(value)) throw invalid('步骤或结果无效')
  if (step === 'series') {
    if (![value.logline, value.genre, value.world].every(text) || !Number.isInteger(value.episode_count) || value.episode_count < 1 || value.episode_count > 100 ||
      !Number.isInteger(value.episode_seconds) || value.episode_seconds < 1 || value.episode_seconds > 3600 ||
      !Array.isArray(value.characters) || !value.characters.length || !Array.isArray(value.scenes) || !value.scenes.length ||
      value.characters.some(item => ![item.id, item.name, item.appearance, item.voice, item.personality, item.image_prompt].every(text)) ||
      value.scenes.some(item => ![item.id, item.name, item.description].every(text)) ||
      ids(value.characters).size !== value.characters.length || ids(value.scenes).size !== value.scenes.length ||
      !Array.isArray(value.episodes) || value.episodes.length !== value.episode_count ||
      value.episodes.some((item, index) => item.number !== index + 1 || ![item.title, item.summary, item.hook].every(text))) throw invalid('剧情总览内容或数量无效')
  } else if (step === 'timeline') {
    const scenes = ids(context.series?.scenes || []), roles = ids(context.series?.characters || [])
    if (!Array.isArray(value.beats) || !value.beats.length || value.beats.some((item, index) =>
      !Number.isFinite(item.start) || !Number.isFinite(item.end) || item.start !== (index ? value.beats[index - 1].end : 0) || item.end <= item.start ||
      !scenes.has(item.scene_id) || !Array.isArray(item.roles) || item.roles.some(role => !roles.has(role)) ||
      !text(item.plot) || !text(item.emotion) || !Array.isArray(item.dialogue) ||
      item.dialogue.some(line => !roles.has(line.role) || ![line.text, line.tone].every(text))) ||
      Math.abs(value.beats.at(-1).end - context.series.episode_seconds) > context.series.episode_seconds * 0.1) throw invalid('时间线连续性、时长或引用无效')
  } else if (step === 'storyboard') {
    const scenes = ids(context.series?.scenes || []), roles = ids(context.series?.characters || [])
    if (!Array.isArray(value.shots) || !value.shots.length || value.shots.length > 200 ||
      value.shots.some(item => item.id !== undefined && (typeof item.id !== 'string' || !/^[a-z0-9-]{1,40}$/.test(item.id))) ||
      new Set(value.shots.map(item => item.id).filter(Boolean)).size !== value.shots.filter(item => item.id).length ||
      value.shots.some(item =>
      !scenes.has(item.scene_id) || !Array.isArray(item.roles) || item.roles.some(role => !roles.has(role)) ||
      ![item.shot_size, item.camera, item.action].every(text) || !Number.isInteger(item.duration) || item.duration < 1 || item.duration > 15 ||
      !Array.isArray(item.dialogue) || item.dialogue.some(line => !roles.has(line.role) || !text(line.text)))) throw invalid('分镜数量、引用或内容无效')
    // 中文对白约每秒 5 字，超出则镜头时长念不完。
    const crowded = value.shots.findIndex(shot => shot.dialogue.reduce((sum, line) => sum + [...line.text.replace(/\s/g, '')].length, 0) > shot.duration * 5)
    if (crowded >= 0) throw invalid(`第 ${crowded + 1} 镜台词超过时长 × 5 字`)
    const total = value.shots.reduce((sum, shot) => sum + shot.duration, 0)
    const timelineSeconds = context.timeline?.beats.at(-1).end
    if (!timelineSeconds || Math.abs(total - timelineSeconds) > timelineSeconds * 0.1) throw invalid('分镜总时长与时间线不符')
    let start = 0
    for (const shot of value.shots) {
      const lines = context.timeline.beats.filter(beat => beat.start < start + shot.duration && beat.end > start)
        .flatMap(beat => beat.dialogue)
      if (shot.dialogue.some(line => !lines.some(source => source.role === line.role && source.text === line.text))) throw invalid('分镜对白与时间线不符')
      start += shot.duration
    }
  } else if (!text(value.prompt) || !text(value.keyframe_prompt) || context.shot?.dialogue?.some(line => !value.prompt.includes(line.text))) throw invalid('镜头提示词或首帧提示词为空、超过 20000 字，或缺少定稿对白')
  return value
}
