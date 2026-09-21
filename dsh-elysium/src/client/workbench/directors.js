// 职责：全文编辑导演 Skill 与流程 Skill（drama）；两者按同名步骤对齐：总纲 · 立项 · 总览 · 剧本 · 分镜。
window.__ModuleLoader__.load({ id: 'elysium/directors', factory: require => {
  const exports = {}
  const { createElement: h, useEffect, useState } = require('react')
  const { FullText, Menu } = require('elysium/dialog')
  const { fetchDirectors, fetchDirector, createDirector, saveDirector, reorderDirectors, deleteDirector, fetchFlow, saveFlow } = require('elysium/director-api')
  const steps = [['SKILL', '总纲'], ['project', '立项'], ['series', '总览'], ['script', '剧本'], ['storyboard', '分镜']]

  function StepTabs({ label, value, onChange }) {
    return h('nav', { 'aria-label': label, role: 'tablist', className: 'elysium-tabs' }, steps.map(([step, text]) => h('button', { key: step, type: 'button', role: 'tab',
      'aria-selected': value === step, onClick: () => onChange(step) }, text)))
  }

  function DirectorList() {
    const [items, setItems] = useState([]), [director, setDirector] = useState(null), [step, setStep] = useState('SKILL')
    const [creating, setCreating] = useState(false), [newName, setNewName] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('')
    const run = async action => { setBusy(true); setError(''); try { return await action() } catch (err) { setError(err.message) } finally { setBusy(false) } }
    const open = name => run(async () => setDirector(name ? await fetchDirector(name) : null))
    const reload = async selected => { const list = await fetchDirectors(); setItems(list); await open(list.some(item => item.name === selected) ? selected : list[0]?.name) }
    useEffect(() => { run(() => reload()) }, [])
    const create = event => { event.preventDefault(); if (newName.trim()) run(async () => { const item = await createDirector({ display_name: newName.trim() }); setCreating(false); setNewName(''); setStep('SKILL'); await reload(item.name) }) }
    const move = offset => run(async () => {
      const names = items.map(item => item.name), index = names.indexOf(director.name), target = index + offset
      if (target < 0 || target >= names.length) return
      names.splice(target, 0, names.splice(index, 1)[0])
      setItems(await reorderDirectors(names))
    })
    const remove = () => { if (window.confirm(`删除导演“${director.display_name}”？被项目使用的导演不能删除。`)) run(async () => { await deleteDirector(director.name); await reload() }) }
    const file = step === 'SKILL' ? 'SKILL.md' : `${step}.md`
    return h('div', { className: 'elysium-directors' },
      h('header', { className: 'elysium-page-heading' },
        items.length ? h('select', { 'aria-label': '选择导演', value: director?.name || '', disabled: busy, onChange: event => open(event.target.value) },
          items.map(item => h('option', { key: item.name, value: item.name }, item.display_name))) : null,
        h('button', { type: 'button', className: 'elysium-link', 'aria-label': '添加导演', onClick: () => setCreating(value => !value) }, creating ? '取消新建' : '＋ 新建导演'),
        director ? h(Menu, { label: '导演更多操作', items: [['上移', () => move(-1)], ['下移', () => move(1)], ['删除导演', remove, true]] }) : null),
      creating ? h('form', { className: 'elysium-page-heading', onSubmit: create },
        h('input', { autoFocus: true, 'aria-label': '导演名称', placeholder: '导演名称，例如：悬疑反转 · 冷色调', value: newName, onChange: event => setNewName(event.target.value) }),
        h('button', { type: 'submit', className: 'elysium-primary', disabled: busy || !newName.trim() }, '创建')) : null,
      h(StepTabs, { label: '导演配置页签', value: step, onChange: setStep }),
      h('p', { className: 'elysium-compact-meta' }, '导演 Skill 决定风格与规模：总纲在每一步都会读取，其余页签只在同名步骤读取。新建导演会按标准结构生成，写法见 docs/design/规范-Skill编写.md。'),
      error ? h('p', { className: 'elysium-banner', role: 'alert' }, error) : null,
      director ? h(FullText, { key: `${director.name}-${file}`, label: `${director.display_name} ${file}`, value: director.files[file],
        onSave: async content => setDirector(await saveDirector({ name: director.name, file, content })) })
        : h('p', { className: busy ? undefined : 'elysium-empty', role: 'status' }, busy ? '正在读取导演…' : '暂无导演，点击“新建导演”开始'))
  }

  function FlowSkill() {
    const [files, setFiles] = useState(null), [step, setStep] = useState('SKILL'), [error, setError] = useState('')
    useEffect(() => { fetchFlow().then(value => setFiles(value.files)).catch(err => setError(err.message)) }, [])
    const file = step === 'SKILL' ? 'SKILL.md' : `steps/${step}.md`
    return h('div', { className: 'elysium-flow-skill' },
      h(StepTabs, { label: '流程 Skill 页签', value: step, onChange: setStep }),
      h('p', { className: 'elysium-compact-meta' }, '流程 Skill（drama）决定每一步写什么、按什么格式写，所有项目共用；风格与集数写在导演 Skill 的同名页签里。'),
      error ? h('p', { className: 'elysium-banner', role: 'alert' }, error) : null,
      files ? h(FullText, { key: file, label: `流程 Skill ${file}`, value: files[file], onSave: async content => setFiles((await saveFlow(file, content)).files) })
        : error ? null : h('p', { role: 'status' }, '正在读取流程 Skill…'))
  }
  Object.assign(exports, { DirectorList, FlowSkill })
  return exports
} })
