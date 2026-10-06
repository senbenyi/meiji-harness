import { markdownToHtml } from './markdown.js'
import { CANVAS_STAGES, canvasStageCounts, canvasStageForNode, nodesForCanvasStage } from './stages.js?v=12'

(function () {
  'use strict'

  const ROUTE_ROOT = '/dsh-short-video-studio'
  const TOKEN = window.__DSH_SVS_TOKEN__ || ''
  const params = new URLSearchParams(window.location.search)
  const sessionId = params.get('sessionId') || ''
  const workspaceId = params.get('workspaceId') || ''

  // ---- 主题：跟随 DSH 的浅色/深色 ----
  // 首屏由 index.html 的 inline 脚本定（?theme= 优先，其次系统偏好），这里只管**运行中**的跟随：
  // 宿主 lib/client.js 在 DSH 主题变化时 postMessage 过来。监听器在 load() 之前注册，
  // 所以即使画布数据加载失败，主题跟随仍然有效。
  const THEME_CHANNEL = 'dsh-short-video-studio'
  function applyTheme(t) {
    if (t !== 'light' && t !== 'dark') return
    if (document.documentElement.getAttribute('data-theme') === t) return
    document.documentElement.setAttribute('data-theme', t)
  }
  window.addEventListener('message', (e) => {
    // 只认同源消息；再用 channel + type 把主题消息和其他消息区分开
    if (e.origin !== window.location.origin) return
    const d = e.data
    if (d && d.channel === THEME_CHANNEL && d.type === 'theme') applyTheme(d.theme)
  })
  // 宿主没给 ?theme=（宿主没装主题服务，或本页被单独打开）时跟随系统，并在系统切换时跟着变
  if (!params.get('theme') && typeof matchMedia === 'function') {
    const mq = matchMedia('(prefers-color-scheme: dark)')
    const syncTheme = () => applyTheme(mq.matches ? 'dark' : 'light')
    syncTheme()
    if (typeof mq.addEventListener === 'function') mq.addEventListener('change', syncTheme)
  }

  const el = {
    canvas: document.getElementById('canvas'),
    meta: document.getElementById('meta'),
    refresh: document.getElementById('refresh'),
    jump: document.getElementById('jump'),
    addUpload: document.getElementById('add-upload'),
    addAssets: document.getElementById('add-assets'),
    stageTabs: document.getElementById('stage-tabs'),
  }

  // 最新主线节点 id（渲染时记录，供空白点击和自动跟随定位）
  let latestMainNodeId = null
  let followInited = false
  let followTimer = null
  let lastMainIds = new Set()
  let activeStageKey = 'overview'
  let currentProject = null

  function renderStageTabs(nodes, production) {
    if (!el.stageTabs) return
    const counts = canvasStageCounts(nodes)
    el.stageTabs.innerHTML = ''
    if (nodes.length === 0) return
    for (const stage of CANVAS_STAGES) {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'stage-tab'
      button.setAttribute('role', 'tab')
      button.setAttribute('aria-selected', stage.key === activeStageKey ? 'true' : 'false')
      const progress = production?.stages?.find((item) => item.key === stage.key)
      const labels = { completed: '已完成', active: '进行中', pending: '待执行', blocked: '已阻塞' }
      button.innerHTML = '<strong>' + stage.label + '</strong><span>'
        + (progress ? `${labels[progress.status]} · ${progress.completed}/${progress.total}` : stage.key === 'overview' && production ? `流程${labels[production.status]} · 质量未审核` : (stage.key === 'overview' ? '全部 ' : '') + counts[stage.key] + ' 项产物') + '</span>'
      if (progress?.errors?.length) button.title = progress.errors.map((item) => item.error).join('\n')
      button.onclick = () => {
        if (activeStageKey === stage.key || !currentProject) return
        activeStageKey = stage.key
        render(currentProject)
        el.canvas.scrollTop = 0
      }
      el.stageTabs.appendChild(button)
    }
  }

  function apiUrl(action) {
    // action 可能自带 query（如 '/canvas/node?id=…'），此时用 & 拼接，避免第二个 ? 把 sessionId 吞进参数值
    const u = new URLSearchParams({ sessionId, workspaceId })
    return ROUTE_ROOT + '/api' + action + (action.includes('?') ? '&' : '?') + u.toString()
  }

  async function api(action, init) {
    const res = await fetch(apiUrl(action), {
      ...init,
      headers: { 'content-type': 'application/json', 'x-dsh-svs-token': TOKEN, ...(init?.headers || {}) },
    })
    if (!res.ok) {
      let msg = res.status
      try { msg = (await res.json()).message || msg } catch {}
      throw new Error(msg)
    }
    return res.json()
  }

  function mediaUrl(media) {
    const u = new URLSearchParams({ token: TOKEN, sessionId, workspaceId, path: media })
    return ROUTE_ROOT + '/media?' + u.toString()
  }

  /** 资产库缩略图地址（asset=<id> 由服务端从 .dsh-assets 解析伺服）。 */
  function assetMediaUrl(assetId) {
    const u = new URLSearchParams({ token: TOKEN, sessionId, workspaceId, asset: assetId })
    return ROUTE_ROOT + '/media?' + u.toString()
  }

  const ASSET_TYPE_LABEL = { character: '角色', scene: '场景', style: '风格锚点', clip: '视频片段', text: '文本' }
  const ASSET_TYPE_ORDER = ['character', 'scene', 'style', 'clip', 'text']
  const UPLOAD_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif'
  const UPLOAD_MAX_BYTES = 24 * 1024 * 1024

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  }

  function renderTextContent(content) {
    // 完整 markdown 渲染（与 lib/index.js 共享 studio/markdown.js）：标题/表格/列表/引用/代码块/粗体等
    return '<div class="text-content">' + markdownToHtml(content) + '</div>'
  }

  // ---- 节点分区（主线优先预览）----
  // 主线：确认通过 / 等待确认的现行资产（默认，即非作废、非抽帧）。
  // 抽帧：extract_frame 抽出的末帧/首帧/检查帧（params.capability=image.from_video 或标题含 检查帧/抽帧/帧检查）。
  // 作废：用户在卡片上点的「作废」（params.deprecated），或流程里被替换/否定的旧版（标题含 废弃/作废/已弃用 等）。
  const FRAME_TITLE_RE = /(检查帧|抽帧|帧检查)/
  const DEPRECATED_TITLE_RE = /(废弃|作废|已弃用|superseded|obsolete)/i
  const TRUTHY = new Set([true, 1, 'true', '1', 'yes'])

  function nodeLane(node) {
    const p = node.params || {}
    const title = node.title || ''
    if (p.capability === 'image.from_video' || FRAME_TITLE_RE.test(title)) return 'frames'
    if (TRUTHY.has(p.deprecated) || node.status === 'deprecated' || node.status === 'rejected' || DEPRECATED_TITLE_RE.test(title)) return 'discard'
    return 'main'
  }

  function isFrameNode(node) {
    return nodeLane(node) === 'frames'
  }

  function askAi(text) {
    window.parent.postMessage({ channel: 'dsh-short-video-studio', type: 'ask-ai', text }, window.location.origin)
  }

  // ---- 页面内对话框（iframe 内原生 alert/confirm/prompt 可能被禁用，改用 DOM 自绘）----
  let _modalHost
  function ensureModalHost() {
    if (_modalHost && document.body.contains(_modalHost)) return _modalHost
    _modalHost = document.createElement('div')
    _modalHost.id = 'dsh-svs-modal'
    document.body.appendChild(_modalHost)
    return _modalHost
  }

  /** 自绘模态。opts = { okText, cancel }。resolve(true) 确认 / resolve(false) 取消。 */
  function modal(message, opts) {
    const o = opts || {}
    return new Promise((resolve) => {
      const host = ensureModalHost()
      host.innerHTML = ''
      host.className = 'svs-modal-host'
      const box = document.createElement('div')
      box.className = 'svs-modal'
      const p = document.createElement('p')
      p.textContent = message
      box.appendChild(p)
      const actions = document.createElement('div')
      actions.className = 'svs-modal-actions'
      const close = (val) => { host.remove(); resolve(val) }
      if (o.cancel) {
        const no = document.createElement('button')
        no.className = 'btn'
        no.textContent = '取消'
        no.onclick = () => close(false)
        actions.appendChild(no)
      }
      const yes = document.createElement('button')
      yes.className = 'btn btn-accent'
      yes.textContent = o.okText || '确定'
      yes.onclick = () => close(true)
      actions.appendChild(yes)
      box.appendChild(actions)
      host.appendChild(box)
    })
  }

  const confirmBox = (message) => modal(message, { okText: '删除', cancel: true })
  const alertBox = (message) => modal(message, { okText: '知道了' })

  // ---- 自绘大对话框（资产库取用），返回 body / 底部按钮栏 / close ----
  function openDialog(titleText) {
    const host = document.createElement('div')
    host.className = 'dialog-host'
    const box = document.createElement('div')
    box.className = 'dialog'
    const head = document.createElement('div')
    head.className = 'dialog-title'
    const t = document.createElement('span')
    t.textContent = titleText
    const x = document.createElement('button')
    x.className = 'btn dialog-x'
    x.textContent = '✕'
    x.title = '关闭'
    const body = document.createElement('div')
    body.className = 'dialog-body'
    const foot = document.createElement('div')
    foot.className = 'dialog-actions'
    head.appendChild(t)
    head.appendChild(x)
    box.appendChild(head)
    box.appendChild(body)
    box.appendChild(foot)
    host.appendChild(box)
    document.body.appendChild(host)
    const close = () => host.remove()
    x.addEventListener('click', close)
    return { body, foot, close }
  }

  function dialogBtn(text, onClick, cls) {
    const b = document.createElement('button')
    b.className = 'btn' + (cls ? ' ' + cls : '')
    b.type = 'button'
    b.textContent = text
    b.addEventListener('click', onClick)
    return b
  }

  /** 读取本地文件为 base64 dataURL。 */
  function readFileDataUrl(file) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader()
      fr.onload = () => resolve(fr.result)
      fr.onerror = () => reject(new Error('读取失败：' + file.name))
      fr.readAsDataURL(file)
    })
  }

  /**
   * 手动添加资产 ①：从本机选图上传 → 画布资产卡。
   * 上传的图片可直接用于当前画布。
   */
  async function chooseFilesAndUpload() {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = UPLOAD_ACCEPT
    input.multiple = true
    input.addEventListener('change', async () => {
      const files = Array.from(input.files || [])
      if (!files.length) return
      const okFiles = files.filter((f) => f.size <= UPLOAD_MAX_BYTES)
      const skipped = files.filter((f) => f.size > UPLOAD_MAX_BYTES).map((f) => f.name)
      if (!okFiles.length) {
        alertBox('所选图片均超过 24MB，无法上传。')
        return
      }
      let reading = []
      for (const f of okFiles) {
        try {
          reading.push({ filename: f.name, dataUrl: await readFileDataUrl(f) })
        } catch (e) {
          skipped.push(f.name + '（' + e.message + '）')
        }
      }
      if (!reading.length) {
        alertBox('没有可上传的图片。')
        return
      }
      try {
        const d = await api('/canvas/upload', {
          method: 'POST',
          body: JSON.stringify({ files: reading }),
        })
        let msg = '已添加 ' + d.added.length + ' 张资产卡'
        if (d.added.length) msg += '：' + d.added.map((x) => x.title).join('、')
        const problems = (d.errors || []).map((e) => (e.filename || '?') + '（' + e.message + '）').concat(skipped)
        if (problems.length) msg += '\n失败 ' + problems.length + ' 项：' + problems.join('；')
        alertBox(msg)
      } catch (e) {
        alertBox('上传失败：' + (e.message || String(e)))
      }
      await load()
    })
    input.click()
  }

  /** 编辑 image 资产卡：选一张本地图片替换该节点图片（保留节点 id / 标题）。 */
  function replaceImageByUpload(node) {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = UPLOAD_ACCEPT
    input.addEventListener('change', async () => {
      const f = (input.files || [])[0]
      if (!f) return
      if (f.size > UPLOAD_MAX_BYTES) {
        alertBox('图片超过 24MB 上限，请压缩后再试。')
        return
      }
      let dataUrl
      try {
        dataUrl = await readFileDataUrl(f)
      } catch (e) {
        alertBox('读取失败：' + (e.message || String(e)))
        return
      }
      try {
        const d = await api('/canvas/node/replace-image', {
          method: 'POST',
          body: JSON.stringify({ nodeId: node.id, filename: f.name, dataUrl }),
        })
        let msg = '已用本地上传替换「' + (node.title || node.id) + '」的图片'
        if (d.assetIdCleared) {
          msg += '\n该卡此前已入库（' + d.prevAssetId + '），替换后已解除绑定。'
        }
        alertBox(msg)
      } catch (e) {
        alertBox('替换失败：' + (e.message || String(e)))
      }
      await load()
    })
    input.click()
  }

  /** 手动添加资产 ②：从跨会话资产库带缩略图取用 / 删除。 */
  async function openAssetLibrary() {
    const dlg = openDialog('跨会话资产库 · 点卡片加入画布')
    const body = dlg.body
    const foot = dlg.foot

    async function render() {
      body.innerHTML = ''
      foot.innerHTML = ''
      let assets = []
      try {
        const d = await api('/assets')
        assets = (d && d.assets) || []
      } catch (e) {
        const p = document.createElement('p')
        p.className = 'lib-empty-hint'
        p.textContent = '读取资产库失败：' + (e.message || String(e))
        body.appendChild(p)
        foot.appendChild(dialogBtn('关闭', () => dlg.close()))
        return
      }

      if (!assets.length) {
        const p = document.createElement('p')
        p.className = 'lib-empty-hint'
        p.innerHTML = '资产库还是空的。'
        body.appendChild(p)
        foot.appendChild(dialogBtn('完成', () => dlg.close()))
        return
      }

      const grid = document.createElement('div')
      grid.className = 'asset-grid'
      const sorted = [...assets].sort((a, b) => {
        const ta = ASSET_TYPE_ORDER.indexOf(a.type)
        const tb = ASSET_TYPE_ORDER.indexOf(b.type)
        return (ta < 0 ? 99 : ta) - (tb < 0 ? 99 : tb) || String(a.name || '').localeCompare(String(b.name || ''), 'zh')
      })
      let lastType = ''
      for (const a of sorted) {
        if (a.type !== lastType) {
          lastType = a.type
          const h = document.createElement('div')
          h.className = 'asset-group-title'
          h.textContent = (ASSET_TYPE_LABEL[a.type] || a.type) + ' · ' + (a.state && a.state !== 'default' ? a.state + ' ' : '') + sorted.filter((x) => x.type === a.type).length
          grid.appendChild(h)
        }
        const card = document.createElement('div')
        card.className = 'asset-card'
        card.dataset.assetId = a.id

        const kind = a.kind || 'image'
        const thumb = document.createElement('div')
        thumb.className = 'thumb'
        if (kind === 'text') {
          // 文本资产没有文件：显示正文摘要（取首几行，超出用省略号）
          const pre = document.createElement('div')
          pre.className = 'text-preview'
          const t = String(a.text || '').replace(/\s+/g, ' ').trim()
          pre.textContent = t.length > 180 ? t.slice(0, 180) + '…' : (t || '（空文本）')
          thumb.appendChild(pre)
        } else {
          const media = kind === 'video' ? document.createElement('video') : document.createElement('img')
          if (kind === 'video') {
            media.muted = true
            media.playsInline = true
            media.preload = 'metadata'
            media.controls = false
          } else {
            media.loading = 'lazy'
          }
          media.alt = a.id || ''
          media.src = assetMediaUrl(a.id)
          media.onerror = () => {
            media.remove()
            const m = document.createElement('span')
            m.className = 'missing'
            m.textContent = kind === 'video' ? '🎬 视频缺失' : '🖼 图缺失'
            thumb.appendChild(m)
          }
          thumb.appendChild(media)
          if (kind === 'video') {
            const badge = document.createElement('span')
            badge.className = 'kind-badge'
            badge.textContent = '🎬 视频'
            thumb.appendChild(badge)
          }
        }
        card.appendChild(thumb)

        const info = document.createElement('div')
        info.className = 'info'
        const tag = document.createElement('span')
        tag.className = 'asset-tag ' + (a.type || '')
        tag.textContent = ASSET_TYPE_LABEL[a.type] || a.type || 'asset'
        info.appendChild(tag)
        const name = document.createElement('div')
        name.className = 'name'
        name.textContent = a.name || a.id
        info.appendChild(name)
        const idLine = document.createElement('div')
        idLine.className = 'id'
        idLine.textContent = a.id
        info.appendChild(idLine)
        card.appendChild(info)

        const acts = document.createElement('div')
        acts.className = 'actions'
        const addBtn = dialogBtn('＋ 加入画布', async () => {
          addBtn.disabled = true
          addBtn.textContent = '添加中…'
          try {
            await api('/assets/to-canvas', { method: 'POST', body: JSON.stringify({ id: a.id }) })
            addBtn.textContent = '已添加 ✓'
          } catch (e) {
            addBtn.textContent = '重试'
            addBtn.disabled = false
            alertBox('添加失败：' + (e.message || String(e)))
          }
        }, 'btn-accent')
        acts.appendChild(addBtn)

        const delBtn = dialogBtn('删除', async () => {
          const okToDelete = await confirmBox(
            '从资产库删除 ' + a.id + ' ？\n\n' +
            '· 库里的索引会被移除' + (kind === 'text' ? '（文本内容一并删除）' : '，文件同时清理') + '\n' +
            '· 已经取到画布上的卡片**不受影响**（它们各自持有副本）\n' +
            '· Agent 之后不能再引用这个资产 id'
          )
          if (!okToDelete) return
          delBtn.disabled = true
          delBtn.textContent = '删除中…'
          try {
            await api('/assets?id=' + encodeURIComponent(a.id), { method: 'DELETE' })
            await render()
          } catch (e) {
            delBtn.textContent = '重试'
            delBtn.disabled = false
            alertBox('删除失败：' + (e.message || String(e)))
          }
        }, 'btn-danger')
        acts.appendChild(delBtn)
        card.appendChild(acts)
        grid.appendChild(card)
      }
      body.appendChild(grid)
      foot.appendChild(dialogBtn('完成（刷新画布）', () => {
        dlg.close()
        load()
      }, 'btn-accent'))
    }

    await render()
  }

  function paramsSummary(node) {
    if (!node.params || typeof node.params !== 'object') return ''
    const keys = ['model', 'seed', 'width', 'height', 'length', 'steps', 'guidance']
    const parts = keys.filter((k) => node.params[k] !== undefined && node.params[k] !== null)
      .map((k) => k + '=' + node.params[k])
    return parts.join(' · ')
  }

  function nodeCard(node) {
    const card = document.createElement('div')
    card.className = 'node'
    card.dataset.nodeId = node.id
    const lane = nodeLane(node)
    if (lane === 'discard') card.classList.add('deprecated')
    else if (lane === 'frames') card.classList.add('frame-node')

    const head = document.createElement('div')
    head.className = 'node-head'
    const title = document.createElement('div')
    title.className = 'node-title'
    title.textContent = node.title || '(无标题)'
    const status = document.createElement('span')
    status.className = 'status ' + (lane === 'discard' ? 'deprecated' : (node.status || 'ready'))
    status.textContent = lane === 'discard' ? '作废' : (node.status || 'ready')
    const id = document.createElement('span')
    id.className = 'node-id'
    id.textContent = (node.id || '').slice(0, 8)
    head.appendChild(title)
    head.appendChild(status)
    const meta = document.createElement('div')
    meta.className = 'node-meta'
    meta.appendChild(id)
    const ps = paramsSummary(node)
    if (ps) {
      const p = document.createElement('span')
      p.className = 'params'
      p.textContent = ps
      meta.appendChild(p)
    }
    head.appendChild(meta)
    card.appendChild(head)

    const body = document.createElement('div')
    body.className = 'node-body'

    if (node.media) {
      if (node.kind === 'video') {
        const v = document.createElement('video')
        v.className = 'media'
        v.controls = true
        v.src = mediaUrl(node.media)
        body.appendChild(v)
      } else if (node.kind === 'image') {
        const a = document.createElement('a')
        a.href = mediaUrl(node.media)
        a.target = '_blank'
        const img = document.createElement('img')
        img.className = 'media'
        img.src = mediaUrl(node.media)
        img.alt = node.title || ''
        a.appendChild(img)
        body.appendChild(a)
      } else {
        // audio / fallback：给下载链接
        const a = document.createElement('a')
        a.href = mediaUrl(node.media)
        a.target = '_blank'
        a.textContent = '下载媒体'
        body.appendChild(a)
      }
    }

    if (node.content) {
      const contentWrap = document.createElement('div')
      contentWrap.innerHTML = renderTextContent(node.content)
      body.appendChild(contentWrap)
    }

    if (node.error) {
      const err = document.createElement('div')
      err.className = 'error-line'
      err.textContent = '错误: ' + node.error
      body.appendChild(err)
    }

    card.appendChild(body)

    // Domain projections are read through their owning commands, never edited as canvas copies.
    if (node.domainProjection) return card

    // actions
    const actions = document.createElement('div')
    actions.className = 'node-actions'

    if (node.kind === 'text' || node.kind === 'table') {
      const editBtn = document.createElement('button')
      editBtn.className = 'btn'
      editBtn.textContent = '编辑'
      editBtn.onclick = () => startEdit(node, card, body)
      actions.appendChild(editBtn)
    } else if (node.kind === 'image') {
      // image 节点「编辑」= 用本地上传图替换本卡（保留节点/标题；原图留在磁盘）
      const editBtn = document.createElement('button')
      editBtn.className = 'btn'
      editBtn.textContent = '编辑'
      editBtn.title = '上传本地图片替换本卡图片（若已入库会解除绑定）'
      editBtn.onclick = () => replaceImageByUpload(node)
      actions.appendChild(editBtn)
    }

    const redoBtn = document.createElement('button')
    redoBtn.className = 'btn'
    redoBtn.textContent = '重做'
    redoBtn.onclick = () => askAi('重做画布节点 ' + (node.id || '') + '（' + (node.title || node.kind) + '）：请按画布当前参数重新生成/重写该节点。')
    actions.appendChild(redoBtn)

    // 作废 / 还原：把用户否定的、被替换的旧版移出主线预览（可随时还原）；抽帧中间产物不用此按钮
    if (!isFrameNode(node)) {
      const depBtn = document.createElement('button')
      depBtn.className = 'btn'
      const isDep = nodeLane(node) === 'discard'
      depBtn.textContent = isDep ? '还原' : '作废'
      depBtn.title = isDep ? '恢复到主线（作废标记会清除）' : '移出主线预览（作废/否定，可随时还原）'
      depBtn.onclick = async () => {
        depBtn.disabled = true
        try {
          await toggleDeprecated(node.id, !isDep)
        } catch (e) {
          alertBox('操作失败：' + (e.message || String(e)))
        }
        await load()
      }
      actions.appendChild(depBtn)
    }

    const up = document.createElement('button')
    up.className = 'btn'
    up.textContent = '↑'
    up.title = '上移'
    up.onclick = () => moveNode(node.id, -1)
    actions.appendChild(up)
    const down = document.createElement('button')
    down.className = 'btn'
    down.textContent = '↓'
    down.title = '下移'
    down.onclick = () => moveNode(node.id, 1)
    actions.appendChild(down)

    card.appendChild(actions)
    return card
  }

  function startEdit(node, card, body) {
    const ta = document.createElement('textarea')
    ta.className = 'edit'
    ta.value = node.content || ''
    body.innerHTML = ''
    body.appendChild(ta)
    ta.focus()

    const save = async () => {
      const content = ta.value
      await updateNode(node.id, { content })
      await load()
    }
    ta.addEventListener('blur', save)
    ta.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); save() }
      if (e.key === 'Escape') { load() }
    })
  }

  async function updateNode(id, patch) {
    const body = { id, ...patch }
    await api('/canvas/node', { method: 'POST', body: JSON.stringify(body) })
  }

  async function moveNode(id, delta) {
    const project = await api('/canvas')
    const nodes = [...project.nodes].sort((a, b) => (a.order || 0) - (b.order || 0))
    const idx = nodes.findIndex((n) => n.id === id)
    if (idx < 0) return
    const target = idx + delta
    if (target < 0 || target >= nodes.length) return
    ;[nodes[idx], nodes[target]] = [nodes[target], nodes[idx]]
    await api('/canvas/reorder', { method: 'POST', body: JSON.stringify({ nodeIds: nodes.map((n) => n.id) }) })
    await load()
  }

  function render(project) {
    currentProject = project
    el.canvas.innerHTML = ''
    const allNodes = [...(project.nodes || [])].sort((a, b) => (a.order || 0) - (b.order || 0))
    renderStageTabs(allNodes, project.production)
    const nodes = nodesForCanvasStage(allNodes, activeStageKey)
    const allMain = allNodes.filter((node) => nodeLane(node) === 'main')
    const allFrames = allNodes.filter((node) => nodeLane(node) === 'frames')
    const allDiscards = allNodes.filter((node) => nodeLane(node) === 'discard')

    // 分区：主线（确认/待确认的现行资产）优先；抽帧与作废各自收纳到页尾折叠区
    const main = []
    const frames = []
    const discards = []
    for (const n of nodes) {
      const lane = nodeLane(n)
      if (lane === 'frames') frames.push(n)
      else if (lane === 'discard') discards.push(n)
      else main.push(n)
    }

    el.meta.textContent = allNodes.length === 0 ? '' : '画幅 ' + (project.settings?.aspectRatio || '16:9')
      + (project.settings?.duration ? ' · 时长 ' + project.settings.duration : '')
      + ' · 音频 ' + (project.settings?.audioMode || 'native')
      + ' · 档位 ' + (project.settings?.mode || 'quality')
      + ' · 节点 ' + allNodes.length
      + (allNodes.length ? '（主线 ' + allMain.length + (allFrames.length ? ' · 抽帧 ' + allFrames.length : '') + (allDiscards.length ? ' · 作废 ' + allDiscards.length : '') + '）' : '')

    if (allNodes.length === 0) {
      latestMainNodeId = null
      lastMainIds = new Set()
      syncJump()
      return
    }

    if (nodes.length === 0) {
      latestMainNodeId = allMain.length ? allMain[allMain.length - 1].id : null
      lastMainIds = new Set(allMain.map((node) => node.id))
      syncJump()
      return
    }

    for (const n of main) el.canvas.appendChild(nodeCard(n))

    // 页尾收纳区：作废/否定（可还原）与抽帧/检查帧（中间产物），默认折叠，不打断主线预览
    if (discards.length) el.canvas.appendChild(laneSection('discard', discards))
    if (frames.length) el.canvas.appendChild(laneSection('frames', frames))

    // 最新主线节点 = 主线里 createdAt / order 最大者（进入画布和主线更新时自动定位）
    let latestMain = null
    for (const n of allMain) {
      if (!latestMain || ((n.createdAt || n.order || 0) >= (latestMain.createdAt || latestMain.order || 0))) latestMain = n
    }
    latestMainNodeId = latestMain ? latestMain.id : null
    lastMainIds = new Set(allMain.map((n) => n.id)) // 跟随模式轮询用：比对主线节点集合，发现新增才刷新
    syncJump()
  }

  /** 页尾折叠收纳区（作废 / 抽帧各一个）。 */
  function laneSection(lane, list) {
    const det = document.createElement('details')
    det.className = 'lane lane-' + lane
    const sum = document.createElement('summary')
    const isDiscard = lane === 'discard'
    const icon = isDiscard ? '♻️' : '🎞'
    const label = isDiscard ? '作废 / 否定（可还原）' : '抽帧 / 检查帧（中间产物）'
    sum.title = isDiscard
      ? '被替换的旧版 / 用户否定的资产，折叠保存历史，点卡片「还原」可回到主线'
      : '末帧串联、转场首末帧、AI 自检检查帧等抽帧产物，默认折叠不影响主线预览，确认无用后可删除'
    sum.innerHTML = '<span class="lane-icon">' + icon + '</span><span class="lane-label">' + label + '</span><span class="lane-count">' + list.length + '</span>'
    det.appendChild(sum)
    const body = document.createElement('div')
    body.className = 'lane-body'
    for (const n of list) body.appendChild(nodeCard(n))
    det.appendChild(body)
    return det
  }

  async function toggleDeprecated(id, deprecated) {
    const project = await api('/canvas')
    const n = project.nodes.find((x) => x.id === id)
    if (!n) return
    const params = { ...(n.params || {}) }
    if (deprecated) params.deprecated = true
    else delete params.deprecated
    await updateNode(id, { params })
  }

  /** 悬浮 top/bottom 按钮：在顶端显示 BOTTOM（到达底部），离开顶端显示 TOP（返回顶端）。 */
  function syncJump() {
    const c = el.canvas
    const canScroll = c.scrollHeight > c.clientHeight + 4
    if (!canScroll) {
      el.jump.classList.remove('show')
      return
    }
    el.jump.classList.add('show')
    const atTop = c.scrollTop <= 24
    if (atTop) {
      el.jump.textContent = '↓ BOTTOM'
      el.jump.title = '到达底部'
    } else {
      el.jump.textContent = '↑ TOP'
      el.jump.title = '返回顶端'
    }
  }

  /** 平滑滚动到指定节点并在卡片上闪一下。 */
  function locateNode(nodeId) {
    const card = el.canvas.querySelector('.node[data-node-id="' + nodeId + '"]')
    if (!card) return
    const c = el.canvas
    const rect = card.getBoundingClientRect()
    const top = rect.top - c.getBoundingClientRect().top + c.scrollTop
    const target = Math.max(0, top - (c.clientHeight - rect.height) / 2)
    c.scrollTo({ top: target, behavior: 'smooth' })
    card.classList.remove('flash')
    void card.offsetWidth // 重启动画
    card.classList.add('flash')
  }

  /** 定位到最新主线节点（进入画布、主线更新或点击空白时共用）。 */
  function locateLatest() {
    if (!latestMainNodeId) return
    if (activeStageKey !== 'overview' && currentProject) {
      activeStageKey = 'overview'
      render(currentProject)
      requestAnimationFrame(() => locateNode(latestMainNodeId))
      return
    }
    locateNode(latestMainNodeId)
  }

  // 进入或切回画布时定位到最新主线；停留期间每 2.5s 轮询，发现新增主线节点后自动跟随。
  function initAutoFollow() {
    if (followInited) return
    followInited = true

    // 切回画布 tab（iframe 由隐藏变可见 / 重挂载可见）→ 定位到最新主线
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        scheduleLocate()
        startFollowTimer()
      } else {
        stopFollowTimer()
      }
    })
    if (document.visibilityState === 'visible') {
      scheduleLocate()
      startFollowTimer()
    }
  }

  function scheduleLocate() {
    setTimeout(() => locateLatest(), 150)
  }

  function startFollowTimer() {
    if (followTimer) return
    followTimer = setInterval(pollFollow, 2500)
  }

  function stopFollowTimer() {
    if (followTimer) {
      clearInterval(followTimer)
      followTimer = null
    }
  }

  /** 用户正在编辑/弹窗时跳过轮询，避免打断输入。 */
  function isBusyEditing() {
    const ae = document.activeElement
    if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.tagName === 'SELECT')) return true
    const modalHost = document.getElementById('dsh-svs-modal')
    if (modalHost && modalHost.childElementCount) return true
    return !!document.querySelector('textarea.edit')
  }

  /** 轮询：Agent 对话期间新增了主线节点 → 重渲染（保留已展开的收纳区）并滚动到新节点。 */
  async function pollFollow() {
    if (document.visibilityState !== 'visible' || isBusyEditing()) return
    try {
      const project = await api('/canvas')
      const mains = (project.nodes || []).filter((n) => nodeLane(n) === 'main')
      const fresh = mains.filter((n) => !lastMainIds.has(n.id))
      if (fresh.length === 0) return
      const target = [...fresh].sort((a, b) => (Number(b.order) || b.createdAt || 0) - (Number(a.order) || a.createdAt || 0))[0]
      const openLanes = [...el.canvas.querySelectorAll('details.lane[open]')]
        .map((d) => [...d.classList].find((c) => c.startsWith('lane-')))
        .filter(Boolean)
      activeStageKey = canvasStageForNode(target) || 'overview'
      render(project)
      for (const name of openLanes) {
        const d = el.canvas.querySelector('details.' + name)
        if (d) d.open = true
      }
      locateNode(target.id)
    } catch { /* 单轮轮询失败静默，下轮重试 */ }
  }

  async function load() {
    el.refresh.disabled = true
    try {
      const project = await api('/canvas')
      render(project)
      initAutoFollow()
    } catch (err) {
      el.canvas.innerHTML = '<div class="empty"><h2>加载失败</h2><p class="error-line">' + escapeHtml(err.message || String(err)) + '</p></div>'
    } finally {
      el.refresh.disabled = false
    }
  }

  el.refresh.addEventListener('click', load)

  // 手动添加资产：顶栏按钮
  if (el.addUpload) el.addUpload.addEventListener('click', () => chooseFilesAndUpload())
  if (el.addAssets) el.addAssets.addEventListener('click', () => openAssetLibrary())

  // 点击画布空白处 → 定位到最新主线节点（点卡片/按钮等交互元素不触发）
  el.canvas.addEventListener('click', (e) => {
    if (e.target === el.canvas && latestMainNodeId) locateLatest()
  })
  if (el.jump) {
    el.jump.addEventListener('click', () => {
      const c = el.canvas
      const atTop = c.scrollTop <= 24
      c.scrollTo({ top: atTop ? c.scrollHeight : 0, behavior: 'smooth' })
    })
  }
  el.canvas.addEventListener('scroll', syncJump, { passive: true })
  window.addEventListener('resize', syncJump)

  if (!sessionId) {
    el.canvas.innerHTML = ''
    syncJump()
  } else {
    load()
  }
})()
