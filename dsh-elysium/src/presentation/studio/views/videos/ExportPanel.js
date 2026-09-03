import { ActionButton } from '../../components/ActionButton.js'
import { Breadcrumb } from '../../components/Breadcrumb.js'
import { StatusBadge } from '../../components/StatusBadge.js'

export function createExportPanel(React) {
  const h = React.createElement
  return function ExportPanel({ projectId, plan, navigate }) {
    const shots = plan?.shots || []
    const exportable = shots.filter(shot => shot.status === 'video_ready')
    const duration = exportable.reduce((sum, shot) => sum + shot.durationSec, 0)
    return h('div', null,
      Breadcrumb(h, { title: '导出', onBack: () => navigate('dashboard', projectId) }),
      shots.map(shot => {
        const ready = shot.status === 'video_ready'
        return h('div', { key: shot.id, className: 'tf-export-row' },
          h('span', { className: 'tf-export-check' }, ready ? '☑' : '☐'),
          h('span', { className: 'tf-export-name', style: { opacity: ready ? 1 : 0.4 } }, `#${shot.order} ${shot.description}`),
          h('span', { className: 'tf-export-dur' }, ready ? `${shot.durationSec}s` : '--'),
          StatusBadge(h, { status: shot.status }),
        )
      }),
      h('div', { className: 'tf-export-summary' },
        `可导出: ${exportable.length} 个镜头\n预计时长: ${duration} 秒\n分辨率: 1280×720　帧率: 24fps`,
      ),
      h('div', { className: 'tf-btn-row' },
        ActionButton(h, { label: '📦 导出 MP4', disabled: true, title: '即将支持：FFmpeg 拼接成片' }),
      ),
    )
  }
}
