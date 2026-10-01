import { PencilImageModel } from '../models/pencil-image-model.js'
export default { generate: task => new PencilImageModel(task).toGenerateSegments() }
