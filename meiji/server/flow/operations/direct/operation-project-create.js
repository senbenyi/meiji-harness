// 操作：创建项目
import { linkStore } from '../../../data/workspace-links.js'

// if (operation.action === 'create')
export async function opCreate(c) {
  let { operation, deps, home, projects, library, trace, note } = c
  let fields = { ...operation.fields }
  if (fields.scriptAssetId) {
    const script = await library.script(fields.scriptAssetId)
    fields = { ...fields, script: script.content, scriptName: script.originalName }
  }
  delete fields.summary
  const created = await projects.create(fields)
  await linkStore(home, deps.workspaceController).ensureProject(created.id, projects)
  note(`已创建项目 ${created.title}`)
  note(`编号 ${created.id}，画幅 ${created.aspectRatio}${created.style ? `，风格 ${created.style}` : ''}`)
  trace.result = { projectId: created.id }
  note('下一步是在项目概要里添加剧集')
  return trace
}

export const operations = {
  create: { label: '创建项目', scope: 'project', agent: true, stage: 'pre', run: opCreate },
}
