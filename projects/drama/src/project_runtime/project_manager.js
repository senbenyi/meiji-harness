import { ProjectModel, readProjectFile } from './project_model.js'
import { createNode } from '../node_runtime/node_initializer.js'

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
    // 读取旧项目时只补内存；下一次业务保存才落盘，不改已有私有规则。
    if (project.character_extraction && !project.group_setting) {
      project.group_setting = await createNode('group_setting')
      const groups = project.character_extraction.groups || []
      if (groups.length) {
        project.group_setting.groups = structuredClone(groups)
        Object.assign(project.group_setting.node_state, { status: 'expired', reason: '从旧角色资料保留，需执行团队设定独立审核' })
      }
    }
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
