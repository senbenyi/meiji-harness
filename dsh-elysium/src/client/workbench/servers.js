// 职责：展示手工登记服务器、检查结果、默认选择和下次启动生效的 LLM 选择。
load('elysium/servers', (require, exports) => {
  const { createElement: h, useState, useEffect } = require('react')
  const { serverRequest } = require('elysium/server-api')
  const { Editor } = require('elysium/dialog')
  const labels = { comfyui: '视频生成', llm: '聊天模型' }
  function ServerList({ guard }) {
    const [data, setData] = useState(null), [error, setError] = useState(''), [receipt, setReceipt] = useState('')
    const [busy, setBusy] = useState(false), [editor, setEditor] = useState(null), [checks, setChecks] = useState({})
    const refresh = async signal => setData(await serverRequest('list', null, signal))
    useEffect(() => { const controller = new AbortController(); refresh(controller.signal).catch(error => { if (!controller.signal.aborted) setError(error.message) }); return () => controller.abort() }, [])
    async function action(name, body) {
      if (busy) return
      setBusy(true); setError(''); setReceipt('')
      try {
        const value = await serverRequest(name, { ...body, revision: data.revision })
        if (name === 'check') setChecks(current => ({ ...current, [`${body.id}:${body.service}`]: value.message }))
        setReceipt(value.message || '操作完成。')
        await refresh()
      } catch (error) { setError(error.message) }
      finally { setBusy(false) }
    }
    function registerForm(service, transport) {
      setEditor({ service, transport })
    }
    async function register(draft) {
      const { service, transport } = editor
      const connection = transport === 'http' ? { transport, base_url: draft.base_url } : { transport, ssh_alias: draft.ssh_alias, remote_host: draft.remote_host, remote_port: Number(draft.remote_port), local_port: Number(draft.local_port), ...(service === 'llm' ? { api_path: '/v1' } : {}) }
      if (service === 'comfyui') connection.workload = 'minimax-h3'
      else { connection.model = 'qwen3.8-27b-elysium'; if (draft.api_key_env) connection.api_key_env = draft.api_key_env }
      const value = await serverRequest('register', { revision: data.revision, server: { id: draft.id, label: draft.label, provider: draft.provider, connection_source: 'manual', instance_id: draft.instance_id, deployment_id: draft.deployment_id, services: { [service]: connection } } })
      setReceipt(value.message); await refresh()
    }
    return h('section', { className: 'elysium-server-list', 'aria-label': '服务器设置' },
      h('h2', null, '服务器'),
      h('p', null, '登记已运行的服务。默认切换只影响新任务，旧任务和批次继续使用原服务器。'),
      data?.legacy ? h('p', null, '当前使用原有环境配置；登记清单后需检查并选择默认服务。') : null,
      data ? h('p', null, `聊天模型：${data.current_llm || '原启动配置'}${data.pending_llm ? `；下次启动：${data.pending_llm}` : ''}`) : null,
      h('button', { disabled: busy, onClick: () => refresh().catch(error => setError(error.message)) }, '刷新列表'),
      error ? h('p', { role: 'alert' }, error) : null,
      receipt ? h('p', { role: 'status' }, receipt) : null,
      data?.servers.map(server => h('article', { key: server.id },
        h('h3', null, server.label), h('p', null, `${server.id} · ${server.provider}${server.disabled ? ' · 已停用' : ''}`),
        server.services.map(({ kind, transport }) => h('div', { key: kind },
          h('p', null, `${labels[kind]} · ${transport.toUpperCase()}${data.active[kind] === server.id ? kind === 'llm' && data.pending_llm ? ' · 待启动生效' : ' · 默认' : ''}`),
          h('button', { disabled: busy || server.disabled, onClick: () => action('check', { id: server.id, service: kind }) }, `检查 ${server.label} ${labels[kind]}`),
          h('button', { disabled: busy || server.disabled || data.active[kind] === server.id, onClick: () => action('switch', { id: server.id, service: kind }) }, `使用 ${server.label} ${labels[kind]}`),
          checks[`${server.id}:${kind}`] ? h('p', null, checks[`${server.id}:${kind}`]) : null)),
        h('button', { disabled: busy || Object.values(data.active).includes(server.id), onClick: () => action('set-enabled', { id: server.id, enabled: server.disabled }) }, server.disabled ? '重新启用' : '停用'))),
      data ? h('div', null, h('h3', null, '手工登记'), ['comfyui', 'llm'].flatMap(service => ['http', 'ssh'].map(transport => h('button', { key: `${service}:${transport}`, disabled: busy, onClick: () => registerForm(service, transport) }, `添加${labels[service]} ${transport.toUpperCase()}`)))) : null,
      editor ? h(Editor, { title: `登记${labels[editor.service]} ${editor.transport.toUpperCase()}`, guard, close: () => setEditor(null), save: register,
        initial: { provider: 'manual', remote_host: '127.0.0.1', remote_port: editor.service === 'llm' ? '8000' : '8188' },
        fields: [['id', '服务器 ID'], ['label', '名称'], ['provider', '平台', [['manual', '其他'], ['featurize', 'Featurize'], ['vast', 'Vast.ai'], ['runpod', 'Runpod'], ['autodl', 'AutoDL']]], ['instance_id', '实例 ID'], ['deployment_id', '部署 ID'],
          ...(editor.transport === 'http' ? [['base_url', '服务 URL']] : [['ssh_alias', '本机 SSH 别名'], ['remote_host', '远端监听地址'], ['remote_port', '远端端口'], ['local_port', '独立本地端口']]),
          ...(editor.service === 'llm' ? [['api_key_env', 'API Key 环境变量名（可选）']] : [])] }) : null)
  }
  exports.ServerList = ServerList
})
