import { collapseMentions, entityCatalog, referencePattern } from '../../shared/entity-references.js'
import { validateSeconds, secondsRange, narratorId } from '../../shared/seconds-content.js'
import { pictureOf } from '../../shared/drama-model.js'
import { previousTail, tailFrameUrl } from '../../shared/tail-frame.js'

// 唯一视频提示词编译入口：不请求模型、不改写动作与台词。
export function compileVideoPrompt(project, shot) {
  const content = shot.seconds.content
  const entities = validateSeconds(content, shot, project)
  const catalog = new Map(entityCatalog(project).map(e => [e.id, e]))
  const images = [], subjects = new Map(), bindings = new Map()
  const subjectEntity = e => (e.kind === 'clothes' || e.kind === 'hairstyles') && catalog.get(e.ownerId)?.kind === 'character' ? catalog.get(e.ownerId) : e
  const addPicture = (entity, subjectId) => {
    const picture = pictureOf(entity.card)
    if (!picture.localPath) return
    const key = picture.assetId || picture.localPath
    let image = images.find(i => (i.assetId || i.url) === key)
    if (!image) {
      image = { id: entity.card.id, entityId: entity.id, kind: entity.kind, label: entity.name, url: picture.localPath, localPath: picture.localPath, assetId: picture.assetId || null, assetCategory: picture.assetCategory || null, subjectIds: [] }
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
  const sourceMap = [], lines = []
  const field = (name, text, sources) => { lines.push(`${name}:\n${text}`); sourceMap.push({ field: name, sources }) }
  if (mode === 'reference') {
    const definitions = [...subjects].map(([id, n]) => {
      const e = catalog.get(id), refs = images.flatMap((image, i) => image.subjectIds.includes(n) ? [`<Picture ${i + 1}>（${image.label}）`] : [])
      return `<Subject ${n}>：${e.name}；${refs.length ? refs.join('、') : `无参考图，文字设定：${e.card.look || e.card.description || e.name}`}`
    })
    images.forEach((image, i) => { if (image.kind === 'tailFrame') definitions.push(`<Picture ${i + 1}>：前镜连续性参考，不是新增人物；仅承接上游明确的状态，场景和机位以本镜为准。`) })
    field('subject_definitions', definitions.join('\n'), [...subjects.keys()])
    field('summary', substitute(content.summary), [content.shotId, 'summary'])
    field('retention_analysis', images.map((image, i) => `<Picture ${i + 1}>：${image.kind === 'tailFrame' ? '核对前镜已发生的末态，不重演动作；不以旧背景或裁切替代本镜。' : `${image.label}仅提供对应实体的已确认外观${image.kind === 'scene' ? '与环境特征' : ''}，姿势、位置和变化服从本镜分镜，不照搬无关背景。`}`).join('\n'), images.map(i => i.entityId || i.sourceShotId))
  }
  let start = 0, cut = 0
  const details = [], speakers = new Map()
  const speakerName = id => id === narratorId ? '旁白' : catalog.get(id).name
  for (const b of content.beats) {
    if (!cut || b.transition === 'cut') cut++
    details.push(`[Shot ${cut}] ${secondsRange(start, start + b.durationMs)}\n动作：${substitute(b.action)}\n镜头：${substitute(b.camera)}\n空间：${substitute(b.space)}\n同步声音：${substitute(b.sound)}`)
    for (const id of b.dialogueIds) {
      const d = content.dialogues.find(d => d.id === id)
      if (!speakers.has(d.speakerId)) speakers.set(d.speakerId, speakers.size + 1)
      details.push(`${secondsRange(d.startMs, d.endMs)} ${speakerName(d.speakerId)} (S${speakers.get(d.speakerId)})，${d.speakerId === narratorId ? '独立画外旁白，不对口型' : { on: '画内', off: '画外', inner: '内心独白，不对口型' }[d.delivery]}，${d.performance}：<d>${d.language}: ${d.text}</d>`)
    }
    // 只记录已完成的状态，不添加后镜计划。
    details.push(`${b === content.beats.at(-1) ? '结尾状态' : '段末状态'}：${substitute(b.endState)}`)
    sourceMap.push({ field: 'detailed_description', beatId: b.id, dialogueIds: b.dialogueIds, startMs: start, endMs: start + b.durationMs })
    start += b.durationMs
  }
  field(mode === 'reference' ? 'detailed_description' : 'integrated_multimodal_description', details.join('\n\n'), content.beats.map(b => b.id))
  field('overall_soundscape', [...content.ambient.map(e => `${secondsRange(e.startMs, e.endMs)} ${substitute(e.text)}`), ...content.dialogues.map(d => `${secondsRange(d.startMs, d.endMs)} ${speakerName(d.speakerId)} (S${speakers.get(d.speakerId)})，${d.speakerId === narratorId ? '旁白' : '对白'}见对应时段。`)].join('\n') || 'N/A（无额外持续声；同步声见对应时段）', ['ambient', ...content.dialogues.map(d => d.id)])
  field('non_diegetic_music', content.music.map(e => `${secondsRange(e.startMs, e.endMs)} ${substitute(e.text)}`).join('\n') || 'N/A', ['music'])
  return { prompt: { text: lines.join('\n\n') }, video: mode, referenceSnapshot: images, sourceMap,
    secondsRevision: shot.seconds.revision, tailReference: tail ? { sourceShotId: tail.sourceShotId, sourceVideoFile: tail.sourceVideoFile } : null,
    characters: entities.filter(e => e.kind === 'character').map(e => e.name), scenes: entities.filter(e => e.kind === 'scene').map(e => e.name),
    entityIds: entities.map(e => e.id), openingReference: 'none', format: 'text', compilerVersion: 1 }
}
