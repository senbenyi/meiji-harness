// 职责：定义短剧五步规划的结构化输出及服务端安全边界。
import { statusError } from '../../utils/errors.js'

const string = { type: 'string' }
const integer = { type: 'integer' }
const number = { type: 'number' }
const object = properties => ({ type: 'object', additionalProperties: false, properties, required: Object.keys(properties) })
const array = items => ({ type: 'array', items })
const character = object({ id: string, name: string, appearance: string, voice: string, personality: string })
const scene = object({ id: string, name: string, description: string })
const dialogue = object({ role: string, text: string })

export const planningSteps = ['series', 'outline', 'script', 'storyboard', 'shot-prompt']
export const planningSchema = {
  series: object({ logline: string, genre: string, episode_count: integer, episode_seconds: integer, world: string,
    characters: array(character), scenes: array(scene) }),
  outline: object({ episodes: array(object({ number: integer, title: string, conflict: string, turn: string, hook: string })) }),
  script: object({ scenes: array(object({ scene_id: string, roles: array(string), action: string, dialogue: array(dialogue) })) }),
  storyboard: object({ shots: array(object({ scene_id: string, roles: array(string), shot_size: string, camera: string,
    action: string, duration: number, dialogue: array(dialogue) })) }),
  'shot-prompt': object({ prompt: string }),
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
      value.characters.some(item => ![item.id, item.name, item.appearance, item.voice, item.personality].every(text)) ||
      value.scenes.some(item => ![item.id, item.name, item.description].every(text)) ||
      ids(value.characters).size !== value.characters.length || ids(value.scenes).size !== value.scenes.length) throw invalid('立项内容或数量无效')
  } else if (step === 'outline') {
    if (!Array.isArray(value.episodes) || value.episodes.length !== context.series?.episode_count ||
      value.episodes.some((item, index) => item.number !== index + 1 || ![item.title, item.conflict, item.turn, item.hook].every(text))) throw invalid('大纲集数或内容无效')
  } else if (step === 'script') {
    const scenes = ids(context.series?.scenes || []), roles = ids(context.series?.characters || [])
    if (!Array.isArray(value.scenes) || !value.scenes.length || value.scenes.some(item => !scenes.has(item.scene_id) ||
      !Array.isArray(item.roles) || item.roles.some(role => !roles.has(role)) || !text(item.action) ||
      !Array.isArray(item.dialogue) || item.dialogue.some(line => !roles.has(line.role) || !text(line.text)))) throw invalid('剧本引用或内容无效')
  } else if (step === 'storyboard') {
    const scenes = ids(context.series?.scenes || []), roles = ids(context.series?.characters || [])
    if (!Array.isArray(value.shots) || !value.shots.length || value.shots.length > 200 ||
      value.shots.some(item => item.id !== undefined && (typeof item.id !== 'string' || !/^[a-z0-9-]{1,40}$/.test(item.id))) ||
      new Set(value.shots.map(item => item.id).filter(Boolean)).size !== value.shots.filter(item => item.id).length ||
      value.shots.some(item =>
      !scenes.has(item.scene_id) || !Array.isArray(item.roles) || item.roles.some(role => !roles.has(role)) ||
      ![item.shot_size, item.camera, item.action].every(text) || typeof item.duration !== 'number' || !Number.isFinite(item.duration) || item.duration <= 0 || item.duration > 15 ||
      !Array.isArray(item.dialogue) || item.dialogue.some(line => !roles.has(line.role) || !text(line.text)))) throw invalid('分镜数量、引用或内容无效')
  } else if (!text(value.prompt)) throw invalid('镜头提示词为空或超过 20000 字')
  return value
}
