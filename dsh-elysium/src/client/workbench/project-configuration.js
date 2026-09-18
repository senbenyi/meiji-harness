// 职责：编辑项目模式、分角色素材选择和参考剧情文本。
window.__ModuleLoader__.load({ id: 'elysium/project-configuration', factory: require => {
  const { createElement: h, useState, useEffect } = require('react')
  const { fetchAssets } = require('elysium/materials')
  const { fetchDirectors } = require('elysium/director-api')
  const { assetUrl } = require('elysium/media-api')
  function ProjectConfiguration({ project, busy, onChange }) {
    const [items, setItems] = useState([]), [directors, setDirectors] = useState([]), [error, setError] = useState('')
    useEffect(() => {
      let active = true
      async function load() {
        const all = []
        for (let offset = 0;; offset += 100) { const page = await fetchAssets(offset, 100); all.push(...page.items); if (!page.has_more) break }
        const names = await fetchDirectors()
        if (active) { setItems(all); setDirectors(names) }
      }
      load().catch(error => { if (active) setError(error.message) })
      return () => { active = false }
    }, [])
    const c = project.configuration || { supporting: [], props: [], theme: [] }
    const change = patch => onChange({ ...project, configuration: { ...c, ...patch } })
    const choose = (key, title, category, multiple = false) => {
      const selected = multiple ? c[key] || [] : c[key] ? [c[key]] : []
      return h('fieldset', { key, disabled: busy, className: 'elysium-selection' }, h('legend', null, title, multiple ? '（多选）' : '（单选，可留空）'),
        h('select', { 'aria-label': title, multiple, value: multiple ? selected : c[key] || '', size: multiple ? 4 : undefined, onChange: event => change({ [key]: multiple ? [...event.target.selectedOptions].map(option => option.value) : event.target.value || null }) },
          !multiple ? h('option', { value: '' }, '不选择') : null,
          items.filter(item => item.category === category).map(item => h('option', { key: item.id, value: item.id }, item.title || item.id))),
        selected.length ? h('div', { className: 'elysium-selected-materials' }, selected.map(id => {
          const item = items.find(item => item.id === id)
          return h('article', { key: id }, item?.has_image ? h('img', { src: assetUrl('image', item.job_id, { preview: '1' }), alt: item.title, loading: 'lazy' }) : null,
            h('strong', null, item?.title || '素材已失效'), h('p', null, item?.description || ''),
            h('button', { type: 'button', onClick: () => change({ [key]: multiple ? selected.filter(value => value !== id) : null }) }, '移除'))
        })) : null)
    }
    const selectedThemes = Array.isArray(c.theme) ? c.theme : c.theme ? [c.theme] : []
    const themes = items.filter(item => item.category === 'theme')
    return h('div', { className: 'elysium-project-configuration' },
      h('p', null, '请配置项目素材。未选择的项目保留为空。'),
      h('label', { className: 'elysium-field' }, '项目模式', h('select', { 'aria-label': '项目模式', value: project.mode || 'director', disabled: busy, onChange: event => onChange({ ...project, mode: event.target.value }) }, [['director', '导演模式'], ['free', '自由模式'], ['teaching', '教学模式']].map(([value, label]) => h('option', { key: value, value }, label)))),
      h('label', { className: 'elysium-field' }, '创作需求', h('textarea', { 'aria-label': '创作需求', value: project.brief || '', disabled: busy, onChange: event => onChange({ ...project, brief: event.target.value }) })),
      h('h3', null, '人物'), choose('male', '男主', 'character'), choose('female', '女主', 'character'), choose('supporting', '配角', 'character', true),
      choose('props', '道具', 'prop', true), choose('scene', '场景', 'scene'),
      h('fieldset', { disabled: busy, className: 'elysium-selection elysium-theme-selection' }, h('legend', null, '题材（多选）'),
        h('div', { className: 'elysium-theme-grid', role: 'group', 'aria-label': '题材' },
          themes.length
            ? themes.map(item => {
              const on = selectedThemes.includes(item.id)
              return h('button', { key: item.id, type: 'button', role: 'checkbox', 'aria-checked': on, className: `elysium-theme-tag${on ? ' elysium-theme-tag-active' : ''}`, onClick: () => change({ theme: on ? selectedThemes.filter(id => id !== item.id) : [...selectedThemes, item.id] }) }, item.title || item.id)
            })
            : h('p', { className: 'elysium-compact-meta' }, '暂无题材标签'))),
      h('label', { className: 'elysium-field' }, '导演', h('select', { 'aria-label': '导演', value: c.director || '', disabled: busy, onChange: event => change({ director: event.target.value || null }) }, h('option', { value: '' }, '不选择'), directors.map(item => h('option', { key: item.name, value: item.name }, item.name)))),
      c.director ? h('p', null, directors.find(item => item.name === c.director)?.style) : null,
      h('label', { className: 'elysium-field' }, '参考剧情 / 小说文本', h('textarea', { 'aria-label': '参考剧情', rows: 8, value: c.reference_text || '', disabled: busy, onChange: event => change({ reference_text: event.target.value }) })),
      h('label', { className: 'elysium-field' }, '导入 TXT / Markdown（最多 10 万字符）', h('input', { type: 'file', accept: '.txt,.md,text/plain,text/markdown', disabled: busy, 'aria-label': '导入剧情文本', onChange: async event => {
        const file = event.target.files?.[0]
        if (!file) return
        try { const text = await file.text(); if (text.length > 100000) throw new Error('文本超过 10 万字符，请选择需要改编的章节'); change({ reference_text: text }); setError('') } catch (error) { setError(error.message) }
      } })), error ? h('p', { role: 'alert' }, error) : null)
  }
  return { ProjectConfiguration }
} })
