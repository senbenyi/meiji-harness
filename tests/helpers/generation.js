import { authoredGeneration, scriptFingerprint, IMAGE_DETAILS, VIDEO_DETAILS } from '../../lib/prompts/specification.js'

export function generation(purpose = 'image', prompt = 'A detective in a blue coat waits in a sunlit station, medium shot, realistic lighting, preserve identity and layout.') {
  const fields = purpose === 'video' ? VIDEO_DETAILS : IMAGE_DETAILS
  return { prompt, negativePrompt: '', details: Object.fromEntries(fields.map((key) => [key, `${key}: ${prompt}`])) }
}

export function authorFixture(project) {
  for (const collection of ['characters', 'locations', 'props', 'assetVariants']) for (const entity of Object.values(project[collection] || {})) {
    entity.scriptRefs = Object.values(project.episodes || {}).filter((ep) => ep.id !== 'legacy-main').map((ep) => ({ episodeId: ep.id, fingerprint: scriptFingerprint(ep) }))
    entity.generation = authoredGeneration(project, entity, 'image', generation(), null, 'assets')
  }
  for (const shot of Object.values(project.shots || {})) {
    shot.imageGeneration = authoredGeneration(project, shot, 'image', generation(), null, 'storyboard')
    shot.videoGeneration = authoredGeneration(project, shot, 'video', generation('video', shot.prompt), null, 'shot')
  }
  return project
}

export function extractedAssets(characters, locations, episodeId, quote) {
  const withPrompt = (entity) => ({ ...entity, usages: [{ episodeId, quote }], generation: generation('image', `${entity.name}. ${entity.description}. Neutral reference image, realistic style, soft daylight, stable appearance, no text.`) })
  return { characters: characters.map(withPrompt), locations: locations.map(withPrompt), props: [], assetVariants: [] }
}

export function promptResponse(task) {
  const context = JSON.parse(task.prompt.split('上下文：')[1].split('\n上次结果')[0])
  return generation(task.label.startsWith('video-') ? 'video' : 'image', context.shots[0].prompt)
}
