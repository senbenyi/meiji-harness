import { ENTITY_COLLECTIONS, generationSchema, groundedGenerationFallback, validateGeneration, scriptFingerprint } from '../prompts/specification.js'
import { shotPlanFingerprint } from '../domain/creative.js'

export function shotPromptRequests(project, episode) {
  const shots = episode.shotIds.map((id) => project.shots[id])
  const assets = Object.fromEntries(Object.entries(ENTITY_COLLECTIONS).map(([kind, collection]) => [collection,
    Object.values(project[collection] || {}).filter((entity) => !entity.retired && shots.some((shot) => shot.referenceBindings?.some((binding) => binding.kind === kind && binding.entityId === entity.id)))
      .map(({ id, name, description, parentId, changes, preserve, generation }) => ({ id, name, description, parentId, changes, preserve, generation }))]))
  const plan = shots.map(({ id, order, duration, shotDescription, prompt, audioDialogue, audioNotes, referenceBindings }) => ({ id, order, duration, shotDescription, prompt, audioDialogue, audioNotes, referenceBindings: referenceBindings?.map(({ kind, entityId }) => ({ kind, entityId })) }))
  return [['image', 'storyboard'], ['video', 'shot']].flatMap(([purpose, role]) => plan.map((shot, index) => ({
    label: `${purpose}-prompts:${episode.id}:${shot.id}`, role, purpose, shotId: shot.id, phase: purpose === 'image' ? '分镜图片提示词' : '镜头视频提示词',
    schema: generationSchema(purpose), validate: (value) => validateGeneration(value, purpose),
    fallback: () => groundedGenerationFallback(purpose, purpose === 'image' ? {
      subject: shot.title,
      description: shot.shotDescription || shot.prompt,
      composition: `保持镜头 ${shot.id} 的既定景别、机位和资产引用`,
      constraints: `只表现当前单帧；引用 ${JSON.stringify(shot.referenceBindings || [])}`,
    } : {
      subject: shot.title,
      description: shot.shotDescription || shot.prompt,
      action: shot.prompt || shot.shotDescription,
      camera: `保持镜头 ${shot.id} 的既定机位与运动`,
      timing: `在 ${shot.duration} 秒内完成`,
      continuity: `保持引用 ${JSON.stringify(shot.referenceBindings || [])}，衔接前后镜头`,
      sound: [shot.audioDialogue, shot.audioNotes].filter(Boolean).join('；') || '无额外声音',
    }),
    prompt: `只为当前一个镜头编写完整中文${purpose === 'image' ? '单帧静态图片提示词，写清角色/道具状态、空间构图、机位和光照，不写声音或多帧动作' : '动态视频提示词，写清起始状态、动作时间顺序、运动机位、结束状态、衔接、说话人与逐字对白和声音；不凭空增删对白'}。直接返回 prompt、negativePrompt、details，不包装 shots 或 generation 数组。展开 details 全部内容，不用占位符，不改变镜头顺序、时长或资产引用。无对白或声音时明确说明。上下文：${JSON.stringify({ script: episode.script, visualStyle: project.storyBible?.visualStyle, shots: [shot], previous: plan[index - 1]?.shotDescription, next: plan[index + 1]?.shotDescription, ...Object.fromEntries(Object.entries(assets).map(([collection, entities]) => [collection, entities.filter((entity) => shot.referenceBindings?.some((binding) => binding.entityId === entity.id))])) })}`,
  })))
}

export function mergeShotPromptResults(project, episode, requests, values) {
  const rows = (purpose) => ({ shots: requests.flatMap((request, index) => request.purpose === purpose ? [{ id: request.shotId, generation: values[index] }] : []) })
  return mergeShotPrompts(project, episode, rows('image'), rows('video'))
}

export function mergeShotPrompts(project, episode, images, videos) {
  return { episodeId: episode.id, scriptFingerprint: scriptFingerprint(episode), shotFingerprint: shotPlanFingerprint(project, episode),
    shots: episode.shotIds.map((id) => ({ id, imageGeneration: images.shots.find((s) => s.id === id).generation, videoGeneration: videos.shots.find((s) => s.id === id).generation })) }
}
