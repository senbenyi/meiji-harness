import { ActionButton } from '../components/ActionButton.js'
import { EmptyState } from '../components/EmptyState.js'
import { ProgressBar } from '../components/ProgressBar.js'
import { ProjectCard } from '../components/ProjectCard.js'

export function createProjectList(React) {
  const h = React.createElement
  return function ProjectList({ projects, loading, busy, onSelect, onCreate, onDelete }) {
    return h('div', null,
      h('div', { className: 'tf-header' },
        h('span', { className: 'tf-title' }, 'Toonflow'),
        ActionButton(h, { label: '+ 新建', disabled: busy, onClick: onCreate }),
      ),
      loading
        ? EmptyState(h, { children: '正在加载…' })
        : projects.length === 0
          ? EmptyState(h, { children: '暂无项目，点击「+ 新建」开始' })
          : projects.map(project => ProjectCard(h, {
            project,
            busy,
            progressBar: ProgressBar(h, { done: project.shotsDone, total: project.shotsTotal }),
            onSelect: () => onSelect(project.id),
            onDelete: () => onDelete(project),
          })),
    )
  }
}
