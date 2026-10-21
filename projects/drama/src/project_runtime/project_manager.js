import { ProjectModel, readProjectFile } from './project_model.js'

function invalid(path, message) {
  throw Object.assign(new TypeError(`${path}：${message}`), { code: 'INVALID_PROJECT', path })
}

/** 项目数据只经这里修改；调用 model.update() 才写入本地 JSON。 */
export class ProjectManager {
  #model

  constructor(model) {
    if (!(model instanceof ProjectModel)) invalid('model', '需为 ProjectModel')
    this.#model = model
  }

  static async open(file) {
    const { file: path, project } = await readProjectFile(file)
    return new ProjectManager(new ProjectModel(path, project))
  }

  get model() {
    return this.#model
  }

  read() {
    return this.#model.read()
  }

  change(mutate) {
    if (typeof mutate !== 'function') invalid('change', '需为函数')
    const draft = this.#model.read()
    mutate(draft)
    this.#model.replace(draft)
    return this.read()
  }
}
