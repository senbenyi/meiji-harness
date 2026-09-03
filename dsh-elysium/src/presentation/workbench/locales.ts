/**
 * Minimal zh/en/ja copy for the sidebar. The copy follows the DSH i18n system:
 * the client apply attaches the locale service (`ctx.locale`, provided by
 * `@deepseek-ai/dsh-client-locale`) through {@link attachLocale}, and
 * `t()`/`isZh()` resolve the active locale from it — the Host-backed
 * `locale.preference` wins over the raw browser language and switches live.
 * Without an attached service (standalone/test compositions) the browser
 * language is used, matching the previous behavior. The dictionaries are
 * also registered into the DSH locale registry under {@link LOCALE_NS}.
 *
 * ja (Japanese) is opt-in through `@huanlin/dsh-plugin-better-locale`: when
 * that plugin is installed, the client apply also calls
 * {@link attachBetterLocale} with the override store. `t()` then consults
 * the store's active override id first; if it is `'ja'` (or any id whose
 * dict has the requested key) the ja text wins, otherwise the existing
 * zh/en chain runs unchanged. better-locale itself patches
 * `LocaleRuntime.prototype.lookup` so DSH's own translate chain also
 * returns ja where the `betterSidebar` namespace has a ja entry — that
 * path covers external callers of `ctx.locale.bind('betterSidebar')`,
 * while the override-aware `t()` here covers Elysium's own
 * components (which bypass `ctx.locale` and call `t()` directly).
 */

