// 职责：编辑剧情总览区块与角色定妆图，失焦保存同一份 series.md。
window.__ModuleLoader__.load({ id: 'elysium/series', factory: require => {
  const exports = {}
  const { createElement: h, useEffect, useState } = require('react')
  const { saveDoc, generateDoc, generateAnchorImage, replaceAnchorImage } = require('elysium/project-api')
  const { ShotPreview } = require('elysium/shot-preview')
  const { MaterialList } = require('elysium/materials')
  const empty = { logline: '', world: '', characters: [], scenes: [], episodes: [] }
  const render = value => [`一句话故事：${value.logline}`, '## 世界观', value.world, '## 角色',
    ...value.characters.flatMap(item => [`### ${item.name}${item.lead ? '（主角）' : ''}`, `简介：${item.intro}`, `定妆：${item.appearance}`, `音色：${item.voice}`]),
    '## 场景', ...value.scenes.flatMap(item => [`### ${item.name}`, item.description]),
    '## 分集', ...value.episodes.flatMap((item, index) => [`### 第 ${index + 1} 集 · ${item.title}`, `梗概：${item.summary}`, `钩子：${item.hook}`]), ''].join('\n')
  function Field({ label, value, onChange, onBlur, rows = 1 }) {
    return h('label', { className: 'elysium-field' }, h('span', null, label), rows > 1
      ? h('textarea', { 'aria-label': label, value: value || '', rows, onChange: event => onChange(event.target.value), onBlur })
      : h('input', { 'aria-label': label, value: value || '', onChange: event => onChange(event.target.value), onBlur }))
  }
  function SeriesView({ project, onProject, selectEpisode }) {
    const [draft, setDraft] = useState(project.series || empty), [saving, setSaving] = useState(false), [error, setError] = useState('')
    const [saved, setSaved] = useState(project.series_text), [revised, setRevised] = useState({}), [replacing, setReplacing] = useState(null), [full, setFull] = useState(false), [raw, setRaw] = useState(project.series_text)
    useEffect(() => { if (!saving && render(draft) === saved) { setDraft(project.series || empty); setSaved(project.series_text) } }, [project.series_text])
    const change = (group, index, key, text) => setDraft(current => {
      const next = structuredClone(current)
      if (group) next[group][index][key] = text
      else next[key] = text
      return next
    })
    const persist = async () => {
      const markdown = render(draft)
      if (markdown === saved) return
      setSaving(true); setError('')
      try { onProject(await saveDoc(project.id, 'series', markdown)); setSaved(markdown) }
      catch (err) { setError(err.message) }
      finally { setSaving(false) }
    }
    const generate = async () => {
      if (project.series && !window.confirm('重新生成总览会覆盖当前内容，继续吗？')) return
      setSaving(true); setError('')
      try { const next = await generateDoc(project.id, 'series'); onProject(next); setDraft(next.series || empty); setSaved(next.series_text) }
      catch (err) { setError(err.message) }
      finally { setSaving(false) }
    }
    const draw = async role => {
      setSaving(true); setError('')
      try { onProject(await generateAnchorImage(project.id, role)); setRevised(value => ({ ...value, [role]: false })) }
      catch (err) { setError(err.message) }
      finally { setSaving(false) }
    }
    const replace = async item => {
      setSaving(true); setError('')
      try { onProject(await replaceAnchorImage(project.id, replacing, item.job_id)); setReplacing(null) }
      catch (err) { setError(err.message); return false }
      finally { setSaving(false) }
    }
    return h('section', { className: 'elysium-series' },
      h('header', { className: 'elysium-card-actions' }, h('h2', null, '剧情总览'), h('button', { type: 'button', disabled: saving, onClick: generate }, '🤖 生成总览'),
        h('button', { type: 'button', onClick: () => { setRaw(project.series_text); setFull(value => !value) } }, full ? '返回区块' : '全文编辑'),
        h('button', { type: 'button', disabled: saving || !draft.characters.length, onClick: async () => { for (const role of draft.characters) if (!project.anchors[role.name]?.source_job_id) await draw(role.name) } }, '为缺图角色出图'),
        h('span', { role: 'status' }, saving ? '保存中' : error ? '保存失败' : '已保存')),
      error ? h('p', { role: 'alert' }, error, h('button', { type: 'button', onClick: persist }, '重试')) : null,
      !project.series ? h('p', { className: 'elysium-empty' }, '暂无总览，可自动生成或手工填写。') : null,
      full ? h('textarea', { 'aria-label': '总览 Markdown 全文', value: raw, rows: 24, onChange: event => setRaw(event.target.value), onBlur: async () => {
        if (raw === project.series_text) return
        setSaving(true); setError('')
        try { onProject(await saveDoc(project.id, 'series', raw)); setSaved(raw) } catch (err) { setError(err.message) } finally { setSaving(false) }
      } }) : null,
      h(Field, { label: '一句话故事', value: draft.logline, onChange: text => change(null, 0, 'logline', text), onBlur: persist }),
      h(Field, { label: '世界观', value: draft.world, rows: 3, onChange: text => change(null, 0, 'world', text), onBlur: persist }),
      h('h3', null, '角色'), draft.characters.map((role, index) => h('article', { key: role.name, className: 'elysium-character-card' },
        h('h4', null, role.name, role.lead ? '（主角）' : ''),
        project.anchors[role.name]?.source_job_id ? h(ShotPreview, { jobId: project.anchors[role.name].source_job_id, imageOnly: true }) : null,
        h('div', { className: 'elysium-card-actions' }, h('button', { type: 'button', disabled: saving, onClick: () => draw(role.name) }, '🤖 出图'),
          h('button', { type: 'button', disabled: saving, onClick: () => setReplacing(role.name) }, '替换'),
          revised[role.name] ? h('span', null, '定妆已改，可重新出图') : null),
        h(Field, { label: `${role.name}简介`, value: role.intro, rows: 2, onChange: text => change('characters', index, 'intro', text), onBlur: persist }),
        h(Field, { label: `${role.name}定妆`, value: role.appearance, rows: 2, onChange: text => { change('characters', index, 'appearance', text); setRevised(value => ({ ...value, [role.name]: true })) }, onBlur: persist }),
        h(Field, { label: `${role.name}音色`, value: role.voice, onChange: text => change('characters', index, 'voice', text), onBlur: persist }))),
      h('h3', null, '场景'), draft.scenes.map((scene, index) => h('article', { key: scene.name }, h('h4', null, scene.name),
        h(Field, { label: `${scene.name}描述`, value: scene.description, rows: 2, onChange: text => change('scenes', index, 'description', text), onBlur: persist }))),
      replacing ? h('div', { className: 'elysium-material-picker' }, h('button', { type: 'button', onClick: () => setReplacing(null) }, '关闭素材选择'), h(MaterialList, { onSelect: replace, imageOnly: true })) : null,
      h('h3', null, '分集'), draft.episodes.map((episode, index) => h('article', { key: index },
        h('button', { type: 'button', onClick: () => selectEpisode(index + 1) }, `第 ${index + 1} 集 · ${episode.title}`),
        h(Field, { label: `第 ${index + 1} 集标题`, value: episode.title, onChange: text => change('episodes', index, 'title', text), onBlur: persist }),
        h(Field, { label: `第 ${index + 1} 集梗概`, value: episode.summary, rows: 2, onChange: text => change('episodes', index, 'summary', text), onBlur: persist }),
        h(Field, { label: `第 ${index + 1} 集钩子`, value: episode.hook, onChange: text => change('episodes', index, 'hook', text), onBlur: persist }))))
  }
  Object.assign(exports, { SeriesView })
  return exports
} })
