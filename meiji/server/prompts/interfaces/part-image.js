import { PartImageModel } from '../models/part-image-model.js'
export default { generate: task => new PartImageModel(task).toGenerateSegments() }
