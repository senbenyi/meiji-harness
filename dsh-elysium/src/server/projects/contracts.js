// 职责：定义四步生成的机器输出形状，并校验模型字段与项目输入的关系。
import { statusError } from '../../utils/errors.js'

const string = { type: 'string' }, integer = { type: 'integer' }, boolean = { type: 'boolean' }
const array = items => ({ type: 'array', items })
const object = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false })
const shot = object({ size: string, camera: string, duration: integer, roles: array(string), video: string, keyframe: string })
const cut = object({ start_line: integer, ...shot.properties })
const schemas = {
  project: object({ title: string, genre: string, synopsis: string }),
  series: object({ logline: string, world: string,
    characters: array(object({ name: string, lead: boolean, intro: string, appearance: string, voice: string })),
    scenes: array(object({ name: string, description: string })),
    episodes: array(object({ number: integer, title: string, summary: string, hook: string })) }),
  script: object({ scenes: array(object({ number: integer, name: string, roles: array(string),
    lines: array(object({ kind: { type: 'string', enum: ['action', 'sound', 'dialogue'] }, speaker: string, tone: string, text: string })) })) }),
}

const invalid = (path, reason) => statusError(400, `${path}：${reason}`)
const present = (value, path, multiline = false) => {
  if (typeof value !== 'string' || !value.trim()) throw invalid(path, '不能为空')
  if (!multiline && (value.includes('\n') || value.includes('\r'))) throw invalid(path, '必须是单行文本')
}
const unique = (items, path) => {
  const names = items.map(item => item.name)
  if (new Set(names).size !== names.length) throw invalid(path, '名称不能重复')
}

function checkShape(value, schema, path = 'result') {
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid(path, '需要对象')
    for (const key of schema.required) if (!Object.hasOwn(value, key)) throw invalid(`${path}.${key}`, '缺少必填字段')
    for (const [key, item] of Object.entries(value)) {
      if (!Object.hasOwn(schema.properties, key)) throw invalid(`${path}.${key}`, '字段不允许')
      checkShape(item, schema.properties[key], `${path}.${key}`)
    }
  } else if (schema.type === 'array') {
    if (!Array.isArray(value)) throw invalid(path, '需要数组')
    value.forEach((item, index) => checkShape(item, schema.items, `${path}[${index}]`))
  } else if (schema.type === 'integer') {
    if (!Number.isInteger(value)) throw invalid(path, '需要整数')
  } else if (schema.type === 'boolean') {
    if (typeof value !== 'boolean') throw invalid(path, '需要布尔值')
  } else if (typeof value !== 'string' || schema.enum && !schema.enum.includes(value)) throw invalid(path, schema.enum ? `只允许 ${schema.enum.join('、')}` : '需要文本')
}

export function generationSchema(step, input = {}) {
  if (step !== 'storyboard') return schemas[step]
  if (input.target_shot) return object({ shot })
  return object({ scenes: object(Object.fromEntries(input.scenes.map(scene => [`scene_${scene.number}`, object({ first_shot: shot, cuts: array(cut) })]))) })
}

function checkShot(value, path, roles) {
  for (const field of ['size', 'camera', 'video', 'keyframe']) present(value[field], `${path}.${field}`)
  if (value.duration < 1) throw invalid(`${path}.duration`, '必须至少 1 秒')
  if (new Set(value.roles).size !== value.roles.length || value.roles.some(role => !roles.has(role))) throw invalid(`${path}.roles`, '人物必须来自总览且不能重复')
}

export function validateGenerated(step, result, input) {
  const schema = generationSchema(step, input)
  if (!schema) throw invalid('step', '步骤无效')
  checkShape(result, schema)
  if (step === 'project') {
    present(result.title, 'title'); present(result.genre, 'genre'); present(result.synopsis, 'synopsis', true)
  } else if (step === 'series') {
    present(result.logline, 'logline'); present(result.world, 'world', true)
    if (!result.characters.length || !result.characters.some(item => item.lead)) throw invalid('characters', '至少需要一名主角')
    if (!result.scenes.length) throw invalid('scenes', '至少需要一个场景')
    unique(result.characters, 'characters'); unique(result.scenes, 'scenes')
    for (const [index, item] of result.characters.entries()) for (const field of ['name', 'intro', 'appearance', 'voice']) present(item[field], `characters[${index}].${field}`)
    for (const [index, item] of result.scenes.entries()) { present(item.name, `scenes[${index}].name`); present(item.description, `scenes[${index}].description`) }
    if (!result.episodes.length || input.expected_episodes && result.episodes.length !== input.expected_episodes) throw invalid('episodes', `需要 ${input.expected_episodes || '至少 1'} 集`)
    for (const [index, item] of result.episodes.entries()) {
      if (item.number !== index + 1) throw invalid(`episodes[${index}].number`, `应为 ${index + 1}`)
      for (const field of ['title', 'summary', 'hook']) present(item[field], `episodes[${index}].${field}`)
    }
  } else if (step === 'script') {
    const scenes = new Set(input.series.scenes.map(item => item.name)), roles = new Set(input.series.characters.map(item => item.name))
    if (!result.scenes.length) throw invalid('scenes', '至少需要一场')
    for (const [index, scene] of result.scenes.entries()) {
      if (scene.number !== index + 1) throw invalid(`scenes[${index}].number`, `应为 ${index + 1}`)
      if (!scenes.has(scene.name)) throw invalid(`scenes[${index}].name`, `${scene.name} 不在总览中`)
      if (!scene.roles.length || scene.roles.some(role => !roles.has(role))) throw invalid(`scenes[${index}].roles`, '出场人物不在总览中')
      if (!scene.lines.length) throw invalid(`scenes[${index}].lines`, '每场至少需要一行')
      for (const [lineIndex, line] of scene.lines.entries()) {
        const path = `scenes[${index}].lines[${lineIndex}]`
        present(line.text, `${path}.text`)
        if (line.kind === 'dialogue') {
          if (!roles.has(line.speaker) || !line.tone.trim()) throw invalid(path, '台词需要总览角色和语气')
        } else if (line.speaker || line.tone) throw invalid(path, '动作和音效不应有说话人或语气')
      }
    }
  } else {
    const roles = new Set(input.series.characters.map(item => item.name))
    if (input.target_shot) checkShot(result.shot, 'shot', roles)
    else {
      let total = 0
      for (const scene of input.scenes) {
        const path = `scenes.scene_${scene.number}`, entry = result.scenes[`scene_${scene.number}`]
        checkShot(entry.first_shot, `${path}.first_shot`, roles)
        total += entry.first_shot.duration
        let previous = scene.first_line
        for (const [index, item] of entry.cuts.entries()) {
          if (item.start_line <= previous || item.start_line > scene.last_line) throw invalid(`${path}.cuts[${index}].start_line`, `须在 ${previous + 1}–${scene.last_line} 行`)
          checkShot(item, `${path}.cuts[${index}]`, roles); previous = item.start_line; total += item.duration
        }
      }
      if (input.duration_range && (total < input.duration_range.min || total > input.duration_range.max)) throw invalid('scenes', `镜头总时长 ${total} 秒，导演要求 ${input.duration_range.min}–${input.duration_range.max} 秒；${total < input.duration_range.min ? `至少增加 ${input.duration_range.min - total} 秒` : `至少减少 ${total - input.duration_range.max} 秒`}，须调整镜头时长或在本场剧本行切镜`)
    }
  }
  return result
}
