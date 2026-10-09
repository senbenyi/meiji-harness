import { characterImageGenerationModel, characterImageModificationModel } from './interfaces/character-image-interface.js'

// 一次请求只画一套服装；不把整个衣橱发给图片模型。
export function characterWardrobePrompts(item, project, { canvas, instruction = '', referenceBase64 = [] } = {}) {
  if (item.type !== 'role') return []
  return (item.costumes || []).map(costume => {
    const character = { ...item, costume: costume.description }
    const images = referenceBase64.map((base64, index) => ({ base64, purpose: instruction && index === 0 ? 'edit-base' : 'character-reference' }))
    const model = instruction ? characterImageModificationModel(character, project, { canvas, images, instruction: `${instruction}\n本次服装：${costume.description}。保持人物身份与面容一致。` })
      : characterImageGenerationModel(character, project, { canvas, images })
    return { id: costume.id, description: costume.description, prompt: model.toPrompt() }
  })
}