/** The zh dictionary (also registered into the DSH locale registry under {@link LOCALE_NS}). */
export const zh = {
  files: '文件',
  explorer: '资源管理器',
  editor: '编辑器',
  editorExplorer: '文件打开方式',
  editorExplorerDesc: '控制文件打开方式',
  editorExplorerMerged: '合并',
  editorExplorerMergedDesc: '文件在同一窗口内原地切换；新窗口默认展开文件树',
  editorExplorerSplit: '独立',
  editorExplorerSplitDesc: '无路径窗口即资源管理器（仅文件树）；文件各自新开窗口（带文件树，默认收起）',
  editorTreeToggle: '文件树面板',
  editorPathPlaceholder: '输入文件路径（相对会话目录或绝对路径），Enter 打开',
  editorSearchPlaceholder: '按文件名搜索…',
  editorSearchNoResults: '无匹配文件',
  editorSearchTruncated: '结果过多，仅显示部分匹配',
  editorEmptyHint: '从右侧文件树或上方路径输入框选择文件开始预览',
  openFileNewTab: '在新 Tab 中打开',
  openFileSide: '在侧边打开',
  openWithMenu: '在应用中打开',
  openWithSshSuffix: ' (SSH)',
  pinOpenWith: '固定到菜单',
  unpinOpenWith: '取消固定',
  openWithExplorer: '资源管理器',
  openWithVscode: 'VS Code',
  openWithCursor: 'Cursor',
  openWithZed: 'Zed',
  openWithSettingsSshTitle: 'SSH 远端主机',
  openWithSettingsSshDesc: '留空为本地工作区；填入 user@host 或 SSH 别名后，VSCode 系打开方式将改用 vscode-remote/ssh-remote 协议，资源管理器 / Zed / 非 VSCode 系自定义编辑器将从菜单隐藏',
  openWithSettingsSshPlaceholder: 'user@host 或 SSH 别名',
  openWithSettingsCustomTitle: '自定义编辑器',
  openWithSettingsCustomDesc: '名称 + URL 模板（{path} 占位符）+ 是否 VSCode 系；SSH 模式下仅 VSCode 系可打开远端',
  openWithSettingsAdd: '添加',
  openWithSettingsName: '名称',
  openWithSettingsTemplate: '如 cursor://file/{path}',
  openWithSettingsFamily: 'VSCode 系',
  openWithSettingsFamilyDesc: '该编辑器使用 VSCode 的 URL 协议（支持 SSH 远端打开）',
  openWithSettingsRemove: '删除',
  openWithSettingsInvalidHint: '名称或模板（需含 {path} 且以 scheme:// 开头）未填写的编辑器不会出现在菜单中',
  newTab: '新建标签页',
  openExplorer: '资源管理器',
  brokenSymlink: '失效的软链接',
  close: '关闭',
  closeOtherTabs: '关闭其他页签',
  closeLeftTabs: '关闭左侧页签',
  closeRightTabs: '关闭右侧页签',
  moveToFreeWindow: '移动到自由窗口',
  floatDropHint: '松开以在自由窗口中打开',
  dockToSidebar: '回到侧边栏',
  collapse: '折叠侧边栏',
  expand: '展开侧边栏',
  collapseBottomPanel: '折叠底部面板',
  expandBottomPanel: '展开底部面板',
  preview: '预览',
  toc: '目录',
  edit: '编辑',
  mermaidError: 'Mermaid 渲染失败',
  mermaidZoomIn: '放大',
  mermaidZoomOut: '缩小',
  mermaidZoomReset: '重置',
  mermaidZoomHint: '滚轮缩放 · 拖拽平移 · Esc 关闭',
  refresh: '刷新',
  refreshUnsavedConfirm: '文件已在磁盘更新，刷新将丢弃未保存编辑。继续吗？',
  save: '保存',
  saved: '已保存',
  unsaved: '未保存',
  saveFailed: '保存失败',
  truncation: '文件过大，仅显示前 512KB',
  binary: '二进制文件，无法预览',
  loading: '加载中…',
  error: '加载失败',
  retry: '重试',
  splitLeft: '向左分栏',
  splitRight: '向右分栏',
  splitUp: '向上分栏',
  splitDown: '向下分栏',
  cancel: '取消',
  produced: '本次产出',
  producedOpen: '在侧边栏中打开',
  showInFolder: '在文件夹中显示',
  noSession: '选择一个会话以使用侧边栏',
  pluginNotLoaded: '插件未加载，标签页暂不可用：',
  hiddenFiles: '隐藏文件',
  parent: '上级目录',
  copied: '已复制',
  copy: '复制',
  newFile: '新文件',
  openEditor: '打开编辑器',
  gitDetail: '查看变更详情',
  referenceFile: '@文件',
  addToConversation: '添加到对话',
  copyRelative: '复制相对地址',
  copyAbsolute: '复制绝对地址',
  download: '下载',
  uploadFiles: '上传文件',
  uploadFolder: '上传文件夹',
  uploadHere: '上传到此处',
  uploadDropHint: '拖拽文件/文件夹到此处上传',
  uploadDropChat: '拖放到聊天区：添加图片到对话',
  uploadTo: '上传到 {dir}',
  uploadingTo: '正在上传到 {dir}…',
  uploadProgress: '正在上传 {done}/{total}: {name}',
  uploadDone: '已上传 {count} 个文件',
  uploadFailed: '上传失败：{error}',
  uploadFailedUnknown: '未知错误',
  uploadTooLarge: '文件过大，超出上传上限',
  uploadCancelled: '上传已取消',
  settingsNav: '极乐世界',
  settingsPopupDesc: '为「{feature}」配置相关选项',
  settingsDone: '完成',
  settingsSaveFailed: '保存失败',
  settingsConflict: '设置已被其他窗口修改，请重试',
  binaryNoPreview: '此文件类型不支持预览',
  downloadToView: '下载查看',
  settingsSubagentTitle: '检测到子代理时自动展开任务管理页',
  settingsSubagentDesc: '当前会话产生新的子代理时，自动展开侧边栏并打开任务管理页；关闭后需手动打开',
  settingsJobsTitle: '有新后台任务时自动展开后台任务页',
  settingsJobsDesc: '当前会话出现新的后台任务时，自动展开侧边栏并打开后台任务页（每个新任务都会触发）；关闭后需手动打开',
  settingsFenceTitle: '工作区路径检测',
  settingsFenceDesc: '开启后，侧栏的文件功能仅能访问会话工作区内的路径（默认）；关闭后可访问主机上任意文件——关闭期间页面内脚本也将获得同等访问能力',
  fenceErrorReason: '此路径在会话工作区之外，已被工作区检测拦截',
  fenceDisableAction: '关闭工作区检测',
  settingsTabsTitle: '侧边栏内容',
  settingsPopup: '功能设置',
  viewerImage: '图片',
  viewerPdf: 'PDF',
  viewerMarkdown: 'Markdown',
  viewerCode: '代码',
  viewerBinary: '二进制下载',
  viewerHtml: 'HTML',
  browser: '浏览器',
  browserPlaceholder: '输入网址，例如 example.com',
  browserGo: '前往',
  browserBack: '后退',
  browserForward: '前进',
  browserStart: '输入网址开始浏览（沙箱模式）',
  browserBlockedScheme: '已阻止：仅支持 http/https 链接',
  browserBlockedLoopback: '已阻止：不允许在浏览器中访问本机或内部地址',
  browserInvalid: '无效的网址',
  browserNoSandboxWarning: '沙箱已关闭：当前页面与界面同源，拥有完整会话权限（可在设置中恢复）',
  htmlNoSandboxWarning: '沙箱已关闭：此 HTML 与界面同源，可读取会话文件与内部接口（可在设置中恢复）',
  sandboxStatusOn: '沙箱模式：已启用 · 页面无法访问界面数据与本地文件，登录态与第三方 Cookie 可能不可用',
  sandboxUnlock: '临时解锁（不安全）',
  sandboxRestore: '恢复沙箱',
  settingsHtmlDefaultUnsafeTitle: 'HTML 预览默认以非沙箱模式打开（不安全）',
  settingsHtmlDefaultUnsafeDesc: '开启后，每次打开 HTML 文件时预览默认处于非沙箱状态（与界面同源，可读取会话文件与内部接口）；可在状态行临时恢复沙箱',
  settingsHtmlSandboxTitle: '关闭 HTML 预览沙箱（不安全）',
  settingsHtmlSandboxDesc: '关闭后，预览的 HTML 将与界面同源运行，可读取会话文件、本地存储并调用内部接口。仅对完全可信的文件开启',
  settingsBrowserSandboxTitle: '关闭浏览器沙箱（不安全）',
  settingsBrowserSandboxDesc: '关闭后，访问的任何网站都将与界面同源运行，可读取会话数据并冒充你的登录状态。仅对完全可信的站点开启',
  settingsBrowserLinksTitle: '聊天区外链在侧边栏打开',
  settingsBrowserLinksDesc: '开启后，点击聊天或界面中的外链时在侧边栏打开，不再弹出新窗口；HTTP 与 HTTPS 可分别通过下方开关控制；Ctrl/Cmd 点击可临时放行',
  settingsBrowserHttpTitle: '侧边打开HTTP网页',
  settingsBrowserHttpDesc: '开启后，点击聊天或界面中的 HTTP 外链时在侧边栏打开（声明了 urlTarget 的插件页面优先）；Ctrl/Cmd 点击可临时放行',
  settingsBrowserHttpsTitle: '侧边打开HTTPS网页',
  settingsBrowserHttpsDesc: '开启后，点击聊天或界面中的 HTTPS 外链时在侧边栏打开。默认关闭：多数 HTTPS 站点拒绝被嵌入，走系统浏览器更顺畅',
  settingsBrowserLoopbackTitle: '允许访问的本机地址',
  settingsBrowserLoopbackDesc: '逗号分隔的本地回环地址白名单（如 localhost:5174 或 127.0.0.1:8080），侧边栏浏览器可访问这些本地服务；默认留空则本机地址全部拦截。沙箱隔离仍然生效，页面无法读取界面数据',
  settingsBrowserLoopbackPlaceholder: '例如 localhost:5174, 127.0.0.1:8080',
  browserOpenExternal: '在浏览器中打开',
  browserEmbedBlocked: '{host} 拒绝了嵌入请求',
  browserEmbedBlockedDesc: '该站点通过 X-Frame-Options / frame-ancestors 禁止在其它页面中显示，无法在侧边栏内加载。可在浏览器中直接打开',
  browserEmbedAnyway: '仍然加载',
  subagent: '任务管理',
  openSubagent: '任务管理',
  subagentMainAgent: '主代理',
  subagentEmpty: '暂无子代理',
  subagentEmptyDesc: '当前主代理派生的子代理将显示在这里',
  subagentRunning: '运行中',
  subagentInactive: '空闲',
  subagentModeOneShot: '一次性',
  subagentModeContinuable: '可续接',
  subagentCount: '{count} 个子代理',
  subagentCountRunning: '{count} 个子代理 · {running} 运行中',
  subagentDiagCorrupt: '目录损坏',
  subagentDiagUnsupported: '不支持的条目',
  subagentDiagUnavailable: '不可用',
  subagentThinking: '思考中…',
  jobs: '后台任务',
  jobsCount: '{count} 个后台任务',
  jobsCountRunning: '{count} 个后台任务 · {running} 运行中',
  jobStatusRunning: '运行中',
  jobStatusStopping: '终止中',
  jobStatusCompleted: '已完成',
  jobStatusKilled: '已终止',
  jobStatusFailed: '失败',
  jobDurationSeconds: '{seconds} 秒',
  jobDurationMinutes: '{minutes} 分 {seconds} 秒',
  jobDurationHours: '{hours} 小时 {minutes} 分',
  jobViewOutput: '查看输出',
  jobHideOutput: '收起输出',
  jobNoOutput: '暂无输出',
  jobNotReadYet: '等待模型读取该任务的输出（模型执行 job_output 后，输出会显示在这里）',
  jobOutputTruncated: '输出过长，已截断显示',
  jobOutputError: '输出读取失败',
  jobKill: '终止',
  jobKillConfirm: '再次点击确认终止',
  jobKillError: '终止失败',
}

