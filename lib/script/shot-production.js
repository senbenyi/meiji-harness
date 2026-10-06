import { generationSchema, validateGeneration, scriptFingerprint } from '../prompts/specification.js'
import { shotPlanFingerprint } from '../domain/creative.js'

export function shotPromptRequests(project, episode) {
  const context = JSON.stringify({ script: episode.script, visualStyle: project.storyBible?.visualStyle,
    shots: episode.shotIds.map((id) => project.shots[id]), characters: project.characters, locations: project.locations, props: project.props, variants: project.assetVariants })
  return [['image', 'storyboard'], ['video', 'shot']].map(([purpose, role]) => ({
    label: `${purpose}-prompts:${episode.id}`, role, phase: purpose === 'image' ? '分镜图片提示词' : '镜头视频提示词',
    schema: { type: 'object', additionalProperties: false, required: ['shots'], properties: { shots: { type: 'array', items: {
      type: 'object', additionalProperties: false, required: ['id', 'generation'], properties: { id: { type: 'string' }, generation: generationSchema(purpose) },
    } } } },
    validate(value) {
      if (JSON.stringify(value?.shots?.map((s) => s.id).sort()) !== JSON.stringify([...episode.shotIds].sort())) throw new Error('提示词镜头清单存在缺项、重复或越界')
      value.shots.forEach((s) => validateGeneration(s.generation, purpose))
    },
    prompt: `只为已定镜头编写${purpose === 'image' ? '单帧静态图片提示词，写清角色/道具状态、空间构图、机位和光照，不写声音或多帧动作' : '动态视频提示词，写清起始状态、动作时间顺序、运动机位、结束状态、衔接、说话人与逐字对白和声音；不凭空增删对白'}。每镜独立完整 generation.prompt，展开 details 全部内容，不用占位符，不改变镜头 id、顺序、时长或资产引用。无对白或声音时明确说明。上下文：${context}`,
  }))
}

export function mergeShotPrompts(project, episode, images, videos) {
  return { episodeId: episode.id, scriptFingerprint: scriptFingerprint(episode), shotFingerprint: shotPlanFingerprint(project, episode),
    shots: episode.shotIds.map((id) => ({ id, imageGeneration: images.shots.find((s) => s.id === id).generation, videoGeneration: videos.shots.find((s) => s.id === id).generation })) }
}
