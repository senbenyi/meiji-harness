// 操作：打开项目
import { linkStore } from '../../../data/workspace-links.js'

// if (operation.action === 'open')
export async function opOpen(c) {
  let { operation, deps, home, projects, trace, note } = c
  const title = String(operation.title || '').trim()
  const matches = (await projects.list()).filter(item => item.title === title)
  if (matches.length !== 1) {
    throw Object.assign(new Error(matches.length ? '有多部同名短剧，请在工作区目录里点开其中一部' : '没有找到这部短剧，请从工作区目录里选择'), { status: 404 })
  }
  await linkStore(home, deps.workspaceController).ensureProject(matches[0].id, projects)
  note(`请在片库选择《${matches[0].title}》，进入它的专属工作区`)
  return trace
}

export const operations = {
  open: { label: '打开项目', scope: 'project', agent: true, stage: 'pre', run: opOpen },
}
