window.__ModuleLoader__.load({
  id: 'elysium-ui/projects', factory: require => {
    const { createElement: h, useState, useEffect, useRef } = require('react')
    const panel = { background: 'var(--background, #fff)', color: 'var(--foreground, #222)', border: '1px solid #aaa', borderRadius: 10, padding: 16, boxShadow: '0 8px 30px #0002', overflowY: 'auto' }
    const button = { margin: '4px 6px 4px 0' }
    function config() {
      const value = window.__ELYSIUM_PROJECTS__
      if (!value?.token) throw new Error('短剧项目服务不可用，请确认工具插件已启用并刷新页面')
      return value
    }
    async function request(query = {}, data, signal) {
      const cfg = config(), url = `${cfg.base}?${new URLSearchParams(query)}`
      const response = await fetch(url, { method: data ? 'POST' : 'GET', signal,
        headers: { 'X-Elysium-Token': cfg.token, ...(data ? { 'Content-Type': 'application/json' } : {}) },
        ...(data ? { body: JSON.stringify(data) } : {}) })
      const result = await response.json()
      if (!response.ok) throw Object.assign(new Error(result.error || '项目请求失败'), { status: response.status })
      return result
    }
    const mediaUrl = (id, fields) => {
      const cfg = config()
      return `${cfg.base}/file?${new URLSearchParams({ id, ...fields, t: cfg.token })}`
    }
    function ProjectList({ openProject }) {
      const [shown, show] = useState(false), [rows, setRows] = useState([]), [name, setName] = useState('')
      const [error, setError] = useState(''), [busy, setBusy] = useState(false)
      useEffect(() => {
        if (!shown) return
        const controller = new AbortController()
        request({}, undefined, controller.signal).then(setRows).catch(e => { if (!controller.signal.aborted) setError(e.message) })
        return () => controller.abort()
      }, [shown])
      const run = async action => {
        setBusy(true); setError('')
        try { await action() } catch (e) { setError(e.message) } finally { setBusy(false) }
      }
      return h('div', null,
        h('button', { title: '我的短剧', onClick: () => show(!shown) }, '我的短剧'),
        shown ? h('section', { 'aria-label': '我的短剧', style: { ...panel, position: 'fixed', left: 12, top: 64, bottom: 70, width: 260, zIndex: 100 } },
          h('button', { onClick: () => show(false), style: { float: 'right' }, 'aria-label': '关闭短剧列表' }, '关闭'),
          h('h3', null, '我的短剧'),
          h('form', { onSubmit: e => { e.preventDefault(); run(async () => {
            const p = await request({}, { action: 'create', name })
            setRows(await request()); setName('')
            await openProject(p.id); show(false)
          }) } },
          h('input', { 'aria-label': '短剧名称', placeholder: '输入短剧名称', required: true, maxLength: 100, value: name, disabled: busy, onChange: e => setName(e.target.value) }),
          h('button', { type: 'submit', disabled: busy, style: button }, '新建短剧')),
          rows.length ? h('ul', { style: { paddingLeft: 16 } }, ...rows.map(p => h('li', { key: p.id },
            h('button', { disabled: busy, style: button, onClick: () => run(async () => { await openProject(p.id); show(false) }) }, p.name)))) : h('p', null, '暂无短剧，创建后开始讲述你的故事。'),
          error ? h('p', { role: 'alert' }, error) : null) : null)
    }
    const status = { queued: '排队中', running: '制作中', succeeded: '待预览', failed: '制作失败', unavailable: '状态暂不可用' }
    function ProjectPanel({ sessionId }) {
      const [project, setProject] = useState(null), [expanded, expand] = useState(false), [name, setName] = useState('')
      const [error, setError] = useState(''), [busy, setBusy] = useState(false), [confirmDelete, setConfirmDelete] = useState(false)
      const [revision, revise] = useState(0), generation = useRef(0)
      useEffect(() => {
        let active = true, timer
        generation.current++
        setBusy(false)
        const controller = new AbortController()
        setProject(null); setError(''); expand(false); setConfirmDelete(false)
        async function poll() {
          try {
            const value = await request({ session: sessionId }, undefined, controller.signal)
            if (active) { setProject(value); setError('') }
            if (!value) return
          } catch (e) { if (active) setError(e.message); if (e.status === 401) return }
          if (active) timer = setTimeout(poll, 5000)
        }
        poll()
        return () => { active = false; generation.current++; controller.abort(); clearTimeout(timer) }
      }, [sessionId, revision])
      const run = async action => {
        const current = generation.current
        setBusy(true); setError('')
        try {
          await action()
          const value = await request({ session: sessionId })
          if (current === generation.current) setProject(value)
        } catch (e) { if (current === generation.current) setError(e.message) }
        finally { if (current === generation.current) setBusy(false) }
      }
      if (!project) return error ? h('p', { role: 'alert' }, error, h('button', { onClick: () => revise(v => v + 1) }, '重试')) : null
      const mutate = (action, extra = {}) => request({}, { action, id: project.id, ...extra })
      const preview = (fields, key) => h('video', { key, controls: true, preload: 'metadata', src: mediaUrl(project.id, fields), style: { width: '100%', maxHeight: 230 } })
      return h('section', { 'aria-label': '当前短剧' },
        h('strong', null, project.name), ' ',
        h('button', { style: button, onClick: () => { expand(!expanded); setName(project.name) } }, expanded ? '收起项目' : '素材与成片'),
        project.jobs.some(j => ['running', 'queued'].includes(j.status)) ? h('span', { role: 'status' }, '制作中…') : null,
        error ? h('p', { role: 'alert' }, error) : null,
        expanded ? h('aside', { 'aria-label': '短剧资料与作品', style: { ...panel, position: 'fixed', right: 12, top: 60, bottom: 20, width: 'min(340px, calc(100vw - 56px))', zIndex: 100 } },
          h('button', { onClick: () => expand(false), style: { float: 'right' } }, '关闭'),
          h('h3', null, project.name),
          h('form', { onSubmit: e => { e.preventDefault(); run(() => mutate('rename', { name })) } },
            h('input', { 'aria-label': '重命名短剧', value: name, maxLength: 100, required: true, onChange: e => setName(e.target.value) }),
            h('button', { type: 'submit', disabled: busy, style: button }, '重命名')),
          h('details', null, h('summary', null, '已定创作要求'), h('p', { style: { whiteSpace: 'pre-wrap' } }, project.brief || '在对话中描述想法，确定后保存。')),
          h('h4', null, '参考素材'),
          h('label', null, '上传素材（每个最多100MB）', h('input', { type: 'file', disabled: busy, accept: '.png,.jpg,.jpeg,.webp,.mp4,.mp3,.wav', onChange: e => {
            const file = e.target.files?.[0]; e.target.value = ''; if (!file) return
            run(async () => {
              if (file.size > 100 * 1024 * 1024) throw new Error('单个素材不能超过100MB')
              const cfg = config(), response = await fetch(`${cfg.base}/asset?${new URLSearchParams({ id: project.id, name: file.name })}`, {
                method: 'PUT', headers: { 'X-Elysium-Token': cfg.token }, body: file })
              const value = await response.json(); if (!response.ok) throw new Error(value.error || '上传失败')
            })
          } })),
          ...project.assets.map(a => h('div', { key: a.id },
            h('a', { href: mediaUrl(project.id, { asset: a.id, download: '1' }) }, a.name),
            h('button', { disabled: busy, style: button, onClick: () => run(() => mutate('removeAsset', { assetId: a.id })) }, '移除'))),
          h('h4', null, '制作记录'),
          ...[...project.jobs].reverse().map((job, i) => h('div', { key: job.jobId },
            h('p', null, `版本 ${project.jobs.length - i} · ${status[job.status] || job.status}`),
            job.error ? h('p', null, typeof job.error === 'string' ? job.error : job.error.message || '制作失败，请在对话中查看原因') : null,
            job.has_video ? preview({ job: job.jobId }, job.jobId) : null,
            job.has_video ? h('button', { disabled: busy || project.exports.some(e => e.jobId === job.jobId), style: button,
              onClick: () => run(() => mutate('adopt', { jobId: job.jobId })) }, project.exports.some(e => e.jobId === job.jobId) ? '已采用' : '采用成片') : null)),
          h('h4', null, '已采用成片'),
          ...[...project.exports].reverse().map((e, i) => h('div', { key: `export-${e.jobId}` },
            preview({ export: e.jobId }, `export-${e.jobId}`),
            h('a', { href: mediaUrl(project.id, { export: e.jobId, download: '1' }) }, `下载成片 ${project.exports.length - i}`))),
          project.exports.length ? null : h('p', null, '预览后点击“采用成片”保存。'),
          h('hr'),
          confirmDelete ? h('div', null, h('p', null, '确认从项目列表删除？原始资料和聊天记录保留，项目将停止使用。'),
            h('button', { disabled: busy, onClick: () => run(async () => { await mutate('delete'); expand(false) }) }, '确认删除'),
            h('button', { onClick: () => setConfirmDelete(false) }, '取消')) : h('button', { disabled: busy, onClick: () => setConfirmDelete(true) }, '删除项目'),
          error ? h('p', { role: 'alert' }, error) : null) : null)
    }
    return { apply(ctx) {
      if (!window.__ELYSIUM_PROJECTS__) return
      ctx.inject(['sessions'], current => {
        const openProject = async id => {
          const value = await request({}, { action: 'open', id })
          await current.sessions.create({ sessionId: value.sessionId, cwd: value.cwd })
          current.sessions.open(value.sessionId)
        }
        current.slots.inject('sidebar.footer.action', () => current.slots.register({ name: 'sidebar.footer.action', id: 'elysium-projects', order: 20, inject: () => ({ openProject }) }, ProjectList))
        current.slots.inject('conversation.input.dock', () => current.slots.register({ name: 'conversation.input.dock', id: 'elysium-project', order: 5 }, ProjectPanel))
      })
    } }
  },
})
