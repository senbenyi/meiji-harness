// 仅选择接口，不提供默认模板，也不补充语言、技能或协议。
import episode from './episode.js'
import outline from './outline.js'
import { stepInterface } from '../models/text-step-model.js'
import { TextStoryboardModel } from '../models/text-storyboard-model.js'
import characterImage from './character-image.js'
import sceneImage from './scene-image.js'
import partImage from './part-image.js'
import pencil from './pencil.js'

// 镜头表、每秒指令、单镜修订、图片提示词改写共用 TextStepModel；文本分镜由程序生成，模型只审核。
const textInterfaces = {
  episode, outline,
  shots: stepInterface(() => 'shots'),
  'shot-revise': stepInterface(() => 'shot-revise'),
  seconds: stepInterface(task => task.shotId ? 'shot-seconds' : 'episode-seconds'),
  'image-prompt': stepInterface(() => 'image-prompt'),
  storyboard: { review: (task, content) => new TextStoryboardModel(task).toReviewSegments(content) },
}
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
