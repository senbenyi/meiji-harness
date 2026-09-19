// 职责：编辑 Segment 的创作资料、素材意图和具体分镜。
window.__ModuleLoader__.load({ id: 'elysium/segment-editor', factory: require => {
  const { createElement: h } = require('react')
  const names = { characters: '人物', clothing: '服装', props: '道具', scene: '场景', music: '背景音乐', ambience: '环境声音', dialogue: '对白与声音' }
  const Field = ({ label, value, change, type = 'text', rows }) => h('label', { className: 'elysium-field' }, h('span', null, label), h(rows ? 'textarea' : 'input', { 'aria-label': label, type, rows, value: value ?? '', onChange: e => change(type === 'number' ? Number(e.target.value) : e.target.value) }))
  function SegmentEditor({ value, assets, scenes, previous, change }) {
    const set = (key, v) => change({ ...value, [key]: v })
    return h('div', { className: 'elysium-production-form' },
      h(Field, { label: '片段名称', value: value.title, change: v => set('title', v) }),
      h('label', { className: 'elysium-field' }, '所属 Scene', h('select', { 'aria-label': '所属 Scene', value: value.scene_id, onChange: e => set('scene_id', e.target.value) }, scenes.map(s => h('option', { key: s.id, value: s.id }, s.title)))),
      h(Field, { label: '片段时长（4～15秒）', type: 'number', value: value.duration, change: v => set('duration', v) }),
      h(Field, { label: '出镜人物数量', type: 'number', value: value.character_count, change: v => set('character_count', v) }),
      h(Field, { label: '片段剧情与动作', rows: 5, value: value.description, change: v => set('description', v) }),
      h(Field, { label: '开始状态', rows: 2, value: value.start_state, change: v => set('start_state', v) }), h(Field, { label: '结束状态', rows: 2, value: value.end_state, change: v => set('end_state', v) }),
      previous ? h('section', { className: 'elysium-edit-section', 'aria-label': '片段衔接规划' }, h('h3', null, '片段衔接 · AI 规划'),
        h('p', null, value.use_previous_tail ? '沿用上一段尾帧作为首帧' : '独立起镜，不沿用上一段尾帧'),
        h('p', null, value.tail_reason ? `判断原因：${value.tail_reason}` : '此片段尚无 AI 衔接判断，当前沿用已有设置；AI 规划 Segment 时会自动判断并记录原因。'),
        h('p', null, `上一段：${previous.title}。${value.use_previous_tail ? '执行时自动等待该段完成并提取尾帧。' : ''}衔接方式由 AI 在切分片段时决定；不会取消段内的分镜切换。`)) : null,
      Object.entries(names).map(([key, title]) => {
        const material = value.materials[key], update = patch => set('materials', { ...value.materials, [key]: { ...material, ...patch } })
        return h('section', { className: 'elysium-edit-section', key }, h('h3', null, title),
          h(Field, { label: `${title}描述`, rows: 2, value: material.description, change: description => update({ description }) }),
          h('label', { className: 'elysium-field' }, '具体指定', h('select', { 'aria-label': `${title}指定方式`, value: material.intent, onChange: e => update({ intent: e.target.value, asset_ids: e.target.value === 'none' ? [] : material.asset_ids }) },
            h('option', { value: 'auto' }, '交给 AI 补齐'), h('option', { value: 'specified' }, '指定共享素材'), h('option', { value: 'none' }, '明确不需要'))),
          material.intent === 'specified' ? h('select', { multiple: true, 'aria-label': `${title}素材`, value: material.asset_ids, onChange: e => update({ asset_ids: Array.from(e.target.selectedOptions, o => o.value) }) }, assets.map(a => h('option', { key: a.id, value: a.id }, a.title))) : null,
          key === 'characters' ? h('p', null, material.asset_ids.length ? `已指定 ${material.asset_ids.length} 位人物` : '人物由描述确定，未指定实际素材') : null)
      }))
  }
  function ShotEditor({ value, change }) {
    return h('div', { className: 'elysium-production-form' }, [['duration', '镜头时长', 0], ['action', '画面动作', 4], ['framing', '景别', 2], ['camera', '运镜', 2], ['lighting', '光线', 2], ['dialogue', '对白', 3], ['sound', '声音', 3]].map(([key, label, rows]) => h(Field, { key, label, rows, type: key === 'duration' ? 'number' : 'text', value: value[key], change: v => change({ ...value, [key]: v }) })))
  }
  return { Field, SegmentEditor, ShotEditor }
} })
