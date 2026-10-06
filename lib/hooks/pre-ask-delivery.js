import { existsSync } from 'node:fs'
import { copyFile, link, mkdir, unlink, writeFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { htmlToPdf } from '../pdf.js'
import { PROJECT_STEPS, safeName } from '../storage/layout.js'
import { escapeHtmlText, markdownToHtml } from '../../studio/markdown.js'

// ---------------------------------------------------------------------------
// pre-ask 自动送达（飞书渠道）
// ---------------------------------------------------------------------------
// 机制：宿主每个工具执行前都过 `tools/pre-execute` waterfall（可扩展、异步、
// 按 agent scope 分发）。本插件注册一个监听器：当 agent 即将调用
// `ask_user_question` 时，先把画布中「未送达」的产物程序化调 send_file
// 送达，再放行 ask。
// - 媒体（图片/视频/音频）直接发原文件；文本/表格节点导出为 .pdf 发送
//   （puppeteer-core/Chrome 渲染 HTML→PDF；无 PDF 工具时兜底 .html）。
// - 文件名：send_file 没有 name 参数（聊天显示名 = 路径 basename），钩子把产物
//   以「节点标题」命名的副本放到 workspace 内 .delivery/<sid>/ 再发送
//   （如 主角卡.png / 简报.pdf），发完即删；副本建不出来退回原路径。
// - send_file 是 dsh-lark per-agent 注册的工具；本插件用 ctx.tools.get(name, agent)
//   探测可见性（不可见 = Web/TUI 或 sendFiles=false → 自动跳过，不推）。
// - 去重：送达成功后写回节点 params.deliveredAt；失败不标记，下次 ask 前重试。
// - 该监听器只对 ask_user_question 生效，send_file 自身执行不会递归触发。
// 开关（改这里即可整体关闭 / 关闭文本导出）：
export const AUTO_DELIVER_BEFORE_ASK = true
export const TEXT_NODE_EXPORT_PDF = true

export function createPreAskDelivery({
  loadProject,
  projectDir,
  resolveStoredPath,
  resolveSessionRoot,
  saveProject,
}) {
  /** 收集画布中尚未送达的产物（按 order 升序）。 */
  function collectUndelivered(project) {
    const pending = []
    for (const n of (project?.nodes || [])) {
      if (n.status !== 'ready') continue
      if (n.params?.deliveredAt) continue
      if (n.kind === 'image' || n.kind === 'video' || n.kind === 'audio') {
        if (n.media) pending.push({ node: n, path: n.media })
      } else if (TEXT_NODE_EXPORT_PDF && (n.kind === 'text' || n.kind === 'table')) {
        if (n.file) pending.push({ node: n, path: n.file })
      }
    }
    return pending.sort((a, b) => (a.node.order || 0) - (b.node.order || 0))
  }

  // ---- 文本节点 markdown → HTML：渲染器在 studio/markdown.js（双端共享，与画布一致）----

  /** 文本/表格节点 → 完整 HTML 文档。 */
  function renderNodeHtml(title, kind, group, content) {
    return `<!DOCTYPE html>
  <html lang="zh-CN">
  <head>
  <meta charset="utf-8">
  <title>${escapeHtmlText(title)}</title>
  <style>
  body{font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;max-width:860px;margin:32px auto;padding:0 20px;color:#1f2328;line-height:1.7}
  h1{font-size:1.5em;border-bottom:1px solid #e5e7eb;padding-bottom:8px}
  h2,h3,h4{line-height:1.3}
  table{border-collapse:collapse;width:100%;margin:12px 0}
  th,td{border:1px solid #d8dee4;padding:6px 10px;text-align:left;font-size:0.92em}
  th{background:#f6f8fa}
  pre{background:#f6f8fa;border:1px solid #d8dee4;border-radius:6px;padding:12px;overflow-x:auto}
  code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:0.9em}
  blockquote{border-left:4px solid #d0d7de;margin:12px 0;padding:4px 14px;color:#57606a}
  .meta{color:#6e7781;font-size:0.85em;margin-bottom:16px}
  </style>
  </head>
  <body>
  <h1>${escapeHtmlText(title)}</h1>
  <p class="meta">kind: ${escapeHtmlText(kind)} · group: ${escapeHtmlText(group)}</p>
  ${markdownToHtml(content)}
  </body>
  </html>`
  }

  /**
   * 文本/表格节点导出交付文件：PDF 优先（puppeteer/Chrome/soffice/cupsfilter），
   * 无 PDF 工具或转换失败时兜底导出 .html。返回 { rel, ext }（失败也返回 html 兜底）。
   */
  async function exportTextNode(root, sid, nodeId, title, kind, group, content, pdfTool) {
    const project = await loadProject(root, sid)
    const text = `${title || ''} ${group || ''}`
    const step = /分集|大纲/.test(text) ? PROJECT_STEPS.episodePlan
      : /剧本|镜头表/.test(text) ? PROJECT_STEPS.scripts
        : /角色|场景|资产/.test(text) ? PROJECT_STEPS.assets
          : /分镜|prompt/i.test(text) ? PROJECT_STEPS.storyboards
            : /拼接|时间线/.test(text) ? PROJECT_STEPS.assembly
              : /质检|审核|报告/.test(text) ? PROJECT_STEPS.qualityReview
                : /交付|成片/.test(text) ? PROJECT_STEPS.delivery
                  : PROJECT_STEPS.development
    const stepNo = step.slice(5, 7)
    const dir = projectDir(root, project.projectId, step)
    await mkdir(dir, { recursive: true })
    const stem = `step-${stepNo}-${safeName(title, kind || 'document')}`
    let version = 1
    while (existsSync(join(dir, `${stem}-v${String(version).padStart(3, '0')}.html`)) || existsSync(join(dir, `${stem}-v${String(version).padStart(3, '0')}.pdf`))) version++
    const base = `${stem}-v${String(version).padStart(3, '0')}`
    const htmlRel = `artifacts/${project.projectId}/${step}/${base}.html`
    const htmlAbs = join(dir, `${base}.html`)
    await writeFile(htmlAbs, renderNodeHtml(title, kind, group, content), 'utf8')
    if (pdfTool) {
      try {
        const pdfRel = `artifacts/${project.projectId}/${step}/${base}.pdf`
        const pdfAbs = join(dir, `${base}.pdf`)
        await htmlToPdf(pdfTool, htmlAbs, pdfAbs)
        await unlink(htmlAbs).catch(() => {})
        return { rel: pdfRel, ext: 'pdf' }
      } catch (error) {
        console.warn('[dsh-short-video-studio] html→pdf failed, fallback .html:', error?.message || String(error))
      }
    }
    return { rel: htmlRel, ext: 'html' }
  }

  // ---- 交付文件名：send_file 没有 name 参数（dsh-lark 只收 {path}），
  //      聊天显示名 = path 的 basename（outbound-file.ts `fileName: basename(canonical)`）。
  //      因此把产物以「节点标题」命名的副本放到 workspace 内 .delivery/<sid>/，
  //      发副本路径 → 飞书显示 主角卡.png / 简报.pdf，而不是内部 nodeId。发完即删。

  /** workspace 内交付副本目录（隐藏目录，不参与画布伺服/资产）。 */
  const DELIVERY_DIR = '.delivery'

  /** 由节点派生友好文件名：`<title>.<ext>`，清理非法字符；title 为空回退 `<kind>-<nodeId前8>.<ext>`。 */
  function deliveryFilename(node, path) {
    const ext = extname(path).toLowerCase()
    let base = String(node.title || '').trim()
    base = base.replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().replace(/\.+$/g, '').slice(0, 60)
    if (!base) base = (node.kind || 'file') + '-' + String(node.id || '').slice(0, 8)
    return base + ext
  }

  /**
   * 为送达建友好名副本（硬链接零拷贝，失败退复制）。同名冲突加 -2/-3 后缀。
   * 副本建不出来返回 null（调用方退回原路径发送，不阻塞送达）。
   * @returns {{rel:string, abs:string}|null} 副本的 workspace 相对路径与绝对路径
   */
  async function stageDeliveryFile(root, sid, item) {
    const name = deliveryFilename(item.node, item.path)
    if (name === basename(item.path)) return null // 原名已是友好名
    const srcAbs = resolveStoredPath(root, item.path)
    const relDir = DELIVERY_DIR + '/' + sid
    const dirAbs = join(root, ...relDir.split('/'))
    await mkdir(dirAbs, { recursive: true })
    let rel = relDir + '/' + name
    let abs = join(dirAbs, name)
    const stem = name.replace(/\.[^.]*$/, '')
    const ext = extname(name)
    let i = 2
    while (existsSync(abs)) {
      rel = relDir + '/' + `${stem}-${i}${ext}`
      abs = join(dirAbs, `${stem}-${i}${ext}`)
      i++
    }
    try {
      await link(srcAbs, abs)
    } catch {
      try { await copyFile(srcAbs, abs) } catch { return null }
    }
    return { rel, abs }
  }

  /**
   * 把 pending 列表逐个经 send_file 送达（友好文件名副本）；成功者打 deliveredAt 标记，
   * 失败者记 deliveryError（下次 ask 前会重试，模型可用 canvas_get_node 查原因）。
   * 失败只 console.warn（不阻塞 ask）。返回 { sent, errored }。
   */
  async function deliverPending(ctx, exec, root, sid, project, pending) {
    let sent = 0
    let errored = 0
    for (const item of pending) {
      const n = project.nodes.find((x) => x.id === item.node.id)
      let staged = null
      try {
        staged = await stageDeliveryFile(root, sid, item)
        await ctx.tools.execute({
          name: 'send_file',
          arguments: { path: staged ? staged.rel : item.path },
          agent: exec.agent,
          signal: exec.signal,
        })
        if (n) n.params = { ...(n.params || {}), deliveredAt: Date.now() }
        sent++
      } catch (error) {
        if (n) n.params = { ...(n.params || {}), deliveryError: String(error?.message || error) }
        errored++
        console.warn(`[dsh-short-video-studio] pre-ask deliver failed for ${item.path}:`, error?.message || String(error))
      } finally {
        if (staged) await unlink(staged.abs).catch(() => {})
      }
    }
    if (sent > 0 || errored > 0) await saveProject(root, sid, project)
    return { sent, errored }
  }

  /**
   * 构造 tools/pre-execute 监听器：只拦 ask_user_question；当前 agent scope 可见
   * send_file 时（飞书渠道），先把画布未送达产物送达，再放行 ask。
   * 任何异常都不阻塞 ask（只 warn）。
   */
  function makePreAskDeliverListener(ctx) {
    return async function preAskDeliverListener(exec, next) {
      if (!AUTO_DELIVER_BEFORE_ASK || exec?.name !== 'ask_user_question') return next()
      try {
        const agent = exec.agent
        if (!agent || typeof ctx.tools?.get !== 'function') return next()
        // 渠道探测：当前 agent scope 看不到 send_file（Web/TUI，或飞书 sendFiles=false）→ 不推送
        if (!ctx.tools.get('send_file', agent)) return next()
        const sid = agent.id
        const { root } = resolveSessionRoot(ctx, sid, '', exec)
        const project = await loadProject(root, sid)
        const pending = collectUndelivered(project)
        if (pending.length > 0) await deliverPending(ctx, exec, root, sid, project, pending)
      } catch (error) {
        console.warn('[dsh-short-video-studio] pre-ask deliver skipped:', error?.message || String(error))
      }
      return next()
    }
  }

  return {
    collectUndelivered,
    deliverPending,
    makePreAskDeliverListener,
    exportTextNode,
    deliveryFilename,
    renderNodeHtml,
  }
}
