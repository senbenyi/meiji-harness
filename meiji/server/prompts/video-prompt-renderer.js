import { characterSheet } from '../../shared/character-facts.js'
import { resolveStoryboardProject } from '../../shared/storyboard-characters.js'
import { bindSecondsCharacters } from '../../shared/film-characters.js'
import { collapseMentions, entityCatalog, referencePattern } from '../../shared/entity-references.js'
import { validateSeconds, secondsRange, narratorId, secondsCharacterRoster } from '../../shared/seconds-content.js'
import { pictureOf } from '../../shared/drama-model.js'
import { costumePicture } from '../../shared/character-costumes.js'
import { previousTail, tailFrameUrl } from '../../shared/tail-frame.js'

// 唯一视频提示词编译入口：不请求模型、不改写动作与台词。
export function compileVideoPrompt(project, shot) {
  project = resolveStoryboardProject(project, shot)
  // 先从原始每秒分镜提取本镜画面实体及画内说话人，再引入它们的资料与引用。
  const entities = validateSeconds(shot.seconds.content, shot, project)
  for (const person of shot.seconds.content.participants || []) {
    if (!entityCatalog(project).some(entity => entity.kind === 'character' && (entity.name === person.name || entity.card.sourceName === person.name))) throw new Error(`${person.presence === 'visible' ? '出镜' : '仅声音'}人物未提取：${person.name}`)
  }
  const content = bindSecondsCharacters(shot.seconds.content, project, entities)
  const catalog = new Map(entityCatalog(project).map(e => [e.id, e]))
  const roster = secondsCharacterRoster(project)
  const images = [], subjects = new Map(), bindings = new Map()
  const subjectEntity = e => (e.kind === 'clothes' || e.kind === 'hairstyles') && catalog.get(e.ownerId)?.kind === 'character' ? catalog.get(e.ownerId) : e
  const addPicture = (entity, subjectId) => {
    let picture = pictureOf(entity.card), costume
    if (entity.kind === 'character' && entity.card.costumes?.length) {
      const person = content.participants?.find(person => person.name === entity.name || person.name === entity.card.sourceName)
      costume = entity.card.costumes.find(row => row.id === person?.costumeId)
      if (!costume) throw new Error(`${shot.id} 人物「${entity.name}」未选择有效服装 ID，请补齐每秒指令的 costumeId`)
      picture = costumePicture(costume, picture)
      if (!picture?.localPath) throw new Error(`${shot.id} 人物「${entity.name}」的「${costume.name}」穿搭图缺失或已过期，请先完成人物图片生成`)
    }
    if (!picture.localPath) return
    const key = picture.assetId || picture.localPath
    let image = images.find(i => (i.assetId || i.url) === key)
    if (!image) {
      image = { id: entity.card.id, entityId: entity.id, kind: entity.kind, label: costume ? `${entity.name} · ${costume.name}` : entity.name, ...(costume ? { costumeId: costume.id } : {}), url: picture.localPath, localPath: picture.localPath, assetId: picture.assetId || null, assetCategory: picture.assetCategory || null, subjectIds: [] }
      images.push(image)
    }
    if (!image.subjectIds.includes(subjectId)) image.subjectIds.push(subjectId)
  }
  for (const entity of entities) {
    const subject = subjectEntity(entity)
    if (!subjects.has(subject.id)) subjects.set(subject.id, subjects.size + 1)
    bindings.set(entity.id, subjects.get(subject.id))
    addPicture(entity, subjects.get(subject.id))
    if (subject !== entity) addPicture(subject, subjects.get(subject.id))
  }
  const tail = previousTail(project, shot.id)
  if (tail) images.push({ kind: 'tailFrame', label: `上一镜 ${tail.sourceShotId} 尾帧`, url: tailFrameUrl(tail.sourceVideoFile), sourceShotId: tail.sourceShotId, sourceVideoFile: tail.sourceVideoFile, subjectIds: [] })
  if (images.length > 9) throw new Error('本镜实际引用及尾帧超过9张图片')
  const mode = images.length ? 'reference' : 'text'
  const substitute = value => collapseMentions(value, project).replace(referencePattern(), (_, name, id) => mode === 'reference' && bindings.has(id) ? `<Subject ${bindings.get(id)}>（${name}）` : name)
  const visualLook = entity => {
    const person = content.participants?.find(person => person.presence === 'visible' && person.outfit && (person.name === entity.name || person.name === entity.card.sourceName))
    if (!person) return entity.card.look || entity.card.description || entity.name
    return characterSheet(entity.card).filter(([label,value]) => value && !['服装','声音特征'].includes(label)).map(([label,value]) => `${label}：${value}`).join('；') || entity.name
  }
  const sourceMap = [], lines = []
  const field = (name, text, sources) => { lines.push(`${name}:\n${text}`); sourceMap.push({ field: name, sources }) }
  if (mode === 'reference') {
    const definitions = [...subjects].map(([id, n]) => {
      const e = catalog.get(id), refs = images.flatMap((image, i) => image.subjectIds.includes(n) ? [`<Picture ${i + 1}>（${image.label}）`] : [])
      return `<Subject ${n}>：${e.name}；${refs.length ? refs.join('、') : `无参考图，文字设定：${visualLook(e)}`}`
    })
    images.forEach((image, i) => { if (image.kind === 'tailFrame') definitions.push(`<Picture ${i + 1}>：前镜连续性参考，不是新增人物；仅承接上游明确的状态，场景和机位以本镜为准。`) })
    field('subject_definitions', definitions.join('\n'), [...subjects.keys()])
    field('summary', substitute(content.summary), [content.shotId, 'summary'])
    field('retention_analysis', images.map((image, i) => `<Picture ${i + 1}>：${image.kind === 'tailFrame' ? '核对前镜已发生的末态，不重演动作；不以旧背景或裁切替代本镜。' : `${image.label}仅提供对应实体的已确认外观${image.kind === 'scene' ? '与环境特征' : ''}，姿势、位置和变化服从本镜分镜，不照搬无关背景。`}`).join('\n'), images.map(i => i.entityId || i.sourceShotId))
  }
  let start = 0, cut = 0
  const details = [], speakers = new Map(), dialogueSpeakers = new Map()
  const speakerName = id => id === narratorId ? '旁白' : catalog.get(id)?.name || id
  if (content.participants) {
    const people = entities.filter(entity => entity.kind === 'character')
    if (people.length) details.push('本镜出镜角色：' + people.map(entity => {
      const name = substitute(`【${entity.name}|${entity.id}】`)
      return pictureOf(entity.card).localPath ? name : `${name}（文字外观：${visualLook(entity)}）`
    }).join('；'))
  }
  const outfitSnapshot = (content.participants || []).filter(person => person.presence === 'visible' && person.outfit).map(person => ({name:person.name,outfit:person.outfit,...(person.costumeId ? {costumeId:person.costumeId} : {})}))
  if (outfitSnapshot.length) {
    details.push('本镜着装（已选穿搭图确定人物与服装外观；穿脱、破损等动态变化以本镜描述及动作过程为准）：' + outfitSnapshot.map(person => {
      const entity = entities.find(entity => entity.kind === 'character' && (entity.name === person.name || entity.card.sourceName === person.name))
      return `${entity ? substitute(`【${entity.name}|${entity.id}】`) : person.name}：${person.outfit}`
    }).join('；'))
    sourceMap.push({field:mode === 'reference' ? 'detailed_description' : 'integrated_multimodal_description',sources:['participants.outfit']})
  }
  for (const b of content.beats) {
    if (!cut || b.transition === 'cut') cut++
    details.push(`[Shot ${cut}] ${secondsRange(start, start + b.durationMs)}\n动作：${substitute(b.action)}\n镜头：${substitute(b.camera)}\n空间：${substitute(b.space)}\n同步声音：${substitute(b.sound)}`)
    for (const id of b.dialogueIds) {
      const original = content.dialogues.find(d => d.id === id)
      const speaker = content.version === 2
        ? catalog.get(project.plot.characters.items[roster.findIndex(person => person.name === original.speakerName || person.aliases.includes(original.speakerName))]?.id)
        : catalog.get(original.speakerId)
      const d = { ...original, speakerId: speaker?.id || original.speakerId || original.speakerName }
      const visualSpeaker = d.delivery === 'on' && speaker ? substitute(`【${speaker.name}|${speaker.id}】`) : speakerName(d.speakerId)
      dialogueSpeakers.set(original.id, d.speakerId)
      if (!speakers.has(d.speakerId)) speakers.set(d.speakerId, speakers.size + 1)
      details.push(`${secondsRange(d.startMs, d.endMs)} ${visualSpeaker} (S${speakers.get(d.speakerId)})，${d.speakerId === narratorId ? '独立画外旁白，不对口型' : { on: '画内', off: '画外', inner: '内心独白，不对口型' }[d.delivery]}，${d.performance}：<d>${d.language}: ${d.text}</d>`)
    }
    // 只记录已完成的状态，不添加后镜计划。
    details.push(`${b === content.beats.at(-1) ? '结尾状态' : '段末状态'}：${substitute(b.endState)}`)
    sourceMap.push({ field: 'detailed_description', beatId: b.id, dialogueIds: b.dialogueIds, startMs: start, endMs: start + b.durationMs })
    start += b.durationMs
  }
  field(mode === 'reference' ? 'detailed_description' : 'integrated_multimodal_description', details.join('\n\n'), content.beats.map(b => b.id))
  const voices = [...speakers].flatMap(([id, number]) => {
    const person = catalog.get(id)
    return person?.card.voiceDescription ? [`${speakerName(id)} (S${number})，固定声音特征：${person.card.voiceDescription}；当句表演按对应时段。`] : []
  })
  const characterSnapshot = [...catalog.values()].filter(entity => entity.kind === 'character' && (subjects.has(entity.id) || speakers.has(entity.id) || (content.participants || []).some(person => person.name === entity.name || person.name === entity.card.sourceName)))
    .map(entity => ({ id: entity.id, name: entity.name, sourceName: entity.card.sourceName || '', identity: entity.card.identity || '', look: entity.card.look || '', voiceDescription: entity.card.voiceDescription || '' }))
  field('overall_soundscape', [...voices, ...content.ambient.map(e => `${secondsRange(e.startMs, e.endMs)} ${substitute(e.text)}`), ...content.dialogues.map(d => `${secondsRange(d.startMs, d.endMs)} ${speakerName(dialogueSpeakers.get(d.id) || d.speakerId || d.speakerName)} (S${speakers.get(dialogueSpeakers.get(d.id) || d.speakerId || d.speakerName)})，${(d.speakerId || d.speakerName) === narratorId ? '旁白' : '对白'}见对应时段。`)].join('\n') || 'N/A（无额外持续声；同步声见对应时段）', ['ambient', ...content.dialogues.map(d => d.id)])
  field('non_diegetic_music', content.music.map(e => `${secondsRange(e.startMs, e.endMs)} ${substitute(e.text)}`).join('\n') || 'N/A', ['music'])
  return { prompt: { text: lines.join('\n\n') }, video: mode, referenceSnapshot: images, sourceMap,
    characterSnapshot, outfitSnapshot, secondsRevision: shot.seconds.revision, tailReference: tail ? { sourceShotId: tail.sourceShotId, sourceVideoFile: tail.sourceVideoFile } : null,
    characters: entities.filter(e => e.kind === 'character').map(e => e.name), scenes: entities.filter(e => e.kind === 'scene').map(e => e.name),
    entityIds: entities.map(e => e.id), openingReference: 'none', format: 'text', compilerVersion: 2 }
}
