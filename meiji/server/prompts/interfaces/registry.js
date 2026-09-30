// 仅选择接口，不提供默认模板，也不补充语言、技能或协议。
import episode from './episode.js'
import outline from './outline.js'
import shots from './shots.js'
import shotRevise from './shot-revise.js'
import seconds from './seconds.js'
import storyboard from './storyboard.js'
import imagePrompt from './image-prompt.js'
import characterImage from './character-image.js'
import sceneImage from './scene-image.js'
import partImage from './part-image.js'
import pencil from './pencil.js'

const textInterfaces = { episode, outline, shots, 'shot-revise': shotRevise, seconds, storyboard, 'image-prompt': imagePrompt }
const imageInterfaces = { 'character-image': characterImage, 'scene-image': sceneImage, 'part-image': partImage, pencil }

export function textInterface(stage) {
  if (!Object.hasOwn(textInterfaces, stage)) throw new Error(`未定义文本接口提示词：${stage}`)
  return textInterfaces[stage]
}

function imageInterface(stage) {
  if (!Object.hasOwn(imageInterfaces, stage)) throw new Error(`未定义图片接口提示词：${stage}`)
  return imageInterfaces[stage]
}

export function imageSegments(args) {
  return imageInterface(args.stage).generate(args)
}

export function imagePreviewSegments(args) {
  const api = imageInterface(args.stage)
  return (api.preview || api.generate)(args)
}
