// 职责：编辑剧情总览区块与角色定妆图，失焦保存同一份 series.md。
window.__ModuleLoader__.load({ id: 'elysium/series', factory: require => {
  const exports = {}
  const { createElement: h, useEffect, useState } = require('react')
  const { saveDoc, generateDoc, generateAnchorImage, replaceAnchorImage } = require('elysium/project-api')
  const { assetUrl } = require('elysium/media-api')
  const { MaterialList } = require('elysium/materials')
  const { Dialog } = require('elysium/dialog')
  const empty = { logline: '', world: '', characters: [], scenes: [], episodes: [] }
  const render = value => [`一句话故事：${value.logline}`, '## 世界观', value.world, '## 角色',
    ...value.characters.flatMap(item => [`### ${item.name}${item.lead ? '（主角）' : ''}`, `简介：${item.intro}`, `定妆：${item.appearance}`, `音色：${item.voice}`]),
    '## 场景', ...value.scenes.flatMap(item => [`### ${item.name}`, item.description]),
    '## 分集', ...value.episodes.flatMap((item, index) => [`### 第 ${index + 1} 集 · ${item.title}`, `梗概：${item.summary}`, `钩子：${item.hook}`]), ''].join('\n')
  const rowsOf = (text, width = 56) => Math.max(1, String(text || '').split('\n').reduce((sum, line) => sum + Math.ceil((line.length || 1) / width), 0))

  // 看起来是正文、点击即可编辑的字段；失焦时交给 onBlur 保存。
  function Plain({ label, value, onChange, onBlur, multiline = false, width, className = '' }) {
    const props = { 'aria-label': label, placeholder: label, value: value || '', className: `elysium-plain ${className}`, onChange: event => onChange(event.target.value), onBlur }
    return multiline ? h('textarea', { ...props, rows: rowsOf(value, width) }) : h('input', props)
  }

  // 定妆图下方直接给出“出图 / 替换”两个动作，不藏进菜单。
  function Portrait({ anchor, name, onDraw, onReplace, disabled }) {
    return h('div', { className: 'elysium-portrait' },
      anchor?.source_job_id ? h('a', { href: assetUrl('image', anchor.source_job_id), target: '_blank', rel: 'noopener noreferrer', title: `在新窗口查看 ${name} 定妆图` },
        h('img', { src: assetUrl('image', anchor.source_job_id), alt: `${name} 定妆图` })) : h('span', { className: 'elysium-portrait-empty' }, '暂无定妆图'),
      h('div', null, h('button', { type: 'button', className: 'elysium-link', disabled, onClick: onDraw }, anchor?.source_job_id ? '重新出图' : '🤖 出图'),
        h('button', { type: 'button', className: 'elysium-link', disabled, onClick: onReplace }, '替换')))
  }

  function SeriesView({ project, onProject, selectEpisode }) {
    const [draft, setDraft] = useState(project.series || empty), [saving, setSaving] = useState(false), [error, setError] = useState('')
    const [saved, setSaved] = useState(project.series_text), [revised, setRevised] = useState({}), [dialog, setDialog] = useState(null), [full, setFull] = useState(false), [raw, setRaw] = useState(project.series_text)
    useEffect(() => { if (!saving && render(draft) === saved) { setDraft(project.series || empty); setSaved(project.series_text) } }, [project.series_text])
    const change = (group, index, key, text) => setDraft(current => {
      const next = structuredClone(current)
      if (group) next[group][index][key] = text
      else next[key] = text
      return next
    })
    const run = async task => { setSaving(true); setError(''); try { return await task() } catch (err) { setError(err.message) } finally { setSaving(false) } }
    const write = markdown => run(async () => { onProject(await saveDoc(project.id, 'series', markdown)); setSaved(markdown) })
    const persist = () => { const markdown = render(draft); if (markdown !== saved) write(markdown) }
    const generate = () => {
      if (project.series && !window.confirm('重新生成总览会覆盖当前内容，继续吗？')) return
      run(async () => { const next = await generateDoc(project.id, 'series'); onProject(next); setDraft(next.series || empty); setSaved(next.series_text) })
    }
    const draw = role => run(async () => { onProject(await generateAnchorImage(project.id, role)); setRevised(value => ({ ...value, [role]: false })) })
    const missing = draft.characters.filter(role => !project.anchors[role.name]?.source_job_id)
    const replace = item => run(async () => { onProject(await replaceAnchorImage(project.id, dialog.role, item.job_id)); setDialog(null) })
    const field = (group, index, key, label, options = {}) => h(Plain, { label, value: group ? draft[group][index][key] : draft[key], onBlur: persist,
      onChange: text => { change(group, index, key, text); if (key === 'appearance') setRevised(value => ({ ...value, [draft.characters[index].name]: true })) }, ...options })
    return h('section', { className: 'elysium-series' },
      h('header', { className: 'elysium-page-heading' }, h('h2', null, '剧情总览'),
        h('span', { className: 'elysium-save-state', role: 'status' }, saving ? '保存中…' : ''),
        missing.length && project.series ? h('button', { type: 'button', disabled: saving, onClick: async () => { for (const role of missing) await draw(role.name) } }, `为 ${missing.length} 个角色出图`) : null,
        h('button', { type: 'button', className: project.series ? undefined : 'elysium-primary', disabled: saving, onClick: generate }, project.series ? '🤖 重新生成' : '🤖 生成总览'),
        h('button', { type: 'button', className: 'elysium-link', onClick: () => { setRaw(project.series_text); setFull(value => !value) } }, full ? '返回排版视图' : '全文编辑')),
      error ? h('p', { className: 'elysium-banner', role: 'alert' }, error, h('button', { type: 'button', onClick: persist }, '重试')) : null,
      full ? h('textarea', { className: 'elysium-full-text', 'aria-label': '总览 Markdown 全文', value: raw, rows: 30, onChange: event => setRaw(event.target.value),
        onBlur: () => { if (raw !== project.series_text) write(raw) } })
        : !project.series ? h('p', { className: 'elysium-empty' }, '还没有总览。点击“🤖 生成总览”按导演规则生成，或点“全文编辑”手写。')
          : h('div', { className: 'elysium-series-body' },
            h('section', { className: 'elysium-block' }, h('h3', null, '故事'),
              field(null, 0, 'logline', '一句话故事', { className: 'elysium-lead-text' }),
              field(null, 0, 'world', '世界观', { multiline: true, width: 72 })),
            h('section', { className: 'elysium-block' }, h('h3', null, `角色 ${draft.characters.length}`),
              h('div', { className: 'elysium-character-grid' }, draft.characters.map((role, index) => h('article', { key: role.name, className: 'elysium-character-card' },
                h(Portrait, { anchor: project.anchors[role.name], name: role.name, disabled: saving, onDraw: () => draw(role.name), onReplace: () => setDialog({ role: role.name }) }),
                h('div', { className: 'elysium-character-copy' },
                  h('header', null, h('b', null, role.name), role.lead ? h('span', { className: 'elysium-badge', 'data-tone': 'active' }, '主角') : null,
                    revised[role.name] ? h('small', { className: 'elysium-warn-text' }, '定妆已改，可重新出图') : null),
                  field('characters', index, 'intro', `${role.name}简介`, { multiline: true, width: 30 }),
                  h('label', { className: 'elysium-inline-label' }, h('span', null, '音色'), field('characters', index, 'voice', `${role.name}音色`)),
                  h('label', { className: 'elysium-inline-label' }, h('span', null, '定妆'), field('characters', index, 'appearance', `${role.name}定妆`, { multiline: true, width: 36, className: 'elysium-mono' }))))))),
            h('section', { className: 'elysium-block' }, h('h3', null, `场景 ${draft.scenes.length}`),
              draft.scenes.map((scene, index) => h('div', { key: scene.name, className: 'elysium-row' }, h('b', null, scene.name),
                field('scenes', index, 'description', `${scene.name}描述`, { multiline: true, width: 64 })))),
            h('section', { className: 'elysium-block' }, h('h3', null, `分集 ${draft.episodes.length}`),
              draft.episodes.map((episode, index) => h('div', { key: index, className: 'elysium-row elysium-episode-row' },
                h('button', { type: 'button', className: 'elysium-link', title: '打开这一集', onClick: () => selectEpisode(index + 1) }, String(index + 1).padStart(2, '0')),
                h('div', null, field('episodes', index, 'title', `第 ${index + 1} 集标题`, { className: 'elysium-strong' }),
                  field('episodes', index, 'summary', `第 ${index + 1} 集梗概`, { multiline: true, width: 64 }),
                  h('label', { className: 'elysium-inline-label' }, h('span', null, '钩子'), field('episodes', index, 'hook', `第 ${index + 1} 集钩子`))))))),
      dialog?.role ? h(Dialog, { title: `为「${dialog.role}」选择定妆图`, close: () => setDialog(null), busy: saving }, h(MaterialList, { onSelect: replace, imageOnly: true })) : null)
  }
  Object.assign(exports, { SeriesView })
  return exports
} })
