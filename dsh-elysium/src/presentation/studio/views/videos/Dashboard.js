import { ActionButton } from '../../components/ActionButton.js'
import { Breadcrumb } from '../../components/Breadcrumb.js'
import { CharacterCard } from '../../components/CharacterCard.js'
import { EmptyState } from '../../components/EmptyState.js'
import { ProgressBar } from '../../components/ProgressBar.js'
import { StatusBadge } from '../../components/StatusBadge.js'
import { createImageImportButton } from '../../components/ImageImportButton.js'

export function createDashboard(React, api) {
  const h = React.createElement
  const ImageImportButton = createImageImportButton(React)
  return function Dashboard({ projectId, plan, busy, navigate, onImportCharacterImage }) {
    const project = plan?.project
    const characters = plan?.characters || []
    const scenes = plan?.scenes || []
    const shots = plan?.shots || []
    const done = shots.filter(shot => shot.status === 'video_ready').length
    if (!project) return EmptyState(h, { children: '项目不存在' })

    return h('div', null,
      Breadcrumb(h, { title: project.title, onBack: () => navigate('list') }),
      h('div', { className: 'tf-section' },
        h('div', { className: 'tf-section-head' },
          h('span', { className: 'tf-section-title' }, `角色 (${characters.length})`),
        ),
        h('div', { className: 'tf-grid' }, characters.map(character => CharacterCard(h, {
          character,
          projectId,
          mediaUrl: api.mediaUrl,
          generateButton: h(ImageImportButton, {
            label: character.imagePath ? '替换角色图' : '导入角色图',
            busy,
            ghost: true,
            onSelect: file => onImportCharacterImage(character.id, file),
          }),
        }))),
      ),
      h('div', { className: 'tf-section' },
        h('div', { className: 'tf-section-head' },
          h('span', { className: 'tf-section-title' }, `场景 (${scenes.length})`),
        ),
        h('div', { className: 'tf-grid' }, scenes.map(scene =>
          h('div', { key: scene.id, className: 'tf-thumb' },
            scene.imagePath
              ? h('img', { className: 'tf-thumb-img', src: api.mediaUrl(projectId, scene.imagePath), alt: scene.name })
              : h('div', { className: 'tf-thumb-img' }, '🏞'),
            h('div', { className: 'tf-thumb-label' }, scene.name),
          ),
        )),
      ),
      h('div', { className: 'tf-section' },
        h('div', { className: 'tf-section-head' },
          h('span', { className: 'tf-section-title' }, `分镜 (${shots.length})`),
          h('button', { className: 'tf-section-link', onClick: () => navigate('shots', projectId) }, '进入分镜 →'),
        ),
        h('div', { className: 'tf-grid' }, shots.map(shot =>
          h('div', {
            key: shot.id,
            className: 'tf-thumb tf-thumb-badge',
            onClick: () => navigate('shots', projectId),
          },
          shot.imagePath
            ? h('img', { className: 'tf-thumb-img', src: api.mediaUrl(projectId, shot.imagePath), alt: `#${shot.order}` })
            : h('div', { className: 'tf-thumb-img' }, '📷'),
          StatusBadge(h, { status: shot.status }),
          h('div', { className: 'tf-thumb-label' }, `#${shot.order}`)),
        )),
        ProgressBar(h, { done, total: shots.length }),
        h('div', { className: 'tf-card-meta' }, `${done}/${shots.length} 镜头完成`),
      ),
      h('div', { className: 'tf-btn-row' },
        ActionButton(h, { label: '▶ 批量生成', disabled: true, title: '即将支持：批量生成所有就绪镜头' }),
        ActionButton(h, { label: '📦 导出 MP4', disabled: true, ghost: true, title: '即将支持：拼接成片' }),
      ),
    )
  }
}