/** The en dictionary (key-set-equal to zh, enforced by the type annotation). */
export const en: Record<keyof typeof zh, string> = {
  files: 'Files',
  explorer: 'Explorer',
  editor: 'Editor',
  editorExplorer: 'File open behavior',
  editorExplorerDesc: 'Controls how files open',
  editorExplorerMerged: 'Merged',
  editorExplorerMergedDesc: 'Files switch in place in the same window; new windows start with the tree open',
  editorExplorerSplit: 'Separate',
  editorExplorerSplitDesc: 'Path-less windows are the standalone explorer (tree only); each file opens its own window (tree docked, closed by default)',
  editorTreeToggle: 'File tree panel',
  editorPathPlaceholder: 'File path (relative to the session directory or absolute), Enter to open',
  editorSearchPlaceholder: 'Search files by name…',
  editorSearchNoResults: 'No matching files',
  editorSearchTruncated: 'Too many results — showing a partial list',
  editorEmptyHint: 'Pick a file from the tree panel or the path input above to start previewing',
  openFileNewTab: 'Open in New Tab',
  openFileSide: 'Open to the Side',
  openWithMenu: 'Open with',
  openWithSshSuffix: ' (SSH)',
  pinOpenWith: 'Pin to menu',
  unpinOpenWith: 'Unpin',
  openWithExplorer: 'File Manager',
  openWithVscode: 'VS Code',
  openWithCursor: 'Cursor',
  openWithZed: 'Zed',
  openWithSettingsSshTitle: 'SSH remote host',
  openWithSettingsSshDesc: 'Empty = local workspace; with a user@host or SSH alias, VSCode-family openers switch to the vscode-remote/ssh-remote protocol and the File Manager / Zed / non-VSCode-family custom editors are hidden from the menu',
  openWithSettingsSshPlaceholder: 'user@host or SSH alias',
  openWithSettingsCustomTitle: 'Custom editors',
  openWithSettingsCustomDesc: 'Name + URL template ({path} placeholder) + VSCode-family flag; in remote mode only VSCode-family editors can open a remote path',
  openWithSettingsAdd: 'Add',
  openWithSettingsName: 'Name',
  openWithSettingsTemplate: 'e.g. cursor://file/{path}',
  openWithSettingsFamily: 'VSCode-family',
  openWithSettingsFamilyDesc: 'This editor speaks the VSCode URL dialect (supports SSH-remote opens)',
  openWithSettingsRemove: 'Remove',
  openWithSettingsInvalidHint: 'Editors with a missing name or a template without {path} / scheme:// are not shown in the menu',
  newTab: 'New tab',
  openExplorer: 'Explorer',
  brokenSymlink: 'Broken symlink',
  close: 'Close',
  closeOtherTabs: 'Close Other Tabs',
  closeLeftTabs: 'Close Tabs to the Left',
  closeRightTabs: 'Close Tabs to the Right',
  moveToFreeWindow: 'Move to Free Window',
  floatDropHint: 'Release to open in a free window',
  dockToSidebar: 'Dock Back to Sidebar',
  collapse: 'Collapse sidebar',
  expand: 'Expand sidebar',
  collapseBottomPanel: 'Collapse bottom panel',
  expandBottomPanel: 'Expand bottom panel',
  preview: 'Preview',
  toc: 'Table of contents',
  edit: 'Edit',
  mermaidError: 'Mermaid render failed',
  mermaidZoomIn: 'Zoom in',
  mermaidZoomOut: 'Zoom out',
  mermaidZoomReset: 'Reset',
  mermaidZoomHint: 'Scroll to zoom · drag to pan · Esc to close',
  refresh: 'Refresh',
  refreshUnsavedConfirm: 'The file changed on disk. Refreshing will discard unsaved edits. Continue?',
  save: 'Save',
  saved: 'Saved',
  unsaved: 'Unsaved',
  saveFailed: 'Save failed',
  truncation: 'File too large — showing the first 512KB',
  binary: 'Binary file, preview unavailable',
  loading: 'Loading…',
  error: 'Failed to load',
  retry: 'Retry',
  splitLeft: 'Split left',
  splitRight: 'Split right',
  splitUp: 'Split up',
  splitDown: 'Split down',
  cancel: 'Cancel',
  produced: 'Produced',
  producedOpen: 'Open in sidebar',
  showInFolder: 'Show in folder',
  noSession: 'Select a conversation to use the sidebar',
  pluginNotLoaded: 'Plugin not loaded; tab unavailable:',
  hiddenFiles: 'Hidden files',
  parent: 'Parent directory',
  copied: 'Copied',
  copy: 'Copy',
  newFile: 'New file',
  openEditor: 'Open editor',
  gitDetail: 'View change details',
  referenceFile: '@file',
  addToConversation: 'Add to conversation',
  copyRelative: 'Copy relative path',
  copyAbsolute: 'Copy absolute path',
  download: 'Download',
  uploadFiles: 'Upload files',
  uploadFolder: 'Upload folder',
  uploadHere: 'Upload here',
  uploadDropHint: 'Drop files/folders here to upload',
  uploadDropChat: 'Drop onto the chat to add images',
  uploadTo: 'Upload into {dir}',
  uploadingTo: 'Uploading into {dir}…',
  uploadProgress: 'Uploading {done}/{total}: {name}',
  uploadDone: 'Uploaded {count} file(s)',
  uploadFailed: 'Upload failed: {error}',
  uploadFailedUnknown: 'Unknown error',
  uploadTooLarge: 'File too large (over the upload limit)',
  uploadCancelled: 'Upload cancelled',
  settingsNav: 'Side card',
  settingsPopupDesc: 'Configure related options for {feature}',
  settingsDone: 'Done',
  settingsSaveFailed: 'Failed to save',
  settingsConflict: 'The setting changed in another window — please retry',
  binaryNoPreview: 'This file type cannot be previewed',
  downloadToView: 'Download to view',
  settingsSubagentTitle: 'Auto-open the Tasks page when a subagent appears',
  settingsSubagentDesc: 'Expand the side card and open the Tasks page when the current conversation spawns a new subagent; turn off to open it manually',
  settingsJobsTitle: 'Auto-open the Jobs page on a new background job',
  settingsJobsDesc: 'Expand the side card and open the Jobs page whenever a new background job appears for the current conversation (every new job triggers); turn off to open it manually',
  settingsFenceTitle: 'Workspace path fence',
  settingsFenceDesc: 'On, the sidebar\'s file features only reach paths inside the session workspace (default); off, any file on the host is reachable — page scripts gain the same reach while it is off',
  fenceErrorReason: 'This path is outside the session workspace and was blocked by the workspace fence',
  fenceDisableAction: 'Turn off the workspace fence',
  settingsTabsTitle: 'Sidebar content',
  settingsPopup: 'Feature settings',
  viewerImage: 'Image',
  viewerPdf: 'PDF',
  viewerMarkdown: 'Markdown',
  viewerCode: 'Code',
  viewerBinary: 'Binary download',
  viewerHtml: 'HTML',
  browser: 'Browser',
  browserPlaceholder: 'Enter a URL, e.g. example.com',
  browserGo: 'Go',
  browserBack: 'Back',
  browserForward: 'Forward',
  browserStart: 'Enter a URL to start browsing (sandbox mode)',
  browserBlockedScheme: 'Blocked: only http/https URLs are allowed',
  browserBlockedLoopback: 'Blocked: local and internal addresses cannot be browsed here',
  browserInvalid: 'Invalid URL',
  browserNoSandboxWarning: 'Sandbox off: the current page runs with full GUI privileges (re-enable in settings)',
  htmlNoSandboxWarning: 'Sandbox off: this HTML runs with full GUI privileges (re-enable in settings)',
  sandboxStatusOn: 'Sandbox mode: on · pages cannot access the GUI\'s data or local files; logins and third-party cookies may not work',
  sandboxUnlock: 'Temporarily disable (unsafe)',
  sandboxRestore: 'Restore sandbox',
  settingsHtmlDefaultUnsafeTitle: 'Open HTML previews unsandboxed by default (unsafe)',
  settingsHtmlDefaultUnsafeDesc: 'When on, every newly opened HTML preview starts in the unsandboxed state (same origin as the GUI — it can read session files and internal APIs); the status row still offers a one-tap restore',
  settingsHtmlSandboxTitle: 'Disable HTML preview sandbox (unsafe)',
  settingsHtmlSandboxDesc: 'With the sandbox off, previewed HTML runs with the same origin as the GUI: it can read session files, local storage and call internal APIs. Only enable for fully trusted files',
  settingsBrowserSandboxTitle: 'Disable browser sandbox (unsafe)',
  settingsBrowserSandboxDesc: 'With the sandbox off, any visited site runs with the same origin as the GUI: it can read session data and act as your logged-in session. Only enable for fully trusted sites',
  settingsBrowserLinksTitle: 'Open chat external links in the sidebar',
  settingsBrowserLinksDesc: 'When on, clicking an external link in the chat or GUI opens the sidebar instead of a new window; HTTP and HTTPS are controlled separately by the switches below; Ctrl/Cmd+click always bypasses',
  settingsBrowserHttpTitle: 'Open HTTP pages in the sidebar',
  settingsBrowserHttpDesc: 'When on, clicking an HTTP external link in the chat or GUI opens the sidebar (plugin pages declaring urlTarget win); Ctrl/Cmd+click always bypasses',
  settingsBrowserHttpsTitle: 'Open HTTPS pages in the sidebar',
  settingsBrowserHttpsDesc: 'When on, clicking an HTTPS external link in the chat or GUI opens the sidebar. Off by default: most HTTPS sites refuse to be embedded, so the system browser is the smoother default',
  settingsBrowserLoopbackTitle: 'Allowed local addresses',
  settingsBrowserLoopbackDesc: 'Comma-separated allowlist of loopback addresses (e.g. localhost:5174 or 127.0.0.1:8080) the sidebar browser may visit; empty blocks all local addresses by default. The sandbox still applies — pages cannot read GUI data',
  settingsBrowserLoopbackPlaceholder: 'e.g. localhost:5174, 127.0.0.1:8080',
  browserOpenExternal: 'Open in browser',
  browserEmbedBlocked: '{host} refused to be embedded',
  browserEmbedBlockedDesc: 'The site forbids being displayed inside other pages (X-Frame-Options / frame-ancestors), so it cannot load in the sidebar. Open it directly in your browser instead.',
  browserEmbedAnyway: 'Load anyway',
  subagent: 'Tasks',
  openSubagent: 'Tasks',
  subagentMainAgent: 'Main agent',
  subagentEmpty: 'No subagents',
  subagentEmptyDesc: 'Subagents spawned under the main agent will appear here',
  subagentRunning: 'Running',
  subagentInactive: 'Inactive',
  subagentModeOneShot: 'One-shot',
  subagentModeContinuable: 'Continuable',
  subagentCount: '{count} subagents',
  subagentCountRunning: '{count} subagents · {running} running',
  subagentDiagCorrupt: 'Corrupt',
  subagentDiagUnsupported: 'Unsupported',
  subagentDiagUnavailable: 'Unavailable',
  subagentThinking: 'Thinking…',
  jobs: 'Background jobs',
  jobsCount: '{count} background jobs',
  jobsCountRunning: '{count} background jobs · {running} running',
  jobStatusRunning: 'Running',
  jobStatusStopping: 'Stopping',
  jobStatusCompleted: 'Completed',
  jobStatusKilled: 'Killed',
  jobStatusFailed: 'Failed',
  jobDurationSeconds: '{seconds}s',
  jobDurationMinutes: '{minutes}m {seconds}s',
  jobDurationHours: '{hours}h {minutes}m',
  jobViewOutput: 'View output',
  jobHideOutput: 'Hide output',
  jobNoOutput: 'No output yet',
  jobNotReadYet: 'Waiting for the model to read this job; its output appears here once the model runs job_output',
  jobOutputTruncated: 'Output truncated',
  jobOutputError: 'Failed to read output',
  jobKill: 'Kill',
  jobKillConfirm: 'Click again to confirm kill',
  jobKillError: 'Kill failed',
}

