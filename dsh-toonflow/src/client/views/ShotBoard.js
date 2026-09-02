import { ActionButton } from '../components/ActionButton.js'
import { Breadcrumb } from '../components/Breadcrumb.js'
import { EmptyState } from '../components/EmptyState.js'
import { ShotRow } from '../components/ShotRow.js'
import { StatusBadge } from '../components/StatusBadge.js'

function nameOf(items, id) {
  return (items || []).find(item => item.id === id)?.name || id || ''
}

export function createShotBoard(React, api) {
  const h = React.createElement

  function shotAction(shot) {
    if (shot.status === 'draft' || shot.status === 'prompt_ready') {
      return ActionButton(h, { label: '▶ 生成首帧', disabled: true, title: '即将支持' })
    }
    if (shot.status === 'image_ready') {
      return ActionButton(h, { label: '▶ 生成视频', disabled: true, title: '即将支持' })
    }
    if (shot.status === 'failed' && (shot.retryCount || 0) < 3) {
      return ActionButton(h, { label: `🔄 重试 (${shot.retryCount || 0}/3)`, disabled: true, title: '即将支持' })
    }
    return null
  }

  return function ShotBoardView({ projectId, plan, navigate }) {
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
          action: shotAction(shot),
          onDetails: () => navigate('shot', projectId, { shotId: shot.id }),
        })),
    )
  }
}
