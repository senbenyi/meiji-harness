import { ActionButton } from '../components/ActionButton.js'
import { Breadcrumb } from '../components/Breadcrumb.js'
import { EmptyState } from '../components/EmptyState.js'
import { createTextEditDialog } from '../components/Modal.js'
import { StatusBadge } from '../components/StatusBadge.js'

function nameOf(items, id) {
  return (items || []).find(item => item.id === id)?.name || id || ''
}

export function createShotDetail(React, api) {
  const { createElement: h, useState } = React
  const TextEditDialog = createTextEditDialog(React)
  return function ShotDetail({ projectId, shotId, plan, busy, navigate, onUpdate }) {
    const [editing, setEditing] = useState(null)
    const characters = plan?.characters || []
    const scenes = plan?.scenes || []
    const shot = (plan?.shots || []).find(item => item.id === shotId)
    if (!shot) return EmptyState(h, { children: '镜头不存在' })

    function field(label, value, key) {
      return h('div', { className: 'tf-detail-field' },
        h('div', { className: 'tf-detail-label-row' },
          h('div', { className: 'tf-detail-label' }, label),
          key ? h('button', {
            className: 'tf-section-link',
            disabled: busy,
            onClick: () => setEditing({ key, label, value: value || '' }),
          }, busy ? '保存中…' : '编辑') : null,
        ),
        h('div', { className: 'tf-detail-value' }, value || '(空)'),
      )
    }

    const generationActions = []
    if (shot.status === 'draft' || shot.status === 'prompt_ready') {
      generationActions.push(ActionButton(h, { key: 'image', label: '▶ 生成首帧', disabled: true, title: '即将支持' }))
    } else if (shot.status === 'image_ready') {
      generationActions.push(ActionButton(h, { key: 'video', label: '▶ 生成视频', disabled: true, title: '即将支持' }))
      generationActions.push(ActionButton(h, { key: 'image-again', label: '🔄 重新生成首帧', disabled: true, ghost: true, title: '即将支持' }))
    } else if (shot.status === 'video_ready') {
      generationActions.push(ActionButton(h, { key: 'image-again', label: '🔄 重新生成首帧', disabled: true, ghost: true, title: '即将支持' }))
      generationActions.push(ActionButton(h, { key: 'video-again', label: '🔄 重新生成视频', disabled: true, ghost: true, title: '即将支持' }))
    }

    return h('div', null,
      Breadcrumb(h, {
        title: `#${shot.order} ${shot.description}`,
        onBack: () => navigate('shots', projectId),
      }),
      h('div', { className: 'tf-detail-split' },
        h('div', { className: 'tf-detail-left' },
          h('div', { className: 'tf-detail-label' }, '首帧'),
          shot.imagePath
            ? h('img', { className: 'tf-detail-img', src: api.mediaUrl(projectId, shot.imagePath), alt: '首帧' })
            : h('div', { className: 'tf-detail-img' }, '📷 待生成'),
          h('div', { className: 'tf-detail-label', style: { marginTop: 8 } }, '视频'),
          shot.videoPath
            ? h('video', { className: 'tf-detail-img', src: api.mediaUrl(projectId, shot.videoPath), controls: true })
            : h('div', { className: 'tf-detail-img' }, '🎬 待生成'),
        ),
        h('div', { className: 'tf-detail-right' },
          field('描述', shot.description, 'description'),
          field('镜头运动', shot.camera, 'camera'),
          field('角色', (shot.characterIds || []).map(id => nameOf(characters, id)).join(', ')),
          field('场景', nameOf(scenes, shot.sceneId)),
          field('图片提示词', shot.imagePrompt, 'imagePrompt'),
          field('视频提示词', shot.videoPrompt, 'videoPrompt'),
          field('时长', `${shot.durationSec} 秒`),
        ),
      ),
      h('div', { className: 'tf-detail-bar' },
        StatusBadge(h, { status: shot.status }),
        shot.lastError ? h('span', { className: 'tf-shot-error' }, shot.lastError) : null,
        shot.retryCount > 0 ? h('span', { className: 'tf-card-meta' }, `重试 ${shot.retryCount}/3`) : null,
      ),
      h('div', { className: 'tf-btn-row' }, generationActions),
      editing ? h(TextEditDialog, {
        key: editing.key,
        label: editing.label,
        initialValue: editing.value,
        busy,
        onClose: () => setEditing(null),
        onSubmit: async value => {
          if (await onUpdate(shot.id, { [editing.key]: value })) setEditing(null)
        },
      }) : null,
    )
  }
}