/**
 * The dictionary namespace this plugin owns in the DSH locale registry
 * (`'sidebar'` is taken by DSH's own ui-sidebar, hence this distinct name).
 */
export const LOCALE_NS = 'betterSidebar'

// The ja dictionary lives in a sibling file (326 keys) so this module
// stays readable. Type-checked against the zh key set: a missing or extra
// ja key is a compile error.
import { ja as jaDict } from './locales-ja.ts'
import { de as deDict } from './locales-de.ts'
import { fr as frDict } from './locales-fr.ts'
import { pt as ptDict } from './locales-pt.ts'
import { ko as koDict } from './locales-ko.ts'
import { ar as arDict } from './locales-ar.ts'
import { hi as hiDict } from './locales-hi.ts'
import { id as idDict } from './locales-id.ts'
import { tr as trDict } from './locales-tr.ts'
import { vi as viDict } from './locales-vi.ts'
import { th as thDict } from './locales-th.ts'
import { ru as ruDict } from './locales-ru.ts'
import { it as itDict } from './locales-it.ts'
import { nl as nlDict } from './locales-nl.ts'
import { sv as svDict } from './locales-sv.ts'
import { pl as plDict } from './locales-pl.ts'
import { zhHK as zhHKDict } from './locales-zh-HK.ts'
import { zhTW as zhTWDict } from './locales-zh-TW.ts'
import { zhMO as zhMODict } from './locales-zh-MO.ts'

