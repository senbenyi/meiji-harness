// 操作：保存项目概要
import { linkStore } from '../../../data/workspace-links.js'
import { overviewPatch } from '../../../../shared/episode-rules.js'
import { saveStep } from '../../../../shared/task-plans.js'

// if (operation.action === 'overview')
export async function opOverview(c) {
  let { operation, deps, home, rootProjects, project, trace, note } = c
  const saved = await rootProjects.save(project.id, overviewPatch(project, operation.fields))
  if (saved.workspaceId && deps.workspaceController) await linkStore(home, deps.workspaceController).ensureProject(saved.id, rootProjects)
  note(`已保存项目概要：${saved.title}`)
  note(`画幅 ${saved.aspectRatio}`)
  if (saved.style) note(`风格 ${saved.style}`)
  note(saved.summary.content)
  return trace
}

export const operations = {
  overview: { label: '保存项目概要', scope: 'project', lock: 'project', agent: false, step: saveStep(null), stage: 'project', run: opOverview },
}
