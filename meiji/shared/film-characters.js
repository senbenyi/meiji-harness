import { entityCatalog, entityMention, collapseMentions } from './entity-references.js'

// 只以已通过的最终指令提取；整集统一身份，单镜成片也复用同一份来源。
export function filmCharacterSource(project) {
  return (project.shots?.items || []).filter(shot => shot.seconds?.check?.passed === true && shot.seconds.content)
    .map(shot => ({ shotId: shot.id, ...shot.seconds.content }))
}
// 本集清单由AI逐镜返回；任一历史指令无清单时保留旧提取方式。
export function filmParticipants(project) {
  const sources = filmCharacterSource(project)
  if (sources.some(source => !Array.isArray(source.participants))) return null
  const people = new Map()
  for (const source of sources) for (const person of source.participants) {
    if (!people.has(person.name) || person.presence === 'visible') people.set(person.name, { name:person.name, presence:person.presence })
  }
  return [...people.values()]
}
export const filmCharacterBasis = project => JSON.stringify(filmCharacterSource(project))
export const filmCharactersReady = project => project.plot?.characters?.check?.passed === true && project.plot.characters.secondsSource === filmCharacterBasis(project)

// 在编译副本中绑定名称，长名称优先，已有标记不重复替换；不扫描台词原文。
export function bindNamedText(text, project, entities = entityCatalog(project)) {
  const names = new Map()
  for (const entity of entities) for (const name of new Set([entity.name, entity.card.sourceName].filter(Boolean))) {
    if (names.has(name) && names.get(name).id !== entity.id) throw new Error('人物或实体名称重复，无法绑定成片参考图')
    names.set(name, entity)
  }
  if (!names.size) return String(text)
  const pattern = new RegExp([...names.keys()].sort((a, b) => b.length - a.length).map(name => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'gu')
  return collapseMentions(text, project).split(/(【[^【】]+】)/).map((part, index) => index % 2 ? part : part.replace(pattern, name => entityMention(names.get(name)))).join('')
}

export function bindSecondsCharacters(content, project, entities) {
  if (content.version !== 2) return content
  const result = structuredClone(content)
  result.summary = bindNamedText(result.summary, project, entities)
  for (const beat of result.beats) for (const field of ['action', 'camera', 'space', 'sound', 'endState']) beat[field] = bindNamedText(beat[field], project, entities)
  for (const events of [result.ambient, result.music]) for (const event of events) event.text = bindNamedText(event.text, project, entities)
  return result
}