/** The ja dictionary (key-set-equal to zh, enforced by the type annotation). */
export const ja: Record<keyof typeof zh, string> = jaDict as Record<keyof typeof zh, string>
export const de: Record<keyof typeof zh, string> = deDict as Record<keyof typeof zh, string>
export const fr: Record<keyof typeof zh, string> = frDict as Record<keyof typeof zh, string>
export const pt: Record<keyof typeof zh, string> = ptDict as Record<keyof typeof zh, string>
export const ko: Record<keyof typeof zh, string> = koDict as Record<keyof typeof zh, string>
export const ar: Record<keyof typeof zh, string> = arDict as Record<keyof typeof zh, string>
export const hi: Record<keyof typeof zh, string> = hiDict as Record<keyof typeof zh, string>
export const id: Record<keyof typeof zh, string> = idDict as Record<keyof typeof zh, string>
export const tr: Record<keyof typeof zh, string> = trDict as Record<keyof typeof zh, string>
export const vi: Record<keyof typeof zh, string> = viDict as Record<keyof typeof zh, string>
export const th: Record<keyof typeof zh, string> = thDict as Record<keyof typeof zh, string>
export const ru: Record<keyof typeof zh, string> = ruDict as Record<keyof typeof zh, string>
export const it: Record<keyof typeof zh, string> = itDict as Record<keyof typeof zh, string>
export const nl: Record<keyof typeof zh, string> = nlDict as Record<keyof typeof zh, string>
export const sv: Record<keyof typeof zh, string> = svDict as Record<keyof typeof zh, string>
export const pl: Record<keyof typeof zh, string> = plDict as Record<keyof typeof zh, string>
export const zhHK: Record<keyof typeof zh, string> = zhHKDict as Record<keyof typeof zh, string>
export const zhTW: Record<keyof typeof zh, string> = zhTWDict as Record<keyof typeof zh, string>
export const zhMO: Record<keyof typeof zh, string> = zhMODict as Record<keyof typeof zh, string>

