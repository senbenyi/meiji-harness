// dsh-short-video-studio — 浏览器半。
// 通过 window.__ModuleLoader__.load 注册 client 模块，把「创作」挂到宿主 UI 上。
// 家由插件级配置项 canvasHome 决定（设置 → ComfyUI → 界面），启动时**只注册一个**：
//   'tab'（默认）→ conversation.view 会话视图 tab；'sidebar' → 右侧栏 tab 类型。
// 两种家都复用同一个 CanvasView（iframe 指向宿主伺服的自包含 studio 页）。
window.__ModuleLoader__.load({
  id: 'dsh-short-video-studio',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    var React = require('react')

    const inject = ['slots']

    const ROUTE_ROOT = '/dsh-short-video-studio'

    // ---- 主题：画布跟随 DSH 的浅色/深色 ----
    // 宿主把当前配色方案经 ?theme= 写给 iframe（首屏用，避免先闪一下另一种底色），
    // 运行中主题变化再用 postMessage 下发（studio/app.js 收）。画布页自带两套调色板，
    // 由 <html data-theme> 选择 —— iframe 读不到宿主文档的 CSS 变量，只能这样传。
    let hostCtx = null
    const schemeListeners = new Set()
    let bootScheme

    /**
     * 读宿主当前配色方案。
     * @returns `'light'` / `'dark'`；宿主没装主题服务（或读失败）时返回 `null` ——
     *   此时**不传** `?theme=`，让画布页按 `prefers-color-scheme` 自行兜底，而不是硬猜一个。
     */
    function readScheme() {
      try {
        const theme = hostCtx && typeof hostCtx.get === 'function' ? hostCtx.get('theme') : undefined
        if (!theme || typeof theme.getTheme !== 'function') return null
        const snap = theme.getTheme()
        const scheme = snap && snap.active ? snap.active.colorScheme : null
        if (scheme === 'dark') return 'dark'
        if (scheme === 'light') return 'light'
        return null
      } catch (e) {
        return null // 主题服务异常不该让画布挂掉
      }
    }

    /** 首屏主题只取一次并冻结：它进了 iframe 的 src，若跟着变会让 iframe 重载（丢滚动位置）。 */
    function bootSchemeOnce() {
      if (bootScheme === undefined) bootScheme = readScheme()
      return bootScheme
    }

    /** 把主题下发给画布 iframe。抽成函数是为了离线冒烟能断言（测试里拿不到真 contentWindow）。 */
    function postThemeToFrame(frame, theme) {
      if (theme !== 'light' && theme !== 'dark') return false
      try {
        const win = frame && frame.contentWindow
        if (!win || typeof win.postMessage !== 'function') return false
        win.postMessage({ channel: 'dsh-short-video-studio', type: 'theme', theme }, window.location.origin)
        return true
      } catch (e) {
        return false // 跨源/尚未挂载：下次 theme/change 或 onLoad 会再试
      }
    }

    /** 订阅宿主配色方案变化（画布组件用；返回退订函数）。 */
    function subscribeScheme(fn) {
      schemeListeners.add(fn)
      return () => { schemeListeners.delete(fn) }
    }

    /**
     * 订阅宿主主题变化（ui-theme 的 `theme/change` 在偏好切换与系统配色变化时都会发）。
     * 宿主没有事件能力时退化为「只在挂载/iframe load 时读一次」——主题仍然跟随，
     * 只是运行中切换要等下一次重挂载。宁可降级，也不能让 apply 抛错把整个浏览器半拖垮。
     */
    function watchTheme(ctx) {
      hostCtx = ctx
      if (!ctx || typeof ctx.on !== 'function') return
      ctx.on('theme/change', () => {
        const next = readScheme()
        for (const fn of schemeListeners) {
          try { fn(next) } catch (e) { /* 单个订阅者抛错不影响其他 */ }
        }
      })
    }

    // 两个家（会话区视图 tab / 右侧栏 pane body）共用这一层外壳：
    // 右栏 pane body 是「有确定高度的块级滚动容器」，这里靠 height:100% 撑满；
    // flex:1 则覆盖父级是 flex 列（会话区视图槽）的情况。两者同时给才在两种家里都铺满。
    const shellStyle = {
      display: 'flex',
      flexDirection: 'column',
      flex: '1 1 auto',
      width: '100%',
      height: '100%',
      minWidth: 0,
      minHeight: 0,
      boxSizing: 'border-box',
      // 跟随宿主主题的底：这里是「装 iframe 的外壳」，只在 iframe 首帧前可见，
      // 用宿主变量才不会有「深色应用里闪一下浅色」。
      background: 'var(--dsw-alias-bg-base, #f6f7f9)',
    }
    const frameStyle = {
      flex: 1,
      width: '100%',
      minHeight: 0,
      border: 0,
      background: 'var(--dsw-alias-bg-base, #f6f7f9)',
    }
    const emptyStyle = {
      display: 'grid',
      placeContent: 'center',
      gap: 8,
      height: '100%',
      padding: 32,
      color: '#70757f',
      textAlign: 'center',
    }

    function CanvasView(props) {
      const sessionId = props.sessionId
      const useWorkspaces = props.useWorkspaces
      const inputActions = props.inputActions
      const iframeRef = React.useRef(null)
      // 当前宿主配色方案（'light' / 'dark' / null=未知）。宿主切主题时经 schemeListeners 更新。
      const [scheme, setScheme] = React.useState(readScheme)
      // 首屏主题冻结一次（进了 src 就不再变，否则 iframe 会重载）
      const boot = bootSchemeOnce()

      const workspace = useWorkspaces
        ? useWorkspaces((state) => state.items.find((item) => item.sessionIds.includes(sessionId)))
        : null

      React.useEffect(() => {
        const receive = (event) => {
          if (event.origin !== window.location.origin) return
          if (event.source !== iframeRef.current?.contentWindow) return
          const data = event.data
          if (!data || data.channel !== 'dsh-short-video-studio') return
          if (data.type === 'ask-ai' && typeof data.text === 'string' && inputActions && typeof inputActions.setDraft === 'function') {
            inputActions.setDraft(data.text)
          }
        }
        window.addEventListener('message', receive)
        return () => window.removeEventListener('message', receive)
      }, [inputActions])

      // 订阅宿主主题变化 → setScheme 触发重渲染 → 下面的 effect 把新主题 postMessage 给 iframe
      React.useEffect(() => subscribeScheme(setScheme), [])

      // 主题变化时下发给画布（iframe 已挂载才有 contentWindow；未挂载时由 onLoad 兜底）
      React.useEffect(() => { postThemeToFrame(iframeRef.current, scheme) }, [scheme])

      if (!workspace) {
        return React.createElement(
          'div',
          { style: emptyStyle },
          React.createElement('strong', null, '画布需要工作区'),
          React.createElement('span', null, '请从已注册的 DeepSeek Harness 工作区打开本会话。'),
        )
      }

      const query = new URLSearchParams({
        sessionId: String(sessionId),
        workspaceId: String(workspace.workspaceId),
      })

      return React.createElement(
        'section',
        { style: shellStyle, 'aria-label': '创作' },
        React.createElement('iframe', {
          ref: iframeRef,
          title: '创作',
          src: ROUTE_ROOT + '/?' + query.toString() + (boot ? '&theme=' + boot : ''),
          style: frameStyle,
          // 每次加载都补一次当前主题（首屏可能因时序错过 postMessage）
          onLoad: () => postThemeToFrame(iframeRef.current, readScheme()),
          sandbox: 'allow-downloads allow-forms allow-modals allow-popups allow-same-origin allow-scripts',
        }),
      )
    }

    // ComfyUI 设置卡片（DSH 设置页 settings.section）
    // ComfyUI 设置卡片（DSH 设置页 settings.section）
    const CONFIG_API = ROUTE_ROOT + '/api/config'

    function ComfyUISettings() {
      const [cfg, setCfg] = React.useState(null)
      const [msg, setMsg] = React.useState('加载中…')

      React.useEffect(() => {
        fetch(CONFIG_API).then((r) => r.json()).then((d) => {
          if (d && d.ok) setCfg(d.config)
          setMsg(d && d.ok ? '' : '加载失败')
        }).catch((e) => setMsg('加载失败: ' + e))
      }, [])

      if (!cfg) return React.createElement('div', { style: { padding: 16 } }, msg)

      const ctrlStyle = {
        width: '100%', maxWidth: '100%', minWidth: 0, boxSizing: 'border-box', height: 34,
        padding: '0 10px', borderRadius: 6,
        border: '1px solid var(--dsw-alias-border-l2, #d9d9d9)',
        background: 'var(--dsw-alias-bg-base, #fff)',
        color: 'var(--dsw-alias-label-primary, #1f2329)',
      }
      const btnStyle = {
        height: 34, padding: '0 14px', borderRadius: 6, cursor: 'pointer',
        border: '1px solid var(--dsw-alias-border-l2, #d9d9d9)',
        background: 'var(--dsw-alias-bg-base, #fff)',
        color: 'var(--dsw-alias-label-primary, #1f2329)',
      }
      const field = (label, value, onChange, type) =>
        React.createElement('label', { style: { display: 'grid', gridTemplateColumns: '140px minmax(0, 1fr)', gap: 10, alignItems: 'center', margin: '10px 0', minWidth: 0 } },
          React.createElement('span', { style: { fontSize: 13 } }, label),
          React.createElement('input', {
            value: value ?? '', type: type || 'text', style: ctrlStyle,
            onChange: (e) => onChange(e.target.value),
          }),
        )
      const postConfig = (next, okMessage) => {
        setMsg('保存中…')
        return fetch(CONFIG_API, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(next),
        }).then((r) => r.json()).then((d) => {
          setMsg(d && d.ok ? okMessage : '保存失败: ' + ((d && d.error) || ''))
          return d
        }).catch((e) => setMsg('保存失败: ' + e))
      }
      const setCanvasHome = (canvasHome) => {
        const next = { ...cfg, canvasHome }
        setCfg(next)
        postConfig(next, '已保存，请刷新页面')
      }

      return React.createElement('div', { style: { padding: 16, maxWidth: 620, width: '100%', boxSizing: 'border-box', minWidth: 0 } },
        React.createElement('h3', { style: { marginTop: 0 } }, 'ComfyUI'),
        React.createElement('label', { style: { display: 'grid', gridTemplateColumns: '140px minmax(0, 1fr)', gap: 10, alignItems: 'center', margin: '10px 0', minWidth: 0 } },
          React.createElement('span', { style: { fontSize: 13 } }, '创作显示位置'),
          React.createElement('select', {
            value: cfg.canvasHome === 'sidebar' ? 'sidebar' : 'tab',
            style: ctrlStyle,
            onChange: (e) => setCanvasHome(e.target.value),
          },
            React.createElement('option', { value: 'tab' }, '会话标签页（默认）'),
            React.createElement('option', { value: 'sidebar' }, '右侧栏'),
          ),
        ),
        React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 10, margin: '4px 0 20px 150px', flexWrap: 'wrap' } },
          React.createElement('span', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary, #646a73)' } }, '切换后刷新页面生效。'),
          React.createElement('button', {
            type: 'button', style: { ...btnStyle, height: 28, padding: '0 10px', fontSize: 12 },
            onClick: () => { if (typeof location !== 'undefined' && location.reload) location.reload() },
          }, '刷新页面'),
        ),
        field('ComfyUI 地址', cfg.baseUrl, (baseUrl) => setCfg({ ...cfg, baseUrl })),
        field('API Key（可留空）', cfg.apiKey, (apiKey) => setCfg({ ...cfg, apiKey }), 'password'),
        React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 10, marginTop: 16, flexWrap: 'wrap' } },
          React.createElement('button', { type: 'button', onClick: () => postConfig(cfg, '已保存'), style: btnStyle }, '保存'),
          React.createElement('span', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary, #646a73)', overflowWrap: 'anywhere' } }, msg),
        ),
      )
    }

    // =========================================================================
    // 生成模式面板（共用 dsh 输入框）：conversation.input.left 开关 + input.dock 参数条。
    // 无 skill、无 Agent 的手工生成入口：prompt 直接在 dsh 输入框输入，点「生成」
    // 即把当前草稿送 /generate/* 出片，产物落「创作」tab（canvas 节点）并在参数条内预览。
    // =========================================================================
    const GEN_CSS_ID = '@dsh-short-video-studio/gen.css'
    const GEN_CSS = [
      '.svsg{box-sizing:border-box;width:100%;max-width:var(--dsh-composer-card-max-width,760px);margin:0 auto;padding:0 8px 2px;font-family:var(--dsw-font-family,inherit);color:var(--dsw-alias-label-primary,#1f2329)}',
      '.svsg-bar{display:flex;align-items:center;gap:6px;padding:6px;background:var(--dsw-alias-bg-elevated,rgba(28,31,40,.9));border:1px solid var(--dsw-alias-border-l1,#2e3342);border-radius:12px;flex-wrap:wrap}',
      '.svsg-brand{font-size:12px;color:var(--dsw-alias-label-caption,#8a8f99);margin:0 6px 0 2px;white-space:nowrap}',
      '.svsg-seg{display:inline-flex;gap:2px;background:var(--dsw-alias-bg-base,#232734);border:1px solid var(--dsw-alias-border-l1,#2e3342);border-radius:9px;padding:2px}',
      '.svsg-seg button{border:0;background:transparent;color:var(--dsw-alias-label-secondary,#6b7280);font-size:12.5px;line-height:26px;padding:0 12px;border-radius:7px;cursor:pointer;white-space:nowrap}',
      '.svsg-seg button:hover{color:var(--dsw-alias-label-primary,#e8eaf0)}',
      '.svsg-seg button.on{background:var(--dsw-alias-state-business-tertiary,rgba(51,112,255,.16));color:var(--dsw-alias-label-primary,#e8eaf0);font-weight:600;box-shadow:inset 0 0 0 1px var(--dsw-alias-state-business-primary,rgba(91,140,255,.5))}',
      '.svsg-spacer{flex:1}',
      '.svsg-hint{font-size:11.5px;line-height:1.5;color:var(--dsw-alias-label-secondary,#9aa1b1);margin:0;min-width:0;overflow-wrap:anywhere}',
      '.svsg-panel{margin-top:6px;padding:10px;background:var(--dsw-alias-bg-elevated,rgba(28,31,40,.92));border:1px solid var(--dsw-alias-border-l1,#2e3342);border-radius:14px;box-shadow:0 8px 30px rgba(0,0,0,.14)}',
      '.svsg-panel h4{margin:0 0 8px;font-size:13px;font-weight:600;display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
      '.svsg-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:6px 0}',
      '.svsg-lbl{font-size:12px;color:var(--dsw-alias-label-secondary,#9aa1b1);white-space:nowrap}',
      '.svsg-grp{display:inline-flex;align-items:center;gap:6px;white-space:nowrap}',
      '.svsg-ta{width:100%;box-sizing:border-box;min-height:72px;resize:vertical;border:1px solid var(--dsw-alias-border-l2,#3a4050);background:var(--dsw-alias-bg-base,#1b1e27);color:var(--dsw-alias-label-primary,#e8eaf0);border-radius:10px;padding:9px 11px;font:inherit;font-size:13px;outline:none}',
      '.svsg-ta:focus{border-color:var(--dsw-alias-state-business-primary,#5b8cff)}',
      '.svsg-select{background:var(--dsw-alias-bg-base,#1b1e27);color:var(--dsw-alias-label-primary,#e8eaf0);border:1px solid var(--dsw-alias-border-l2,#3a4050);border-radius:8px;padding:5px 8px;font-size:12.5px}',
      '.svsg-drop{border:1px dashed var(--dsw-alias-border-l2,#3a4050);border-radius:10px;padding:10px;background:var(--dsw-alias-bg-base,#1b1e27);display:flex;flex-direction:column;gap:8px;min-width:200px;flex:1}',
      '.svsg-drop .t{font-size:12px;color:var(--dsw-alias-label-secondary,#9aa1b1)}',
      '.svsg-go{flex:none;border:0;border-radius:9px;padding:8px 18px;font-size:13px;font-weight:600;cursor:pointer;color:#fff;background:linear-gradient(135deg,#5b8cff,#7c5cff)}',
      '.svsg-go:hover{filter:brightness(1.08)}',
      '.svsg-go:disabled{opacity:.55;cursor:default;filter:none}',
      '.svsg-status{font-size:12px;color:var(--dsw-alias-state-warning-primary,#d97706);display:flex;gap:6px;align-items:center;margin:6px 2px 0}',
      '.svsg-error{font-size:12px;color:var(--dsw-alias-state-error-primary,#ff6b6b);margin:6px 2px 0;word-break:break-all;line-height:1.5}',
      '.svsg-results{margin-top:8px;display:flex;flex-direction:column;gap:8px}',
      '.svsg-result{border:1px solid var(--dsw-alias-border-l1,#2e3342);border-radius:12px;overflow:hidden;background:var(--dsw-alias-bg-base,#1b1e27)}',
      '.svsg-result .m{background:#000}',
      '.svsg-result img,.svsg-result video{display:block;max-width:100%;max-height:320px;margin:0 auto}',
      '.svsg-result .meta{display:flex;align-items:center;gap:10px;padding:6px 10px;font-size:11.5px;color:var(--dsw-alias-label-caption,#8a8f99);flex-wrap:wrap}',
      '.svsg-result .meta a{color:var(--dsw-alias-state-business-primary,#5b8cff);text-decoration:none}',
      '.svsg-foot{margin-top:6px;font-size:11px;color:var(--dsw-alias-label-caption,#8a8f99);line-height:1.5}',
    '.svsg-tools{display:inline-flex;align-items:center;gap:4px}',
    '.svsg-tool{border:0;background:transparent;color:var(--dsw-alias-label-secondary,#9aa1b1);font-size:12px;line-height:26px;padding:0 8px;border-radius:8px;cursor:pointer;white-space:nowrap}',
    '.svsg-tool:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.07));color:var(--dsw-alias-label-primary,#e8eaf0)}',
    '.svsg-tool.on{background:var(--dsw-alias-state-business-tertiary,rgba(51,112,255,.2));color:var(--dsw-alias-state-business-primary,#7aa2ff);font-weight:600}',
    '.svsg-tip{font-size:12px;color:var(--dsw-alias-state-success-primary,#3fba62);margin:4px 2px 0;line-height:1.5}',
    // 文本用 label-primary：强调色当文字时在深/浅两套主题下都只有 ~2.8-3.3:1（不达标）
    '.svsg-skill{display:inline-flex;align-items:center;gap:4px;background:var(--dsw-alias-state-business-tertiary,rgba(76,140,255,.16));color:var(--dsw-alias-label-primary,#e8eaf0);border:1px solid var(--dsw-alias-state-business-primary,rgba(76,140,255,.45));border-radius:999px;padding:2px 9px;font-size:12px;font-weight:600;white-space:nowrap}',
    '.svsg-inner{box-sizing:border-box;margin:0 12px;padding:8px 10px;background:var(--dsw-alias-interactive-bg-hover,rgba(128,134,145,.07));border:1px solid var(--dsw-alias-border-l1,#2e3342);border-radius:12px;min-width:0}',
    '.svsg-inner.svsg-dropon{border-color:var(--dsw-alias-state-business-primary,#5b8cff);border-style:dashed}',
    '.svsg-rail{display:flex;align-items:flex-start;gap:10px;flex-wrap:wrap;margin-bottom:6px;min-width:0}',
    '.svsg-slot{box-sizing:border-box;flex:0 0 64px;width:64px;height:64px;position:relative;border:1px solid var(--dsw-alias-border-l2-darkmode-thin);background:var(--dsw-alias-interactive-bg-hover);border-radius:16px;overflow:hidden;padding:0;display:flex;align-items:center;justify-content:center;font-family:inherit}',
    '.svsg-slot img{width:100%;height:100%;object-fit:cover;display:block}',
    '.svsg-slot .x{position:absolute;top:4px;right:4px;z-index:1;width:18px;height:18px;background:var(--dsw-alias-button-contrast-fill);color:var(--dsw-alias-label-primary-inverted);cursor:pointer;opacity:0;border:none;border-radius:50%;padding:0;display:grid;place-items:center;transition:opacity .2s ease-in-out;font-size:12px;line-height:1}',
    '.svsg-slot:hover .x,.svsg-slot .x:focus-visible{opacity:1}',
    '@media (pointer:coarse){.svsg-slot .x{opacity:1}}',
    '.svsg-slot.add{cursor:pointer;color:var(--dsw-alias-label-secondary,#9aa1b1)}',
    '.svsg-slot.add:hover{color:var(--dsw-alias-label-primary,#e8eaf0);border-color:var(--dsw-alias-state-business-primary,#5b8cff)}',
    '.svsg-slot.add:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#5b8cff);outline-offset:1px}',
    '.svsg-slot.add::after{content:"＋";font-size:24px;line-height:1;font-weight:400}',
    ].join('')
    let genCssInjected = false
    function ensureGenCss() {
      if (genCssInjected) return
      genCssInjected = true
      if (typeof document === 'undefined') return
      if (document.querySelector('style[data-plugin-css=' + JSON.stringify(GEN_CSS_ID) + ']')) return
      const tag = document.createElement('style')
      tag.dataset.plugin = '@dsh-short-video-studio'
      tag.dataset.pluginCss = GEN_CSS_ID
      tag.textContent = GEN_CSS
      document.head.appendChild(tag)
    }
    ensureGenCss()

    const h = React.createElement

    // 标签 + 控件必须作为一个不可拆分的整体换行：否则窄宽度下会出现
    // 「标签留在上一行末尾、控件被挤到下一行」的错位（实测 720px 宽就会发生）。
    const grp = (label, control) => h('span', { className: 'svsg-grp' },
      label ? h('span', { className: 'svsg-lbl' }, label) : null,
      control,
    )

    // 访问令牌：插件静态页注入 __DSH_SVS_TOKEN__（同源可读，缓存在模块内）
    let svsTokenPromise = null
    function ensureSvsToken() {
      if (!svsTokenPromise) {
        svsTokenPromise = fetch(ROUTE_ROOT + '/?t=' + Date.now()).then((r) => r.text()).then((html) => {
          const m = html.match(/__DSH_SVS_TOKEN__\s*=\s*"([^"]+)"/)
          if (!m) throw new Error('插件令牌解析失败（studio 静态页未注入）')
          return m[1]
        }).catch((e) => { svsTokenPromise = null; throw e })
      }
      return svsTokenPromise
    }

    /** 通用插件 API（带 token；sessionId 用于工作区解析）。 */
    async function svsApi(sessionId, action, opts = {}) {
      const token = await ensureSvsToken()
      const method = opts.method || 'POST'
      // action 可能自带 query（如 /canvas/node?id=…）：此时用 & 拼接，避免第二个 ?
      // 把 sessionId 吞进参数值导致 400「sessionId required」
      let apiUrl = ROUTE_ROOT + '/api' + action
      if (sessionId) apiUrl += (action.indexOf('?') >= 0 ? '&' : '?') + 'sessionId=' + encodeURIComponent(sessionId)
      const res = await fetch(apiUrl, {
        method,
        headers: { 'content-type': 'application/json', 'x-dsh-svs-token': token },
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      })
      if (!res.ok) {
        let msg = String(res.status)
        try { msg = (await res.json()).message || msg } catch { /* 保留状态码 */ }
        throw new Error(msg)
      }
      return res.json()
    }

    /** 画布媒体 URL（需要已解析的 token；token 未就绪返回空串）。 */
    function svsMediaUrl(sessionId, media, token) {
      if (!media || !token) return ''
      const u = new URLSearchParams({ token, sessionId, path: media })
      return ROUTE_ROOT + '/media?' + u.toString()
    }

    const GEN_RATIOS = { image: ['16:9', '9:16', '1:1', '4:3', '3:2'], video: ['16:9', '9:16', '1:1'] }
    const GEN_SECONDS = [
      { label: '≈3s', frames: 73 }, { label: '≈5s', frames: 124 }, { label: '≈8s', frames: 192 },
      { label: '≈10s', frames: 243 }, { label: '≈13s', frames: 310 },
    ]
    function svsDims(ratio, longSide) {
      const snap = (n) => Math.max(32, Math.round(n / 32) * 32)
      const [rw, rh] = String(ratio).split(/[:/x]/).map(Number)
      if (!rw || !rh) return { width: longSide, height: 768 }
      if (rw >= rh) return { width: longSide, height: snap(longSide * rh / rw) }
      return { width: snap(longSide * rw / rh), height: longSide }
    }

    // 注册表档位矩阵：工具条显示的尺寸/实现/耗时与后端解析**同源**（不硬编码档位参数）。
    let tierMatrixCache = null
    let tierMatrixPromise = null
    function loadTierMatrix() {
      if (tierMatrixCache) return Promise.resolve(tierMatrixCache)
      if (!tierMatrixPromise) {
        tierMatrixPromise = fetch(WORKFLOWS_API).then((r) => r.json())
          .then((w) => { if (w && w.ok) tierMatrixCache = w; return tierMatrixCache })
          .catch(() => null)
      }
      return tierMatrixPromise
    }
    /** 该能力该档会实际用到的实现（配置选择 > 注册表首选），与后端排序规则一致。 */
    function tierPick(matrix, capability, tier) {
      const c = matrix && (matrix.capabilities || []).find((x) => x.capability === capability)
      if (!c || !c.tiered) return null
      const all = (c.groups || []).flatMap((g) => (g.tiers || [])[tier] || [])
      if (!all.length) return null
      // 后端已经算好**实际生效**的实现（含 preferred 家族序 / pins）——优先用它，避免 UI 与 runner 说法不一致
      const eff = (c.effective || {})[tier]
      const sel = (c.selection || {})[tier]
      return all.find((w) => w.id === eff) || all.find((w) => w.id === sel) || all.find((w) => w.available !== false) || all[0]
    }
    const VIDEO_CAPABILITY = { r2v: 'video.reference2video', i2v: 'video.image2video' }
    /** 该能力**现有**的档位（由注册表推导，UI 不预设档位数量/名称）。 */
    function tiersOf(matrix, capability) {
      const c = matrix && (matrix.capabilities || []).find((x) => x.capability === capability)
      if (!c) return []
      // 选了用户自建策略时，档位＝**该策略提供的那几档**（策略没有的档位就是不存在，不是回退）
      const owned = Array.isArray(c.availableTiers) ? c.availableTiers : null
      if (owned && owned.length) return (c.tiers || []).filter((t) => owned.includes(t))
      return c.tiers || []
    }
    /** 某档的注册表首选实现（供选项标签显示实测耗时等数据）。 */
    function tierMetaOf(matrix, capability, tier) {
      const c = matrix && (matrix.capabilities || []).find((x) => x.capability === capability)
      const all = (c && (c.groups || []).flatMap((g) => (g.tiers || {})[tier] || [])) || []
      return all[0] || null
    }
    /** 未分档清单的长边（图片 t2i 尺寸提示用；读清单，不写死 1344）。 */
    function unclassifiedLongSide(matrix, capability) {
      const c = matrix && (matrix.capabilities || []).find((x) => x.capability === capability)
      const m = ((c && c.unclassified) || [])[0]
      if (!m) return null
      if (m.longSide) return m.longSide
      // 清单只声明了 resolution.default（如 [1344,768]）时取长边作为推导基准
      const def = m.resolution && m.resolution.default
      return Array.isArray(def) && def.length ? Math.max(...def) : null
    }
    /** 未分档能力的 mode 轴（图片 i2i 用；同样从清单读，不写死）。 */
    function modesOf(matrix, capability) {
      const c = matrix && (matrix.capabilities || []).find((x) => x.capability === capability)
      const ms = (c && c.unclassified) || []
      return ms.length ? (ms[0].modes || []) : []
    }

    /** 当前参数下该用的清单长边（视频=档位实现的长边；图片 t2i=未分档清单长边）。 */
    function matrixLongSide(matrix, cur) {
      if (!cur) return null
      if (cur.mode === 'image') return cur.imgType === 'i2i' ? null : unclassifiedLongSide(matrix, 'image.text2image')
      const cap = VIDEO_CAPABILITY[cur.pipeline] || VIDEO_CAPABILITY.r2v
      const meta = cur.videoTier ? tierMetaOf(matrix, cap, cur.videoTier) : null
      return (meta && meta.longSide) || null
    }

    const VIDEO_SKILL_HEAD = '/elysium-generate-video'
    const IMAGE_SKILL_HEAD = '/elysium-generate-image'

    /** 生成 elysium-generate-image 斜杠命令行：t2i 文生图（比例/尺寸/张数）；i2i 图生图（参考图，尺寸跟随参考图）。 */
    function svsImageHeader(cur, opts = {}) {
      const t = cur.imgType || 't2i'
      if (t === 'i2i') {
        const ids = (cur.refs || []).map((r) => r.nodeId).filter(Boolean)
        // 档位（未分档清单的 mode 轴）未知时不拼 tier=，交给服务端按清单解析
        let args = 'type=i2i' + (cur.imageTier ? ' tier=' + cur.imageTier : '') + ' count=' + (cur.count || 1)
        if (ids.length) args += ' refs=' + ids.join(',')
        return IMAGE_SKILL_HEAD + ' ' + args
      }
      const dims = svsDims(cur.ratio, opts.longSide || 1344)
      let args = 'type=t2i ratio=' + cur.ratio
      args += ' size=' + dims.width + 'x' + dims.height
      args += ' count=' + (cur.count || 1)
      return IMAGE_SKILL_HEAD + ' ' + args
    }

    /** 生成 elysium-generate-video 斜杠命令行（含参数；prompt 作为正文跟在空行后）。 */
    function svsVideoHeader(cur, opts = {}) {
      const vt = cur.videoTier || ''
      // 长边来自清单（调用方从档位矩阵取），不再按档位名硬编码；未知时用 1344 兜底
      const dims = svsDims(cur.ratio, opts.longSide || 1344)
      let args = 'type=' + cur.pipeline + (vt ? ' tier=' + vt : '') + ' ratio=' + cur.ratio
      args += ' size=' + dims.width + 'x' + dims.height + ' length=' + cur.seconds
      if (cur.pipeline === 'r2v') {
        args += ' refs=' + (cur.refs || []).map((r) => r.nodeId).join(',')
      } else {
        args += ' first=' + (cur.first ? cur.first.nodeId : '')
        if (cur.last) args += ' last=' + cur.last.nodeId
      }
      return VIDEO_SKILL_HEAD + ' ' + args
    }

    /** 从草稿里提取用户 prompt：任一斜杠命令头之后第一个换行之后的正文；无命令头则整段视为 prompt。 */
    function svsPromptOf(draft) {
      const d = typeof draft === 'string' ? draft : ''
      if (d.startsWith(VIDEO_SKILL_HEAD) || d.startsWith(IMAGE_SKILL_HEAD)) {
        const i = d.indexOf('\n')
        return i >= 0 ? d.slice(i).replace(/^\n+/, '') : ''
      }
      return d
    }

    /** 用当前参数重写当前模式的斜杠命令头（video/image），保留用户已输入的 prompt（默认发送键提交的就是这条草稿）。 */
    function svsSetHeader(inputActions, cur, draft, opts = {}) {
      if (!inputActions || typeof inputActions.setDraft !== 'function' || !cur) return
      const p = svsPromptOf(draft)
      const head = cur.mode === 'image' ? svsImageHeader(cur, opts) : svsVideoHeader(cur, opts)
      inputActions.setDraft(head + (p ? '\n\n' + p : ''))
    }
    function readFileDataUrl(file) {
      return new Promise((resolve, reject) => {
        const fr = new FileReader()
        fr.onload = () => resolve(fr.result)
        fr.onerror = () => reject(new Error('读取失败：' + file.name))
        fr.readAsDataURL(file)
      })
    }
    function nowLabel() {
      const d = new Date()
      const p = (n) => String(n).padStart(2, '0')
      return d.getMonth() + 1 + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes())
    }

    /** 上传一张本地图到画布（返回画布节点），作为 r2v 参考 / i2v 首末帧。 */
    async function svsUploadRef(sessionId, file) {
      if (!file) throw new Error('未选择文件')
      if (file.size > 24 * 1024 * 1024) throw new Error('图片超过 24MB：' + file.name)
      const dataUrl = await readFileDataUrl(file)
      const d = await svsApi(sessionId, '/canvas/upload', { body: { files: [{ filename: file.name, dataUrl }], group: '手动生成·参考' } })
      const added = (d && d.added && d.added[0])
      if (!added) {
        const msg = (d && d.errors && d.errors[0] && d.errors[0].message) || '上传失败'
        throw new Error(msg)
      }
      return { name: file.name, dataUrl, nodeId: added.id, media: added.media }
    }

    function pickFile(accept, multiple, onPicked) {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = accept || 'image/*'
      input.multiple = !!multiple
      input.addEventListener('change', () => onPicked(Array.from(input.files || [])))
      input.click()
    }


    // ------------------------------------------------------------------
    // 生成模式 per-session store：input.left 工具行开关 与 composer 接管卡共享。
    // ------------------------------------------------------------------

    // ------------------------------------------------------------------
    // 生成模式 per-session store：input.left 开关 与 input.dock 参数条共享。
    // prompt 不在此存储——输入框就是 dsh 官方输入器，生成时读取其草稿。
    // ------------------------------------------------------------------
    // videoTier/imageTier 留空：档位可用性由注册表决定，UI 不预设（见 tiersOf/modesOf）
    const GEN_DEFAULT = { mode: 'chat', pipeline: 'r2v', videoTier: '', imageTier: '', ratio: '16:9', seconds: 124, refs: [], first: null, last: null, imgType: 't2i', count: 1, results: [] }
    const genStore = { map: new Map(), subs: new Map() }
    function genStateOf(sid) {
      if (sid == null || sid === '') return null
      if (!genStore.map.has(sid)) genStore.map.set(sid, { ...GEN_DEFAULT })
      return genStore.map.get(sid)
    }
    function genPatch(sid, patch) {
      const s = genStateOf(sid)
      if (!s) return
      Object.assign(s, patch)
      const subs = genStore.subs.get(sid)
      if (subs) for (const fn of Array.from(subs)) { try { fn(s) } catch (e) { console.warn('[dsh-short-video-studio] gen-store sub error:', e) } }
    }
    function useGenSession(sid) {
      const [state, setState] = React.useState(() => (genStateOf(sid) ? { ...genStateOf(sid) } : null))
      React.useEffect(() => {
        if (sid == null || sid === '') { setState(null); return }
        setState({ ...genStateOf(sid) })
        const fn = (s) => setState({ ...s })
        let arr = genStore.subs.get(sid)
        if (!arr) { arr = []; genStore.subs.set(sid, arr) }
        arr.push(fn)
        return () => {
          const list = genStore.subs.get(sid) || []
          const i = list.indexOf(fn)
          if (i >= 0) list.splice(i, 1)
          if (!list.length) genStore.subs.delete(sid)
        }
      }, [sid])
      return state
    }

    /** 画布节点删除（含媒体文件清理由后端完成）；失败不再静默。 */
    function removeRefCanvasNode(sessionId, nodeId) {
      if (!sessionId || !nodeId) return
      svsApi(sessionId, '/canvas/node?id=' + encodeURIComponent(nodeId), { method: 'DELETE' })
        .catch((e) => console.warn('[dsh-short-video-studio] 参考图画布节点删除失败:', nodeId, e?.message || e))
    }

    /** 清空当前会话用过的参考媒体：删掉对应画布节点（含文件）并重置 genStore 的 refs/first/last。 */
    function svsPurgeRefNodes(sessionId) {
      const cur = genStateOf(sessionId)
      if (!cur) return
      const ids = []
      for (const r of cur.refs || []) if (r && r.nodeId) ids.push(r.nodeId)
      if (cur.first && cur.first.nodeId) ids.push(cur.first.nodeId)
      if (cur.last && cur.last.nodeId) ids.push(cur.last.nodeId)
      genPatch(sessionId, { refs: [], first: null, last: null })
      for (const id of ids) removeRefCanvasNode(sessionId, id)
    }
    function seg(options, value, onChange) {
      return h('div', { className: 'svsg-seg', role: 'group' },
        options.map((o) => h('button', { key: o[0], type: 'button', className: value === o[0] ? 'on' : '', onClick: () => onChange(o[0]) }, o[1])))
    }

    /** input.left 工具行开关：共用 dsh 输入框；点「🎬 视频」把 video-generate 参数头写入草稿。 */
    function GenToggle(props) {
      const sessionId = props.sessionId
      const st = useGenSession(sessionId)
      const active = st ? st.mode : 'chat'
      if (!sessionId) return null
      const go = (mode) => {
        const prevMode = active
        const nextMode = active === mode ? 'chat' : mode
        // 退出任一生成模式（video/image）且切到其它模式：清空参考媒体（画布节点+文件一并删除）
        if (prevMode !== 'chat' && nextMode !== prevMode) svsPurgeRefNodes(sessionId)
        genPatch(sessionId, { mode: nextMode })
        const cur = genStateOf(sessionId)
        const draft = props.input && typeof props.input.draft === 'string' ? props.input.draft : ''
        const ia = props.inputActions
        if (nextMode === 'video' || nextMode === 'image') {
          svsSetHeader(ia, cur, draft, { longSide: matrixLongSide(tierMatrixCache, cur) })
        } else if (nextMode === 'chat') {
          if (ia && typeof ia.setDraft === 'function') ia.setDraft(svsPromptOf(draft))
        }
      }
      return h('div', { className: 'svsg-tools', role: 'group', title: '生成模式：点「🎨 图片」/「🎬 视频」把对应斜杠命令（含参数）写入输入框加载 skill；发送用 dsh 默认发送键' },
        h('button', { type: 'button', className: 'svsg-tool' + (active === 'image' ? ' on' : ''), title: '图片生成：加载 image-generate skill（文生图 / 图生图参考图）', onClick: () => go('image') }, '🎨 图片'),
        h('button', { type: 'button', className: 'svsg-tool' + (active === 'video' ? ' on' : ''), title: '视频生成：加载 video-generate skill（r2v 参考图 / i2v 首末帧）', onClick: () => go('video') }, '🎬 视频'),
      )
    }




    /**
     * 内嵌生成工具条（video-generate skill 的可视化入口，正式内嵌版）：
     * 接管 conversation.input.attachments 席位（priority:-1），渲染位置 = 原生
     * 输入卡内、textarea 上方。点「🎬 视频」（conversation.input.left 的 GenToggle）
     * 进入视频模式后参数条出现；prompt 照旧写在官方输入框，参数一变就重写
     * /elysium-generate-video 命令头并保留 prompt，发送用 dsh 默认发送键（不劫持 Enter）。
     * chat 模式/hero 下席位退化为原附件 rail 的最小等价实现（图 chip + 移除 +
     * 添加 + 拖放），避免接管后附件功能回退。
     */
    function InnerGenBar(props) {
      const sessionId = props.sessionId
      const st = useGenSession(sessionId)
      const mode = st ? st.mode : 'chat'
      const attachments = Array.isArray(props.attachments) ? props.attachments : []
      const inputActions = props.inputActions
      const useInput = typeof props.useInput === 'function' ? props.useInput : null
      const [error, setError] = React.useState('')
      const [tip, setTip] = React.useState('')
      const [token, setToken] = React.useState('')
      const [dragging, setDragging] = React.useState(false)
      // 档位矩阵（懒加载一次，进程内缓存）：尺寸/实现/耗时展示与后端解析同源
      const [matrix, setMatrix] = React.useState(tierMatrixCache)
      React.useEffect(() => {
        if (matrix) return
        let alive = true
        loadTierMatrix().then((m) => { if (alive && m) setMatrix(m) })
        return () => { alive = false }
      }, [])
      React.useEffect(() => { ensureSvsToken().then(setToken).catch(() => setToken('')) }, [])
      // 实时草稿来自席位标准套件的 useInput（session-maybe）
      let draft = ''
      if (useInput) {
        try {
          const snap = useInput((s) => (s && typeof s.draft === 'string' ? s.draft : ''))
          draft = typeof snap === 'string' ? snap : ''
        } catch (e) { console.warn('[dsh-short-video-studio] useInput 读取失败:', e) }
      }
      // 无会话（hero 空态等）：不占任何视觉
      const prevDraft = React.useRef(draft)
      const purgeTimer = React.useRef(null)
      const hasRefMedia = !!(st && ((st.refs && st.refs.length > 0) || st.first || st.last))
      React.useEffect(() => {
        if (purgeTimer.current) { clearTimeout(purgeTimer.current); purgeTimer.current = null }
        // 视频/图片生成模式下草稿被整段清空（命令头也没了）：宽限 1.2s 仍为空则清掉参考媒体
        if (sessionId && st && (mode === 'video' || mode === 'image') && hasRefMedia && draft === '' && prevDraft.current !== '') {
          purgeTimer.current = setTimeout(() => {
            const c = genStateOf(sessionId)
            if (c && c.mode !== 'chat' && ((c.refs && c.refs.length) || c.first || c.last)) svsPurgeRefNodes(sessionId)
          }, 1200)
        }
        prevDraft.current = draft
        return () => { if (purgeTimer.current) { clearTimeout(purgeTimer.current); purgeTimer.current = null } }
      }, [sessionId, mode, draft, hasRefMedia, st])
      if (!sessionId || !st) return null
      const canDrop = !!props.canAcceptDrop && typeof props.onAddImages === 'function'
      const mediaUrl = (media) => svsMediaUrl(sessionId, media, token)

      // 参数变化：更新 store 并重写草稿命令头（保留 prompt）
      function mutate(patch) {
        const c = genStateOf(sessionId)
        if (!c) return
        const next = Object.assign({}, c, patch)
        genPatch(sessionId, patch)
        svsSetHeader(inputActions, next, draft, { longSide: matrixLongSide(matrix, next) })
      }
      function removeCanvasNode(nodeId) {
        removeRefCanvasNode(sessionId, nodeId)
      }
      function pickUploadRef(role) {
        pickFile('image/png,image/jpeg,image/webp,image/gif', role === 'r2v', async (files) => {
          setError(''); setTip('')
          for (const f of files) {
            try {
              const rec = await svsUploadRef(sessionId, f)
              const c = genStateOf(sessionId)
              if (!c) continue
              const recRec = { nodeId: rec.nodeId, name: rec.name, media: rec.media }
              if (role === 'r2v') mutate({ refs: [...c.refs, recRec].slice(0, 8) })
              else if (role === 'first') { if (c.first) removeCanvasNode(c.first.nodeId); mutate({ first: recRec }) }
              else { if (c.last) removeCanvasNode(c.last.nodeId); mutate({ last: recRec }) }
            } catch (e) {
              setError('上传失败：' + (e && e.message ? e.message : String(e)))
            }
          }
        })
      }
      function dropRef(index) {
        const c = genStateOf(sessionId)
        if (!c) return
        const rec = c.refs[index]
        if (rec) removeCanvasNode(rec.nodeId)
        mutate({ refs: c.refs.filter((_, i) => i !== index) })
      }
      // i2i 图生图参考图：单张，重传时替换（旧的画布节点一并删除）
      function pickIIRef() {
        pickFile('image/png,image/jpeg,image/webp,image/gif', false, async (files) => {
          setError(''); setTip('')
          const f = files[0]
          if (!f) return
          try {
            const rec = await svsUploadRef(sessionId, f)
            const c = genStateOf(sessionId)
            if (!c) return
            const recRec = { nodeId: rec.nodeId, name: rec.name, media: rec.media }
            const old = c.refs && c.refs[0]
            if (old) removeCanvasNode(old.nodeId)
            mutate({ refs: [recRec] })
          } catch (e) {
            setError('上传失败：' + (e && e.message ? e.message : String(e)))
          }
        })
      }
      // 图片类型切换：i2i → t2i 时清掉参考媒体（画布节点+文件），避免孤儿节点
      function setImgType(v) {
        const c = genStateOf(sessionId)
        if (!c) return
        if ((c.imgType || 't2i') === 'i2i' && v !== 'i2i' && c.refs && c.refs.length) svsPurgeRefNodes(sessionId)
        mutate({ imgType: v })
      }
      function dropFrame(which) {
        const c = genStateOf(sessionId)
        if (!c || !c[which]) return
        removeCanvasNode(c[which].nodeId)
        mutate({ [which]: null })
      }
      function sel(options, value, onChange) {
        return h('select', { className: 'svsg-select', value, onChange: (e) => onChange(e.target.value) },
          options.map((o) => h('option', { key: o[0], value: o[0] }, o[1])))
      }
      const dropZone = {
        onDragOver: (e) => { if (canDrop) { e.preventDefault(); e.stopPropagation(); setDragging(true) } },
        onDragLeave: () => setDragging(false),
        onDrop: (e) => {
          if (!canDrop) return
          e.preventDefault(); e.stopPropagation(); setDragging(false)
          const files = Array.from((e.dataTransfer && e.dataTransfer.files) || []).filter((f) => /^image\//.test(f.type))
          if (files.length && props.onAddImages) props.onAddImages(files)
        },
      }
      const pickImages = () => pickFile('image/png,image/jpeg,image/webp,image/gif', true, (files) => { if (files.length && props.onAddImages) props.onAddImages(files) })
      // 媒体格：完全复刻 dsh 原生「上传图片」chip 的样式与尺寸（64px 圆角方块、
      // 细边框、缩略图铺满、hover 右上角 ✕）。空位/新增用同尺寸的 ➕ 格表示；
      // 上传成功的图直接铺满该方块，不显示文件名。
      function mediaSlot(media, onRemove, tip) {
        return h('div', { className: 'svsg-slot', title: tip },
          h('img', { src: media, alt: '' }),
          h('button', { type: 'button', className: 'x', title: tip || '移除', onClick: onRemove }, '✕'),
        )
      }
      function addSlot(onPick, tip) {
        return h('button', { type: 'button', className: 'svsg-slot add', title: tip, 'aria-label': tip, onClick: onPick })
      }
      // 附件 rail（chat / video 共用，样式与原版一致；有图才出现）
      const rail = attachments.length === 0 ? null : h('div', Object.assign({ className: 'svsg-rail' }, dropZone),
        attachments.map((a) => h('div', { key: a.id, className: 'svsg-slot' },
          a.previewUrl ? h('img', { src: a.previewUrl, alt: '' }) : null,
          h('button', { type: 'button', className: 'x', title: '移除图片', onClick: () => { if (props.onRemoveImage) props.onRemoveImage(a.id) } }, '✕'),
        )),
        addSlot(pickImages, '添加图片'),
      )
      if (mode === 'image') {
        const isII = (st.imgType || 't2i') === 'i2i'
        const imgDims = svsDims(st.ratio, 1344)
        const imgCounts = [1, 2, 3, 4].map((n) => [String(n), n + ' 张'])
        const imgRefRow = isII
          ? h('div', { className: 'svsg-row' },
              h('span', { className: 'svsg-lbl' }, '参考图'),
              (st.refs && st.refs[0] && st.refs[0].media
                ? mediaSlot(mediaUrl(st.refs[0].media), () => dropRef(0), '移除参考图（画布节点一并删除）')
                : addSlot(pickIIRef, '上传参考图')),
            )
          : null
        return h('div', Object.assign({ className: 'svsg-inner' + (dragging ? ' svsg-dropon' : '') }, dropZone),
          rail,
          h('div', { className: 'svsg-row' },
            h('span', { className: 'svsg-skill' }, isII ? '🎨 image-generate · 图生图' : '🎨 image-generate · 文生图'),
            grp('类型', seg([['t2i', '文生图'], ['i2i', '图生图']], st.imgType || 't2i', setImgType)),
            isII ? null : grp('比例', sel(GEN_RATIOS.image.map((r) => [r, r]), st.ratio, (v) => { mutate({ ratio: v }); setTip(''); setError('') })),
            isII ? grp('档位', (() => {
              const ms = modesOf(matrix, 'image.image2image')
              const cur = (st.imageTier && ms.includes(st.imageTier)) ? st.imageTier : (ms[0] || '')
              return ms.length
                ? sel(ms.map((m) => [m, m]), cur, (v) => mutate({ imageTier: v }))
                : h('span', { className: 'svsg-hint' }, '档位读取中…')
            })()) : null,
            grp('张数', sel(imgCounts, String(st.count || 1), (v) => mutate({ count: Number(v) || 1 }))),
            h('span', { className: 'svsg-hint' }, isII ? '尺寸跟随参考图' : '尺寸 ' + imgDims.width + '×' + imgDims.height),
          ),
          imgRefRow,
          (tip || error) ? h('div', { className: tip ? 'svsg-tip' : 'svsg-error' }, tip || error) : null,
        )
      }
      // chat 模式：仅附件 rail（视觉上与原 ui-attachment 行为对等）
      if (mode !== 'video') return rail

      const vcap = VIDEO_CAPABILITY[st.pipeline] || VIDEO_CAPABILITY.r2v
      const vTiers = tiersOf(matrix, vcap)
      const vt = (st.videoTier && (!vTiers.length || vTiers.includes(st.videoTier))) ? st.videoTier : (vTiers[0] || '')
      const vimpl = tierPick(matrix, vcap, vt)
      // 长边来自清单（与后端 computeManifestSize 同源）；清单尚未加载时按档位内置口径兜底
      const vLong = (vimpl && vimpl.longSide) || (vt === 'fast' ? 832 : 1344)
      const dims = svsDims(st.ratio, vLong)
      const vhint = '尺寸 ' + dims.width + '×' + dims.height
        + (vimpl ? ' · ' + vimpl.id + (vimpl.accel ? '（' + vimpl.accel + ' 加速）' : '') : '')
        + (vimpl && vimpl.estSeconds ? ' · 约 ' + Math.round(vimpl.estSeconds) + 's' : (vimpl ? ' · 耗时未知' : ''))
        + (vimpl && vimpl.available === false ? '　✗ 缺节点 ' + (vimpl.missingNodes || []).join('、') : '')
      const uploadRow = st.pipeline === 'r2v'
        ? h('div', { className: 'svsg-row' },
            st.refs.map((r, i) => (r.media ? mediaSlot(mediaUrl(r.media), () => dropRef(i), '移除参考图（画布节点一并删除）') : null)),
            st.refs.length < 8 ? addSlot(() => pickUploadRef('r2v'), '添加参考图') : null,
          )
        : h('div', { className: 'svsg-row' },
            h('span', { className: 'svsg-lbl' }, '首帧'),
            (st.first
              ? mediaSlot(mediaUrl(st.first.media), () => dropFrame('first'), '移除首帧')
              : addSlot(() => pickUploadRef('first'), '上传首帧')),
            h('span', { className: 'svsg-lbl' }, '末帧'),
            (st.last
              ? mediaSlot(mediaUrl(st.last.media), () => dropFrame('last'), '移除末帧')
              : addSlot(() => pickUploadRef('last'), '上传末帧（可选）')),
          )

      return h('div', Object.assign({ className: 'svsg-inner' + (dragging ? ' svsg-dropon' : '') }, dropZone),
        h('div', { className: 'svsg-row' },
          h('span', { className: 'svsg-skill' }, '🎬 video-generate 已加载'),
          grp('类型', sel([['r2v', 'r2v 参考图'], ['i2v', 'i2v 首/末帧']], st.pipeline, (v) => { mutate({ pipeline: v }); setTip(''); setError('') })),
          grp('档位', vTiers.length
            ? sel(vTiers.map((t) => {
                const meta = tierMetaOf(matrix, vcap, t)
                return [t, t + (meta && meta.estSeconds ? ' · 约 ' + Math.round(meta.estSeconds) + 's' : '')]
              }), vt, (v) => { mutate({ videoTier: v }); setTip(''); setError('') })
            : h('span', { className: 'svsg-hint' }, '档位读取中…')),
          grp('比例', sel(GEN_RATIOS.video.map((r) => [r, r]), st.ratio, (v) => mutate({ ratio: v }))),
          grp('时长', sel(GEN_SECONDS.map((s) => [s.frames, s.label]), st.seconds, (v) => mutate({ seconds: v }))),
          h('span', { className: 'svsg-hint' }, vhint),
        ),
        uploadRow,
        rail,
        (tip || error) ? h('div', { className: tip ? 'svsg-tip' : 'svsg-error' }, tip || error) : null,
      )
    }

    // =========================================================================
    // 画布的家（插件级配置项 canvasHome，见「设置 → ComfyUI → 界面」）
    // 启动时按配置**只注册一个家**，所以两种取值下都只可能有一个 studio iframe 实例
    //（结构上排除双实例，见 docs/docs/ARCHITECTURE.md §11.2）。
    //   'tab'     → conversation.view 会话区视图 tab（默认，现状）
    //   'sidebar' → 右侧栏 tab 类型 + 引导页胶囊（照抄 ui-sidebar-files 的原生做法）
    // 改动该项后需刷新页面（插件启动时读一次；设置页写明并给了一键刷新）。
    // =========================================================================
    const CANVAS_KIND = 'short-video-canvas'
    const CANVAS_ID = 'dsh-short-video-studio'
    const CANVAS_VIEW_ID = 'short-video-canvas'
    const CANVAS_LABEL = '创作'
    // 引导页胶囊的 order：files=10、terminal=20。画布排在宿主内置之前（本插件主面）。
    const CANVAS_GUIDE_ORDER = 5

    /**
     * 右栏引导页胶囊图标：一个分镜格。`IconProps` 只有 { size?, className? }（同
     * ui-sidebar-terminal 的 TerminalGuideIcon）。不传 icon 也能跑（引导页会用自带立方体占位符）。
     */
    function CanvasGuideIcon(props) {
      const size = (props && props.size) || 26
      return React.createElement('svg', {
        width: size, height: size, className: props && props.className,
        viewBox: '0 0 28 28', fill: 'none', 'aria-hidden': 'true',
      },
        React.createElement('rect', { x: 3, y: 4.5, width: 22, height: 19, rx: 3, fill: '#17191d' }),
        React.createElement('rect', { x: 6, y: 7.5, width: 7.5, height: 5.5, rx: 1.2, fill: '#5b8cff' }),
        React.createElement('rect', { x: 14.5, y: 7.5, width: 7.5, height: 5.5, rx: 1.2, fill: '#8a8f99' }),
        React.createElement('rect', { x: 6, y: 15.5, width: 16, height: 5, rx: 1.2, fill: '#2e3342' }),
      )
    }

    /** 家 = 会话区视图 tab（现状行为）。@returns 注销函数。 */
    function registerTabHome(ctx) {
      return ctx.slots.inject('conversation.view', () => ctx.slots.register({
        name: 'conversation.view',
        id: CANVAS_VIEW_ID,
        order: 20,
        label: CANVAS_LABEL,
      }, CanvasView))
    }

    /**
     * 家 = 右侧栏 tab 类型，走官方两阶段注册（与 ui-sidebar-files 同构）：
     * ① 类型定义进 `ctx.sidebarRightTabs`（含引导页胶囊）② 正文进 keyed 的 `sidebar.right.pane.tab`。
     * 不注册 `sidebar.right.pane.tab.title` —— 该席位可省，省略时 chip 直接用类型定义里的 title。
     * 正文**复用同一个 CanvasView**：session 作用域的席位同样拿到 sessionId / useWorkspaces /
     * inputActions（standardProps 按作用域下发，与贡献方是哪个包无关）。
     * 依赖用 `ctx.inject` 软注入：宿主没装右侧栏插件时回调不执行，整个浏览器半不会挂。
     * @returns 右栏家是否已注册。宿主未提供右侧栏服务时返回 false，调用方据此**保留**会话区家
     *   （画布始终可达——配错/禁用了右侧栏不该让画布消失）。
     */
    function registerSidebarHome(ctx) {
      // 先做**同步**可用性探测，再看是否注册。不能只靠 `ctx.inject` 的回调是否立刻执行来判断：
      // 依赖「稍后才出现」时回调也会在彼时执行，那样就会与会话区家同时存在（两个家）。
      const available = typeof ctx.get === 'function' && ctx.get('sidebarRightTabs') !== undefined
      if (!available) return false
      ctx.inject(['slots', 'sidebarRightTabs'], (scope) => {
        scope.effect(() => scope.sidebarRightTabs.register({
          id: CANVAS_ID,
          kind: CANVAS_KIND,
          title: () => CANVAS_LABEL,
          guide: [{
            id: 'canvas',
            order: CANVAS_GUIDE_ORDER,
            title: () => CANVAS_LABEL,
            description: () => '在右栏边看边生成：资产 / 镜头 / 片段',
            icon: CanvasGuideIcon,
          }],
        }), 'dsh-short-video-studio: 画布右栏类型')
        scope.effect(() => scope.slots.inject('sidebar.right.pane.tab', () => scope.slots.register({
          name: 'sidebar.right.pane.tab',
          // key 必须是**实现 id**（不是 kind）：shell 用 `entryKey: definition.id ?? tab.kind` 派发
          key: CANVAS_ID,
        }, CanvasView)), 'dsh-short-video-studio: 画布右栏正文')
      })
      return true
    }

    /**
     * 按配置注册唯一的一个家。
     * 同步先注册默认家（'tab' = 现状），异步读到 'sidebar' 时才改注册右栏并注销它：
     * 零回归、配置请求失败即默认、不需要 localStorage 镜像。启动瞬间多出的那个 tab 在读到
     * 配置后立即注销（改配置后本就建议刷新页面，该窗口对用户不可见）。
     */
    function applyCanvasHome(ctx) {
      const disposeTabHome = registerTabHome(ctx)
      fetch(CONFIG_API).then((r) => r.json()).then((d) => {
        if (!(d && d.ok && d.config && d.config.canvasHome === 'sidebar')) return
        // 依赖不可用（宿主未装/禁用了右侧栏插件）→ 不注销会话区家：画布仍然可达
        if (!registerSidebarHome(ctx)) {
          console.warn('[dsh-short-video-studio] canvasHome=sidebar，但宿主的右侧栏服务不可用：「创作」保留在会话区标签页。')
          return
        }
        try {
          if (typeof disposeTabHome === 'function') disposeTabHome()
        } catch (e) {
          console.warn('[dsh-short-video-studio] 注销会话区「创作」tab 失败（可能同时出现两个画布）:', e)
        }
      }).catch(() => { /* 读不到配置 → 保持默认家 'tab' */ })
    }

    function apply(ctx) {
      // 画布主题跟随宿主：记下 ctx 并订阅 ui-theme 的 theme/change（画布组件按需读取配色方案）。
      watchTheme(ctx)

      // 内嵌生成工具条：shadow conversation.input.attachments（priority:-1）——
      // 渲染在原生输入卡内、textarea 上方。chat 模式下退化为附件 rail。
      try {
        ctx.slots.inject('conversation.input.attachments', () => ctx.slots.register({
          name: 'conversation.input.attachments',
          priority: -1,
          inject: (sessionId) => ({ sessionId }),
        }, InnerGenBar))
      } catch (e) {
        console.warn('[dsh-short-video-studio] conversation.input.attachments 接管失败（附件 rail 由原生提供）:', e)
      }

      // 画布的家（canvasHome：'tab' = 会话视图 tab / 'sidebar' = 右侧栏 tab 类型）。
      // 只注册选中的那一个 —— 两种配置下都只有一个 studio iframe 实例。
      applyCanvasHome(ctx)

      // 输入框生成模式（共用 dsh 输入框 + 默认发送键）：工具行左端开关 + 卡内生成条。
      try {
        ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
          name: 'conversation.input.left',
          id: 'svs-generator-toggle',
          order: 10,
          inject: (sessionId) => ({ sessionId }),
        }, GenToggle))
      } catch (e) {
        console.warn('[dsh-short-video-studio] conversation.input.left 注册失败（可忽略；生成入口不可用）:', e)
      }

      // DSH 设置页新增「ComfyUI」一级设置段
      try {
        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section',
          id: 'comfyui',
          order: 120,
          label: () => 'ComfyUI',
        }, ComfyUISettings))
      } catch (e) {
        console.warn('[dsh-short-video-studio] settings.section 注册失败:', e)
      }
    }

    exports.apply = apply
    exports.inject = inject
    // 测试面（宿主忽略）：工具条命令行拼装与档位取值，供 scripts/checks/smoke-client-settings.mjs 断言
    exports.__test = { svsVideoHeader, svsImageHeader, svsDims, tierPick, tiersOf, tierMetaOf, modesOf, unclassifiedLongSide, GEN_DEFAULT }
    // 画布的家（供 scripts/checks/smoke-canvas-home.mjs 断言两种配置下的席位注册互斥）
    exports.__canvasHome = {
      CANVAS_KIND, CANVAS_ID, CANVAS_VIEW_ID, CANVAS_LABEL, CANVAS_GUIDE_ORDER,
      CanvasGuideIcon, registerTabHome, registerSidebarHome, applyCanvasHome, CanvasView,
    }
    // 画布主题（供 scripts/checks/smoke-canvas-home.mjs 断言「跟随宿主浅/深」的纯逻辑部分）
    exports.__canvasTheme = {
      readScheme, bootSchemeOnce, postThemeToFrame, watchTheme, subscribeScheme,
      /** 清掉首屏主题缓存（测试面：多个用例共享同一个模块实例）。 */
      resetThemeCache: () => { bootScheme = undefined; hostCtx = null; schemeListeners.clear() },
    }
    return module.exports
  },
})
