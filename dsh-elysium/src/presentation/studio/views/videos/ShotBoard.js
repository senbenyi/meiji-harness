import { ActionButton } from '../../components/ActionButton.js'
import { Breadcrumb } from '../../components/Breadcrumb.js'
import { EmptyState } from '../../components/EmptyState.js'
import { ShotRow } from '../../components/ShotRow.js'
import { StatusBadge } from '../../components/StatusBadge.js'
import { createImageImportButton } from '../../components/ImageImportButton.js'

function nameOf(items, id) {
  return (items || []).find(item => item.id === id)?.name || id || ''
}

export function createShotBoard(React, api) {
  const h = React.createElement
  const ImageImportButton = createImageImportButton(React)

  function shotAction(shot, busy, actions) {
    if (shot.imagePath && !['image_queued', 'video_queued'].includes(shot.status)) {
      const regenerate = shot.status === 'video_ready' || (shot.status === 'failed' && shot.failedStage === 'video')
      return ActionButton(h, {
        label: regenerate ? '🔄 重新生成视频' : '▶ 生成视频',
        disabled: busy,
        onClick: () => actions.onGenerateVideo(shot.id),
      })
    }
    if (shot.status === 'draft' || shot.status === 'prompt_ready' || (shot.status === 'failed' && shot.failedStage === 'image')) {
      return h(ImageImportButton, {
        label: shot.imagePath ? '替换首帧' : '导入首帧',
        busy,
        onSelect: file => actions.onImportImage(shot.id, file),
      })
    }
    return null
  }

  return function ShotBoardView({ projectId, plan, busy, navigate, onImportImage, onGenerateVideo, onRetry }) {
    const characters = plan?.characters || []
    const scenes = plan?.scenes || []
    const shots = plan?.shots || []
    return h('div', null,
      Breadcrumb(h, {
        title: '分镜',
        onBack: () => navigate('dashboard', projectId),
        action: ActionButton(h, { label: '▶ 全部生成', disabled: true, title: '即将支持：批量生成' }),
      }),
      shots.length === 0
        ? EmptyState(h, { children: '暂无分镜' })
        : shots.map(shot => ShotRow(h, {
          shot,
          projectId,
          mediaUrl: api.mediaUrl,
          characterNames: (shot.characterIds || []).map(id => nameOf(characters, id)).join(', '),
          sceneName: nameOf(scenes, shot.sceneId),
          statusBadge: StatusBadge(h, { status: shot.status }),
          action: shotAction(shot, busy, { onImportImage, onGenerateVideo, onRetry }),
          onDetails: () => navigate('shot', projectId, { shotId: shot.id }),
        })),
    )
  }
}