/** The DSH locale service attached by the client apply (absent → browser detection). */
let localeService: { getSnapshot(): { active: string } } | undefined

/**
 * The better-locale override store attached by the client apply
 * (absent → no override; the zh/en chain runs). The store's `active`
 * field holds the user's chosen override id (e.g. `'ja'`); `undefined`
 * means "no override, use DSH native zh/en".
 *
 * The override only takes effect when DSH's active locale is `'en'`
 * (it borrows DSH's English slot to render a third language). While
 * DSH is on `'zh'` the override is inert — `getOverride` returns
 * `undefined` and `isOverrideActive` returns `false` — so `t()` and
 * `isZh()` fall through to the native zh/en chain unchanged.
 */
let betterLocaleStore: {
  readonly active: string | undefined
  getOverride(dshActive: string, ns: string, key: string): string | undefined
  isOverrideActive(dshActive: string): boolean
} | undefined

/**
 * Attach (or detach, with undefined) the DSH locale service. The sidebar
 * mounts its own React root outside the slot system's locale seat, so the
 * service rides this module-level holder: components keep calling the plain
 * `t()` function, and the Sidebar root's locale subscription re-renders the
 * whole tree on switches.
 */
export function attachLocale(service: { getSnapshot(): { active: string } } | undefined): void {
  localeService = service
}

