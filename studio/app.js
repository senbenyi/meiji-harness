import { markdownToHtml } from './markdown.js'
import { CANVAS_STAGES, canvasStageCounts, canvasStageForNode, nodesForCanvasStage } from './stages.js?v=13'

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
    assetTools: document.getElementById('asset-tools'),
  }

  let followInited = false
  let followTimer = null
  let activeStageKey = 'overview'
  let activeEpisodeId = ''
  let currentProject = null
  let pendingProject = null
  const readingPositions = new Map()
  const expandedDetails = new Set()
  const progressLabels = { completed: '已完成', active: '制作中', pending: '待制作', blocked: '需处理' }

  function selectStage(key) {
    rememberReading()
    activeStageKey = key
    render(currentProject)
  }

  function rememberReading() {
    readingPositions.set(readingKey(), el.canvas.scrollTop)
    for (const detail of el.canvas.querySelectorAll('details[data-key]')) {
      if (detail.open) expandedDetails.add(detail.dataset.key)
      else expandedDetails.delete(detail.dataset.key)
    }
  }

  function readingKey() {
    return activeStageKey + (['scripts', 'storyboard', 'media'].includes(activeStageKey) ? activeEpisodeId : '')
  }

  function renderStageTabs(production) {
    if (!el.stageTabs) return
    el.stageTabs.innerHTML = ''
    for (const stage of CANVAS_STAGES) {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'stage-tab'
      button.setAttribute('role', 'tab')
      button.setAttribute('aria-selected', stage.key === activeStageKey ? 'true' : 'false')
      const progress = production?.stages?.find((item) => item.key === stage.key)
      button.textContent = stage.label
      if (progress?.status === 'blocked') {
        button.classList.add('needs-attention')
        button.setAttribute('aria-label', stage.label + '，需处理')
      }
      if (progress?.errors?.length) button.title = progress.errors.map((item) => item.error).join('\n')
      button.onclick = () => {
        if (activeStageKey === stage.key || !currentProject) return
        selectStage(stage.key)
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
    const dlg = openDialog('公共素材库')
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
        p.textContent = '读取公共素材库失败：' + (e.message || String(e))
        body.appendChild(p)
        foot.appendChild(dialogBtn('关闭', () => dlg.close()))
        return
      }

      if (!assets.length) {
        const p = document.createElement('p')
        p.className = 'lib-empty-hint'
        p.textContent = '暂无公共素材。这里保存跨项目使用的素材，当前项目设定请在“角色与场景”查看。'
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
        tag.textContent = ASSET_TYPE_LABEL[a.type] || '其他素材'
        info.appendChild(tag)
        const name = document.createElement('div')
        name.className = 'name'
        name.textContent = a.name || '未命名素材'
        info.appendChild(name)
        const idLine = document.createElement('div')
        idLine.className = 'id'
        idLine.textContent = a.id
        const detail = detailSection('素材详情', 'library:' + a.id)
        detail.appendChild(idLine)
        info.appendChild(detail)
        card.appendChild(info)

        const acts = document.createElement('div')
        acts.className = 'actions'
        const addBtn = dialogBtn('加入项目', async () => {
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
            '从公共素材库删除“' + (a.name || '未命名素材') + '”？\n\n' +
            '素材及其' + (kind === 'text' ? '文本' : '文件') + '将被删除，之后无法再次添加。已加入项目的副本会保留。'
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
      foot.appendChild(dialogBtn('完成', () => {
        dlg.close()
        load()
      }, 'btn-accent'))
    }

    await render()
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
    title.textContent = node.title || '未命名内容'
    const status = document.createElement('span')
    status.className = 'status ' + (lane === 'discard' ? 'deprecated' : (node.status || 'ready'))
    status.textContent = nodeStatus(node, lane)
    const info = node.presentation || {}
    if (info.shotNumber) {
      const number = document.createElement('span')
      number.className = 'shot-number'
      number.textContent = '镜头 ' + String(info.shotNumber).padStart(2, '0')
      head.appendChild(number)
    } else if (info.role === 'outline') {
      const episode = currentProject?.presentation?.episodes?.find((ep) => ep.id === info.episodeId)
      if (episode) {
        const number = document.createElement('span')
        number.className = 'shot-number'
        number.textContent = '第 ' + episode.number + ' 集'
        head.appendChild(number)
      }
    }
    head.appendChild(title)
    if (status.textContent) head.appendChild(status)
    card.appendChild(head)

    const body = document.createElement('div')
    body.className = 'node-body'

    if (node.media) {
      if (node.kind === 'video') {
        const v = document.createElement('video')
        v.className = 'media'
        v.controls = true
        v.preload = 'metadata'
        v.playsInline = true
        v.src = mediaUrl(node.media)
        body.appendChild(v)
      } else if (node.kind === 'image') {
        const a = document.createElement('a')
        a.href = mediaUrl(node.media)
        a.target = '_blank'
        a.rel = 'noopener'
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

    if (node.placeholder) {
      const placeholder = document.createElement('div')
      placeholder.className = 'media-placeholder'
      placeholder.textContent = node.placeholder
      body.appendChild(placeholder)
    }

    if (info.actualDuration || info.plannedDuration) {
      const duration = document.createElement('p')
      duration.className = 'content-caption'
      duration.textContent = (info.actualDuration ? '时长 ' : '计划时长 ') + Number(info.actualDuration || info.plannedDuration).toFixed(1).replace(/\.0$/, '') + ' 秒'
      body.appendChild(duration)
    }
    if (info.role === 'delivery') {
      const review = document.createElement('p')
      review.className = 'review-note'
      review.textContent = info.qualityReview === 'not_performed' ? '内容质量待审核' : '审核记录：请查看交付详情'
      body.appendChild(review)
    }

    if (node.content) {
      const contentWrap = document.createElement('div')
      contentWrap.innerHTML = renderTextContent(node.content)
      for (const table of contentWrap.querySelectorAll('table')) {
        const scroll = document.createElement('div')
        scroll.className = 'table-scroll'
        table.replaceWith(scroll)
        scroll.appendChild(table)
      }
      if (node.content.length > 800) {
        const full = detailSection('全文', 'text:' + node.id)
        const summary = full.querySelector('summary')
        summary.textContent = '展开全文'
        full.ontoggle = () => { summary.textContent = full.open ? '收起全文' : '展开全文' }
        const preview = document.createElement('p')
        preview.className = 'text-excerpt'
        preview.textContent = node.content.slice(0, 180) + '…'
        body.appendChild(preview)
        full.appendChild(contentWrap)
        body.appendChild(full)
      } else {
        body.appendChild(contentWrap)
      }
    }

    if (node.error) {
      const err = document.createElement('div')
      err.className = 'error-line'
      err.textContent = '错误: ' + node.error
      body.appendChild(err)
    }

    card.appendChild(body)

    const foot = document.createElement('div')
    foot.className = 'node-foot'
    if (node.kind === 'video' && node.media) {
      const download = document.createElement('a')
      download.href = mediaUrl(node.media)
      download.download = (node.title || '视频') + '.mp4'
      download.textContent = '下载视频'
      foot.appendChild(download)
    }
    const technical = detailSection('技术详情', 'technical:' + node.id)
    const raw = document.createElement('pre')
    raw.textContent = JSON.stringify({ id: node.id, status: node.status, params: node.params, media: node.media, qualityReview: info.qualityReview }, null, 2)
    technical.appendChild(raw)
    foot.appendChild(technical)
    card.appendChild(foot)

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

    const more = detailSection('更多', 'actions:' + node.id)
    more.appendChild(actions)
    foot.appendChild(more)
    return card
  }

  function nodeStatus(node, lane) {
    if (lane === 'discard') return '已作废'
    const labels = { failed: '生成失败', blocked: '需处理', review: '待审核', pending: '待生成', planned: '待制作', generating: '生成中', running: '生成中', invalidated: '需重新生成', rejected: '未通过', candidate: '待确认', draft: '草稿', cancelled: '已取消' }
    if (labels[node.status]) return labels[node.status]
    if (node.status && !['ready', 'approved', 'assembled', 'delivered', 'completed'].includes(node.status)) return '状态待确认'
    const role = node.presentation?.role
    if (role === 'script') return '剧本已就绪'
    if (node.kind === 'text' && role === 'shot') return '已规划'
    if (role === 'delivery') return '已合成'
    if (node.media) return '已生成'
    return node.status ? '已就绪' : ''
  }

  function detailSection(label, key) {
    const detail = document.createElement('details')
    detail.className = 'content-details'
    detail.dataset.key = key
    const summary = document.createElement('summary')
    summary.textContent = label
    detail.appendChild(summary)
    return detail
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
    if (!project) return
    const playing = [...el.canvas.querySelectorAll('video')].map((video) => ({ id: video.closest('.node').dataset.nodeId, video }))
    currentProject = project
    pendingProject = null
    document.getElementById('updates').hidden = true
    el.canvas.innerHTML = ''
    const allNodes = [...(project.nodes || [])].sort((a, b) => (a.order || 0) - (b.order || 0))
    renderStageTabs(project.production)
    const episodes = project.presentation?.episodes || []
    document.getElementById('project-title').textContent = project.presentation?.title || '短剧工作台'
    el.meta.textContent = episodes.length ? `${episodes.length} 集 · ${episodes.reduce((n, ep) => n + ep.shotCount, 0)} 个镜头` : ''
    el.assetTools.hidden = activeStageKey !== 'assets'
    const stage = CANVAS_STAGES.find((item) => item.key === activeStageKey)
    el.canvas.setAttribute('aria-label', stage.label)
    el.canvas.dataset.stage = activeStageKey
    const page = document.createElement('div')
    page.className = 'page-content'
    el.canvas.appendChild(page)
    const heading = document.createElement('div')
    heading.className = 'page-heading'
    heading.innerHTML = '<h1>' + stage.label + '</h1>'
    const progress = project.production?.stages?.find((item) => item.key === activeStageKey)
    if (progress) {
      const summary = document.createElement('span')
      summary.className = 'content-caption'
      summary.textContent = (episodes.length > 1 ? '全项目 · ' : '') + progressText(progress)
      heading.appendChild(summary)
    }
    page.appendChild(heading)
    if (activeStageKey === 'assets') heading.appendChild(el.assetTools)
    if (progress?.errors?.length) {
      const error = document.createElement('div')
      error.className = 'stage-errors'
      error.textContent = [...new Set(progress.errors.map((item) => item.error))].join('\n')
      page.appendChild(error)
    }
    let nodes = nodesForCanvasStage(allNodes, activeStageKey)
    if (['scripts', 'storyboard', 'media'].includes(activeStageKey) && episodes.length) {
      if (!episodes.some((ep) => ep.id === activeEpisodeId)) activeEpisodeId = episodes[0].id
      const label = document.createElement('label')
      label.className = 'episode-picker'
      label.textContent = '分集 '
      const select = document.createElement('select')
      for (const ep of episodes) {
        const option = document.createElement('option')
        option.value = ep.id
        option.textContent = `第 ${ep.number} 集 · ${ep.title || '未命名分集'}`
        select.appendChild(option)
      }
      select.value = activeEpisodeId
      select.onchange = () => { rememberReading(); activeEpisodeId = select.value; render(project) }
      label.appendChild(select)
      page.appendChild(label)
      nodes = nodes.filter((node) => !node.presentation?.episodeId || node.presentation.episodeId === activeEpisodeId)
    }
    const main = nodes.filter((node) => nodeLane(node) === 'main')
    if (activeStageKey === 'overview') renderOverview(page, allNodes, project)
    else if (activeStageKey === 'assets') renderAssets(page, main)
    else if (activeStageKey === 'storyboard' || activeStageKey === 'media') renderShots(page, main, allNodes)
    else if (activeStageKey === 'delivery') {
      const finals = main.filter((node) => node.presentation?.role === 'delivery')
      appendCards(page, finals)
      if (!finals.length) emptyState(page, '正式成片尚未就绪', '查看项目总览，确认制作进度。', 'overview')
      const intermediate = main.filter((node) => node.presentation?.role !== 'delivery')
      if (intermediate.length) {
        const detail = detailSection('分集合成与其他版本 · ' + intermediate.length, 'delivery-versions')
        appendCards(detail, intermediate)
        page.appendChild(detail)
      }
    } else {
      const roles = activeStageKey === 'analysis' ? [['analysis', '故事概述'], ['source', '原始素材信息'], ['outline', '分集规划']] : [['script', '正式剧本'], ['shot', '镜头安排']]
      for (const [role, title] of roles) {
        const group = main.filter((node) => node.presentation?.role === role)
        if (group.length) {
          if (role !== 'analysis') sectionTitle(page, title)
          appendCards(page, group)
        }
      }
      appendCards(page, main.filter((node) => !roles.some(([role]) => node.presentation?.role === role)))
      if (!main.length) emptyState(page, '暂无' + stage.label, '查看项目总览，确认上一步的制作进度。', 'overview')
    }
    if (activeStageKey !== 'overview') {
      for (const lane of ['discard', 'frames']) {
        const group = nodes.filter((node) => nodeLane(node) === lane)
        if (group.length) page.appendChild(laneSection(lane, group))
      }
    }
    for (const detail of page.querySelectorAll('details[data-key]')) detail.open = expandedDetails.has(detail.dataset.key)
    for (const { id, video } of playing) {
      const replacement = [...page.querySelectorAll('.node')].find((node) => node.dataset.nodeId === id)?.querySelector('video')
      if (replacement?.src === video.src) replacement.replaceWith(video)
    }
    el.canvas.scrollTop = readingPositions.get(readingKey()) || 0
    syncJump()
  }

  function progressText(progress) {
    const units = { analysis: '份分析', assets: '份设定', scripts: '集', storyboard: '个镜头', media: '个镜头', delivery: '份成片' }
    return `${progressLabels[progress.status] || '状态待确认'} · ${progress.completed} / ${progress.total} ${units[progress.key] || '项'}`
  }

  function sectionTitle(parent, text) {
    const title = document.createElement('h2')
    title.className = 'section-title'
    title.textContent = text
    parent.appendChild(title)
  }

  function appendCards(parent, nodes) {
    for (const node of nodes) parent.appendChild(nodeCard(node))
  }

  function emptyState(parent, title, description, stageKey) {
    const empty = document.createElement('div')
    empty.className = 'stage-empty'
    empty.innerHTML = '<h2>' + escapeHtml(title) + '</h2><p>' + escapeHtml(description) + '</p>'
    if (stageKey) empty.appendChild(dialogBtn('查看' + CANVAS_STAGES.find((stage) => stage.key === stageKey).label, () => selectStage(stageKey)))
    parent.appendChild(empty)
  }

  function renderOverview(parent, nodes, project) {
    const production = project.production
    const banner = document.createElement('div')
    banner.className = 'overview-summary'
    banner.innerHTML = '<h2>' + (production?.status === 'completed' ? '制作已完成' : production?.status === 'blocked' ? '有制作问题需要处理' : nodes.length ? '继续查看制作进度' : '开始制作你的短剧') + '</h2><p>'
      + (production?.status === 'completed' ? '成片已就绪，内容质量待审核。' : '按阶段查看内容和产物。') + '</p>'
    if (nodes.some((node) => node.presentation?.role === 'delivery')) banner.appendChild(dialogBtn('查看成片', () => selectStage('delivery')))
    parent.appendChild(banner)
    const grid = document.createElement('div')
    grid.className = 'overview-grid'
    const counts = canvasStageCounts(nodes.filter((node) => nodeLane(node) === 'main'))
    for (const [index, stage] of CANVAS_STAGES.slice(1).entries()) {
      const progress = production?.stages?.find((item) => item.key === stage.key)
      const card = document.createElement('button')
      card.type = 'button'
      card.className = 'stage-summary'
      card.innerHTML = '<span class="stage-number">0' + (index + 1) + '</span><strong>' + stage.label + '</strong><span>'
        + escapeHtml(progress ? progressText(progress) : counts[stage.key] ? `${counts[stage.key]} 项内容` : '暂无内容') + '</span><span class="stage-link">查看 →</span>'
      if (progress?.status === 'blocked') card.classList.add('needs-attention')
      card.onclick = () => selectStage(stage.key)
      grid.appendChild(card)
    }
    parent.appendChild(grid)
    const other = nodes.filter((node) => !canvasStageForNode(node) || nodeLane(node) !== 'main')
    if (other.length) {
      const detail = detailSection('其他内容与历史记录 · ' + other.length, 'overview-other')
      appendCards(detail, other)
      parent.appendChild(detail)
    }
  }

  function renderAssets(parent, nodes) {
    const paired = new Set()
    for (const [kind, label] of [['character', '角色'], ['location', '场景']]) {
      const entities = nodes.filter((node) => node.kind === 'text' && node.presentation?.entityKind === kind)
      if (!entities.length) continue
      sectionTitle(parent, label)
      for (const entity of entities) {
        const reference = nodes.find((node) => node.id === entity.presentation.referenceAssetId && node.media)
        paired.add(entity.id)
        if (reference) paired.add(reference.id)
        const card = nodeCard({ ...entity, kind: 'image', media: reference?.media, status: reference?.status || 'pending', placeholder: reference ? '' : '设定图待生成', params: { ...entity.params, referenceAssetId: reference?.id } })
        card.classList.add('entity-card')
        parent.appendChild(card)
      }
    }
    const remaining = nodes.filter((node) => !paired.has(node.id))
    if (remaining.length) { sectionTitle(parent, '其他素材 · 尚未关联设定'); appendCards(parent, remaining) }
    if (!nodes.length) emptyState(parent, '暂无角色与场景', '先完成故事分析，也可以上传图片作为参考。', 'analysis')
  }

  function renderShots(parent, nodes, allNodes) {
    const stage = activeStageKey
    const shots = allNodes.filter((node) => node.kind === 'text' && node.presentation?.role === 'shot' && (!activeEpisodeId || node.presentation.episodeId === activeEpisodeId))
      .sort((a, b) => (a.presentation.shotNumber || 0) - (b.presentation.shotNumber || 0))
    const used = new Set()
    const grid = document.createElement('div')
    grid.className = 'shot-grid'
    for (const shot of shots) {
      const matches = nodes.filter((node) => node.presentation?.shotId === shot.presentation.shotId)
      const media = matches.find((node) => node.media)
      const issues = matches.filter((node) => node.presentation?.role === 'issue')
      if (media) used.add(media.id)
      issues.forEach((node) => used.add(node.id))
      const node = media ? { ...media, title: shot.title, content: shot.presentation.description } : {
        id: stage + ':' + shot.id, kind: stage === 'media' ? 'video' : 'image', title: shot.title,
        status: 'pending', domainProjection: true, presentation: shot.presentation,
        content: shot.presentation.description, placeholder: stage === 'media' ? '视频待生成' : '分镜图待生成',
      }
      if (issues.length) { node.error = issues.map((item) => item.content).join('\n'); node.status = 'blocked' }
      grid.appendChild(nodeCard(node))
    }
    parent.appendChild(grid)
    const other = nodes.filter((node) => !used.has(node.id))
    if (other.length) { sectionTitle(parent, '其他素材与版本'); appendCards(parent, other) }
    if (!shots.length && !other.length) emptyState(parent, stage === 'media' ? '暂无镜头视频' : '暂无分镜', '先完成本集的镜头安排。', 'scripts')
  }

  /** 页尾折叠收纳区（作废 / 抽帧各一个）。 */
  function laneSection(lane, list) {
    const det = document.createElement('details')
    det.className = 'lane lane-' + lane
    det.dataset.key = 'lane:' + activeStageKey + ':' + lane
    const sum = document.createElement('summary')
    const isDiscard = lane === 'discard'
    const label = isDiscard ? '已作废' : '检查帧'
    sum.title = isDiscard
      ? '被替换的旧版 / 用户否定的资产，折叠保存历史，点卡片「还原」可回到主线'
      : '末帧串联、转场首末帧、AI 自检检查帧等抽帧产物，默认折叠不影响主线预览，确认无用后可删除'
    sum.innerHTML = '<span class="lane-label">' + label + '</span><span class="lane-count">' + list.length + '</span>'
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

  /** 画布内的顶部与底部定位。 */
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
      el.jump.textContent = '↓ 到达底部'
      el.jump.title = '到达底部'
    } else {
      el.jump.textContent = '↑ 返回顶部'
      el.jump.title = '返回顶端'
    }
  }

  // 轮询更新只刷新内容，不改变用户选择的阶段和阅读位置。
  function initAutoFollow() {
    if (followInited) return
    followInited = true

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        pollFollow()
        startFollowTimer()
      } else {
        stopFollowTimer()
      }
    })
    if (document.visibilityState === 'visible') {
      startFollowTimer()
    }
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
    if (document.querySelector('.dialog-host')) return true
    return !!document.querySelector('textarea.edit')
  }

  /** 同 ID 状态也参与比较；播放期间提示更新，避免重建播放器。 */
  async function pollFollow() {
    if (document.visibilityState !== 'visible' || isBusyEditing()) return
    try {
      const project = await api('/canvas')
      if (JSON.stringify(project) === JSON.stringify(currentProject)) return
      if (isBusyEditing() || [...el.canvas.querySelectorAll('video')].some((video) => !video.paused)) {
        pendingProject = project
        document.getElementById('updates').hidden = false
        return
      }
      rememberReading()
      render(project)
    } catch { /* 单轮轮询失败静默，下轮重试 */ }
  }

  async function load() {
    el.refresh.disabled = true
    try {
      const project = await api('/canvas')
      rememberReading()
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

  document.getElementById('updates').addEventListener('click', () => {
    if (!pendingProject) return
    rememberReading()
    render(pendingProject)
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
