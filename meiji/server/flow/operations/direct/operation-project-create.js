// 操作：创建项目
import { linkStore } from '../../../data/workspace-links.js'

// if (operation.action === 'create')
export async function opCreate(c) {
  let { operation, deps, home, projects, trace, note } = c
  const created = await projects.create(operation.fields)
  await linkStore(home, deps.workspaceController).ensureProject(created.id, projects)
  note(`请在片库选择《${created.title}》，进入它的专属工作区`)
  note(`已创建项目 ${created.title}`)
  note(`编号 ${created.id}，画幅 ${created.aspectRatio}${created.style ? `，风格 ${created.style}` : ''}`)
  trace.result = { projectId: created.id }
  note('下一步是在项目概要里添加剧集')
  return trace
}

export const operations = {
  create: { label: '创建项目', scope: 'project', agent: true, stage: 'pre', run: opCreate },
}