/**
 * Attach (or detach, with undefined) the better-locale override store.
 * When attached with an active override, `t()` consults the store's
 * `getOverride(active, LOCALE_NS, key)` first; if it returns a string,
 * that text wins over the zh/en chain. Detaching (or the store's active
 * being `undefined`) restores the zh/en chain unchanged.
 *
 * The Sidebar root subscribes to the store separately (see Sidebar.tsx)
 * so an override change re-renders the whole tree — the locale service's
 * own revision bump (which better-locale triggers via `publish(active, true)`)
 * does NOT fire the existing `localeRevision` uSES because that snapshot
 * reads `getSnapshot().active` (unchanged) rather than `revision`.
 */
export function attachBetterLocale(store: typeof betterLocaleStore): void {
  betterLocaleStore = store
}

/**
 * The active locale id ('zh' | 'en'): the DSH locale service's snapshot when
 * attached, else the browser language.
 */
function activeLocale(): string {
  return localeService?.getSnapshot().active
    ?? (typeof navigator !== 'undefined' ? navigator.language : '')
    ?? 'en'
}

/** Translate a copy key in the active locale (zh → zh, else en). */
export type CopyKey = keyof typeof zh

/** Translate a copy key; `{name}` placeholders interpolate from `params`. */
export function t(key: CopyKey, params?: Record<string, string | number>): string {
  // 1. better-locale override (e.g. ja) wins when an override is active,
  //    DSH's active locale is 'en' (the override borrows the en slot),
  //    and the store has a translation for this (ns, key). The store's
  //    getOverride returns undefined otherwise (no override, DSH on zh,
  //    or missing key) and the zh/en chain runs.
  const dshActive = localeService?.getSnapshot().active ?? ''
  const override = betterLocaleStore?.getOverride(dshActive, LOCALE_NS, key)
  let text: string | undefined = override
  // 2. Fall back to the zh/en chain when no override matched.
  if (text === undefined) {
    const dict = activeLocale().toLowerCase().startsWith('zh') ? zh : en
    text = dict[key]
  }
  if (text === undefined) {
    // Key missing from every dict (should not happen — zh is the source of
    // truth and en/ja are checked against it). Return the key itself so the
    // UI shows something identifiable rather than `undefined`.
    text = key
  }
  if (params !== undefined) {
    for (const [name, value] of Object.entries(params)) {
      text = text.replaceAll(`{${name}}`, String(value))
    }
  }
  return text
}

/** Whether the active locale is Chinese (used for selectors). */
export function isZh(): boolean {
  // An override is only "effectively active" when DSH is on 'en' (the
  // override borrows the en slot). While DSH is on 'zh' the override is
  // inert — the user sees native zh, so isZh() returns true. When an
  // override is effectively active, the rendered text is neither zh nor
  // en (it's ja/ko/...), so isZh() returns false to route selectors to
  // the non-zh branch (e.g. date format, pluralization).
  const dshActive = localeService?.getSnapshot().active ?? ''
  if (betterLocaleStore?.isOverrideActive(dshActive) === true) return false
  return activeLocale().toLowerCase().startsWith('zh')
}
