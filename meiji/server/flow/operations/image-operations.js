// 兼容出口：实现已拆分到 tasks/、actions/、shared/ 下的独立文件（阶段 2 结束后删除本文件）。
export { imageSeed, generateStillFile, submitAssetImage, importAssetImage, saveCharacterReference, visualPlace, stageImageDraft } from './shared/image-files.js'
export { startImage } from './tasks/asset-image.js'
export { submitPencilBoard } from './tasks/pencil.js'
