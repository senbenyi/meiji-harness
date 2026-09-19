// 职责：展示横向剧集卡片、单集镜头列表和分组镜头编辑表单。
window.__ModuleLoader__.load({ id: 'elysium/episode-ui', factory: require => {
  const { createElement: h, useRef } = require('react')
  const { assetUrl } = require('elysium/media-api')
  const { deliveryUrl } = require('elysium/delivery')
  const shotsFor = (project, id) => project.acts.filter(act => act.episode_id === id).flatMap(act => act.shots)
  const filmsFor = (project, id) => project.deliverables.filter(item => item.episode_id === id && !['subtitle', 'srt', 'vtt'].includes(item.type))
  const imageUrl = item => item?.job_id ? assetUrl('image', item.job_id, { preview: '1' }) : item?.image_url
  const videoUrl = item => item?.job_id ? assetUrl('video', item.job_id) : item && deliveryUrl(item)
  const durationOf = shots => shots.reduce((sum, shot) => sum + (Number(shot.duration) || 0), 0)
  function episodeStatus(episode, type, project) {
    const w = episode.workflow
    if (type === 'plot') return project.workflow.request?.stage === 'plot' || w.request?.stage === 'plot' ? '生成中' : w.plot_stale ? '待更新' : w.plot ? '已生成' : '待生成'
    if (type === 'storyboard') return project.workflow.request?.stage === 'storyboard' || w.request?.stage === 'storyboard' ? '生成中' : w.storyboard_revision === w.revision ? w.approval ? '已审核' : '待审核' : shotsFor(project, episode.id).length ? '待更新' : '待生成'
    return ({ complete: '已完成', failed: '生成失败', video: '生成中', submitting: '提交中' })[w.stage] || (filmsFor(project, episode.id).length ? '历史成片' : '待生成')
  }
  function EpisodeRail({ title, type, project, navigate, positions, next }) {
    const rail = useRef(null)
    const move = direction => rail.current?.scrollBy({ left: direction * Math.max(200, rail.current.clientWidth * .8), behavior: 'smooth' })
    return h('section', { className: 'elysium-episode-section' },
      h('header', null, h('div', null, h('h2', null, title), h('span', null, `${project.episodes.length} 集`)), h('div', { className: 'elysium-rail-controls' },
        h('button', { 'aria-label': `${title}向左滚动`, onClick: () => move(-1) }, '‹'), h('button', { 'aria-label': `${title}向右滚动`, onClick: () => move(1) }, '›'))),
      h('div', { className: 'elysium-episode-rail', role: 'region', 'aria-label': `${title}剧集列表`, tabIndex: 0,
        ref: node => { rail.current = node; if (node) node.scrollLeft = positions[type] || 0 }, onScroll: event => { positions[type] = event.currentTarget.scrollLeft },
        onKeyDown: event => { if (event.target === event.currentTarget && ['ArrowLeft', 'ArrowRight'].includes(event.key)) { event.preventDefault(); move(event.key === 'ArrowLeft' ? -1 : 1) } } },
        project.episodes.flatMap((episode, index) => {
          const shots = shotsFor(project, episode.id), films = filmsFor(project, episode.id)
          const variants = type === 'video' && films.length ? films : [null]
          return variants.map((film, version) => {
            const reference = (project.selected_materials || []).find(item => item.id === shots[0]?.reference_id)
            const status = episodeStatus(episode, type, project)
            return h('button', { key: `${episode.id}-${version}`, className: 'elysium-episode-card', 'aria-label': `打开第 ${index + 1} 集${title}${film ? `版本 ${version + 1}` : ''}`, onClick: () => navigate({ type, episodeId: episode.id, ...(film ? { filmKey: film.job_id || film.url } : {}) }) },
              type === 'video' && film && videoUrl(film) ? h('video', { className: 'elysium-episode-cover', src: videoUrl(film), preload: 'metadata', muted: true, playsInline: true, 'aria-label': `第 ${index + 1} 集成片封面` })
                : type === 'storyboard' && imageUrl(reference) ? h('img', { className: 'elysium-episode-cover', src: imageUrl(reference), alt: reference.title, loading: 'lazy' })
                  : h('span', { className: `elysium-episode-placeholder elysium-episode-placeholder-${type}`, 'aria-hidden': true }, type === 'plot' ? String(index + 1).padStart(2, '0') : type === 'storyboard' ? '▤' : '▷'),
              h('span', { className: 'elysium-episode-card-top' }, `第 ${index + 1} 集`, h('span', { className: 'elysium-step-status', 'data-status': status }, status)),
              h('strong', null, episode.title),
              h('span', { className: 'elysium-episode-excerpt' }, type === 'plot' ? episode.workflow.plot || '配置素材后生成本集剧情' : type === 'storyboard' ? shots[0]?.action || '先确认本集剧情，再生成分镜' : film ? `版本 ${version + 1} · ${film.label}` : episode.workflow.error || '审核本集分镜后生成成片'),
              h('span', { className: 'elysium-episode-card-meta' }, type === 'plot' ? `${[...(episode.workflow.plot || '').replace(/\s/g, '')].length}/200 字 · 查看剧情` : type === 'storyboard' ? `${shots.length} 镜 · ${durationOf(shots)} 秒 · 查看分镜` : film ? `${film.duration_sec ? `${film.duration_sec} 秒 · ` : ''}播放成片 →` : '查看制作状态 →'))
          })
        })), next ? h('footer', { className: 'elysium-series-next' }, h('p', { role: 'status' }, next.progress), h('button', { className: 'elysium-primary', disabled: next.disabled, onClick: next.run }, next.label)) : null)
  }
  function EpisodeOverview({ project, navigate, positions, steps = {} }) {
    const materials = project.selected_materials || []
    return h('div', { className: 'elysium-series-overview' },
      h('div', { className: 'elysium-series-intro' }, h('span', null, '创作工作台'), h('h2', null, project.title), h('p', null, `${project.episodes.length} 集 · ${project.acts.reduce((sum, act) => sum + act.shots.length, 0)} 个分镜 · ${project.deliverables.filter(item => item.type === 'video').length} 份成片`)),
      h('section', { className: 'elysium-overview-configuration' }, h('button', { className: 'elysium-series-configuration', 'aria-label': '打开项目配置详情', onClick: () => navigate({ type: 'configuration' }) },
        h('span', null, h('strong', null, '项目配置'), h('span', null, `${{ director: '导演模式', free: '自由模式', teaching: '教学模式' }[project.mode] || '导演模式'} · ${materials.length} 项素材 · ${project.episode_count} 集`)),
        h('span', { className: 'elysium-series-avatars' }, materials.filter(item => ['male', 'female'].includes(item.field) && imageUrl(item)).map(item => h('img', { key: item.field, src: imageUrl(item), alt: item.title, loading: 'lazy' }))), h('span', { 'aria-hidden': true }, '›')),
        steps.configuration ? h('footer', { className: 'elysium-series-next' }, h('p', null, '点击下一步即确认配置，用于全部分集'), h('button', { className: 'elysium-primary', disabled: steps.configuration.disabled, onClick: steps.configuration.run }, steps.configuration.label)) : null),
      ...[['plot', '剧情'], ['storyboard', '分镜'], ['video', '成片']].map(([type, title]) => h(EpisodeRail, { key: type, title, type, project, navigate, positions, next: steps[type] })))
  }
  function EpisodeShotList({ project, episode, navigate }) {
    const shots = shotsFor(project, episode.id)
    return h('div', { className: 'elysium-episode-shots' },
      h('div', { className: 'elysium-list-intro' }, h('h2', null, episode.title), h('p', null, `${shots.length} 个镜头 · 总时长 ${durationOf(shots)} 秒`)),
      !shots.length ? h('div', { className: 'elysium-series-empty' }, h('strong', null, '这一集还没有分镜'), h('p', null, '先确认剧情，再生成本集镜头。')) : null,
      shots.map((shot, index) => {
        const reference = (project.selected_materials || []).find(item => item.id === shot.reference_id)
        return h('button', { key: shot.id, className: 'elysium-episode-shot-row', 'aria-label': `编辑镜头 ${index + 1}`, onClick: () => navigate({ type: 'shot', episodeId: episode.id, shotId: shot.id }) },
          imageUrl(reference) ? h('img', { src: imageUrl(reference), alt: reference.title, loading: 'lazy' }) : h('span', { className: 'elysium-shot-number' }, String(index + 1).padStart(2, '0')),
          h('span', { className: 'elysium-shot-row-copy' }, h('strong', null, `镜头 ${String(index + 1).padStart(2, '0')}`, h('small', null, `${shot.duration || 0} 秒`)), h('span', null, shot.action), h('small', null, [shot.framing, shot.camera, shot.mode === 'continue' ? '续接上一镜' : '独立镜头'].filter(Boolean).join(' · '))), h('span', { 'aria-hidden': true }, '›'))
      }))
  }
  function EpisodeShotEditor({ shot, index, project, locked, onChange }) {
    const materials = project.selected_materials || []
    const field = (key, title, rows = 3) => h('label', { className: 'elysium-field', key }, title, h('textarea', { 'aria-label': title, rows, value: shot[key] || '', disabled: locked, onChange: e => onChange({ ...shot, [key]: e.target.value }) }))
    const selection = (key, title, fields, multiple = false) => {
      const items = materials.filter(item => fields.includes(item.field))
      return h('div', { className: 'elysium-shot-material-field', key }, h('span', null, title), items.length ? h('div', { className: 'elysium-shot-chips', role: 'group', 'aria-label': title },
        items.map(item => { const selected = multiple ? (shot[key] || []).includes(item.id) : shot[key] === item.id
          return h('button', { key: `${item.field}-${item.id}`, type: 'button', disabled: locked, 'aria-pressed': selected, onClick: () => onChange({ ...shot, [key]: multiple ? selected ? shot[key].filter(id => id !== item.id) : [...(shot[key] || []), item.id] : selected ? '' : item.id }) }, item.title)
        })) : h('p', { className: 'elysium-compact-meta' }, '项目中未选择这类素材'))
    }
    const reference = materials.find(item => item.id === shot.reference_id)
    return h('div', { className: 'elysium-shot-form' },
      h('section', { className: 'elysium-edit-section' }, h('h2', null, '画面与故事'), field('action', '画面动作'), field('subtitle', '对白 / 字幕', 2)),
      h('section', { className: 'elysium-edit-section' }, h('h2', null, '拍摄设计'), h('div', { className: 'elysium-shot-form-grid' },
        h('label', { className: 'elysium-field' }, '时长（秒）', h('input', { type: 'number', min: 1, max: 15, 'aria-label': '时长（秒）', disabled: locked, value: shot.duration, onChange: e => onChange({ ...shot, duration: Number(e.target.value) }) })),
        h('label', { className: 'elysium-field' }, '镜头方式', h('select', { 'aria-label': '镜头方式', disabled: locked, value: shot.mode, onChange: e => onChange({ ...shot, mode: e.target.value, ...(e.target.value === 'continue' ? { reference_id: '' } : {}) }) }, h('option', { value: 'independent' }, '独立镜头'), index > 0 ? h('option', { value: 'continue' }, '续接上一镜') : null)),
        field('framing', '景别', 2), field('camera', '运镜', 2), field('lighting', '光线', 2), field('sound', '声音', 2))),
      h('section', { className: 'elysium-edit-section' }, h('h2', null, '素材关联'), selection('characters', '出场人物', ['male', 'female', 'supporting'], true), selection('props', '镜头道具', ['props'], true), selection('scene', '镜头场景', ['scene']),
        h('label', { className: 'elysium-field' }, '画面参考图', h('select', { 'aria-label': '画面参考图', value: shot.reference_id || '', disabled: locked || shot.mode === 'continue', onChange: e => onChange({ ...shot, reference_id: e.target.value }) }, h('option', { value: '' }, '不选择'), materials.filter(item => imageUrl(item)).map(item => h('option', { key: `${item.field}-${item.id}`, value: item.id }, item.title)))),
        imageUrl(reference) ? h('img', { className: 'elysium-shot-reference', src: imageUrl(reference), alt: reference.title }) : null),
      h('section', { className: 'elysium-edit-section' }, h('h2', null, '生成描述'), field('prompt', '视频生成描述', 5)))
  }
  return { EpisodeOverview, EpisodeShotList, EpisodeShotEditor, shotsFor, filmsFor, episodeStatus }
} })
