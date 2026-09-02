# dsh-toonflow 插件实施计划

> DeepSeek Harness 的 AI 短剧导演插件。**UI 先行，分层接通，每个阶段交付可验证的界面。**

## 1. 开发哲学：UI-First, Outside-In

```
Phase 1  →  UI 空壳 + Mock 数据        →  你验证布局和交互
Phase 2  →  接通数据层（读写 JSON）      →  你验证数据正确展示
Phase 3  →  接通生成按钮（调用 comfyui） →  你验证单镜头生成闭环
Phase 4  →  接通批量 + 导出             →  你验证完整短剧流程
Phase 5  →  接通 Agent 工具             →  技术用户可用对话驱动
```

你在任何阶段说「停」，我就停下来改 UI，不继续往下接功能。

## 2. 定位

dsh-toonflow 是一个 **可视化操作台 + 编排层** 插件：

- Cordis 插件，注册到 DeepSeek Harness；
- 通过 dsh-better-sidebar 的 `registerTab` API 提供侧边栏 Tab；
- **目标用户是运营人员**：项目卡片、角色头像、分镜网格、状态徽标、一键按钮；
- 生成能力委托给 dsh-comfyui，自身只管状态与资产。

| 来源 | 提取 | 不提取 |
|---|---|---|
| Toonflow-app | 流水线：剧本→角色→衍生资产→分镜→视频；状态机（未生成→生成中→已完成/失败）；批量并发控制（concurrentCount）；参考图 Base64 传递；技能文件驱动 Agent | Electron；SQLite；三层 Agent；无限画布；向量记忆；供应商管理 |
| dsh-comfyui | `__ModuleLoader__.load` 客户端注册；`fetchJson(API + path)` 通信模式；`ctx.webServer.register({ kind: 'prefix' })` 路由注册；cordis.patch.yml 声明 | HTTP 客户端；工作流扫描（直接复用） |
| DSH-better-sidebar | `registerTab` API；CSS Modules + `--dsw-alias-*` 主题令牌；`clsx` 条件类名；`useState`+`useRef`+`useEffect` 轮询模式；`tab.meta` 持久化状态；`@deepseek-ai/dsh-client-ui-primitives` 组件库 | 文件管理器；终端；Git 集成 |

## 3. 系统边界

```
运营人员 ←→ Toonflow 侧边栏 Tab（React）
                ↕ /toonflow/api/*
dsh-toonflow Host（状态、资产、校验、FFmpeg）
                ↕
dsh-comfyui（工作流合同、提交、轮询、输出）
                ↕
ComfyUI（GPU 推理）
```

## 4. 插件注册（参照 dsh-comfyui 实现）

### 4.1 package.json

```json
{
  "name": "@dsh-external/dsh-toonflow",
  "version": "0.1.0",
  "type": "module",
  "exports": {
    ".": "./lib/index.js",
    "./client": "./lib/client.js",
    "./package.json": "./package.json"
  },
  "peerDependencies": {
    "cordis": "^4",
    "@deepseek-ai/dsh-tools": "*",
    "schemastery": "^3.18"
  },
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": {
      "inject": [
        "@deepseek-ai/dsh-client-runtime",
        "@deepseek-ai/dsh-client-ui-slots",
        "dsh-better-sidebar"
      ],
      "platform": "web"
    }
  }
}
```

### 4.2 cordis.patch.yml

```yaml
- insert:
    - id: dsh-toonflow
      name: '@dsh-external/dsh-toonflow'
      config:
        workspace: './toonflow-workspace'
```

### 4.3 Host 入口（lib/index.js）

参照 dsh-comfyui 的 `attachSettingsApi` 模式：

```javascript
import { url } from 'node:url'

export const name = 'dsh-toonflow'
export const inject = ['webServer']

export function apply(ctx, config) {
  // 注册 HTTP API（参照 dsh-comfyui 的 prefix 路由）
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: '/toonflow/api',
    handler: async (req, res) => {
      const sub = url.pathname.replace(/^\/toonflow\/api/, '') || '/'
      // 路由分发...
    }
  }))

  // 注册静态文件路由（参照 sidebar 的 /sidebar/file 媒体路由）
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: '/toonflow/file',
    handler: async (req, res) => { /* 返回图片/视频文件 */ }
  }))

  // Phase 5: 注册 Agent 工具
  // ctx.effect(() => defineTool(ctx, 'toonflow_project', ...))
}
```

### 4.4 Client 入口（lib/client.js）

参照 dsh-comfyui 的 `__ModuleLoader__.load` 模式 + better-sidebar 的 `registerTab`：

```javascript
window.__ModuleLoader__.load({
  id: '@dsh-external/dsh-toonflow',
  factory: (require) => {
    const React = require('react')
    const { createElement: h, useState, useEffect, useRef, useCallback } = React

    const inject = ['betterSidebar']

    function apply(ctx) {
      ctx.effect(() =>
        ctx.betterSidebar.registerTab({
          id: 'toonflow',
          title: 'Toonflow',
          icon: (size) => h(ToonflowIcon, { size }),
          order: 60,
          single: true,
          component: (props) => h(ToonflowApp, props),
        })
      )
    }

    return { inject, apply }
  }
})
```

## 5. 客户端实现模式（参照 better-sidebar 源码）

### 5.1 数据通信

参照 dsh-comfyui 的 `fetchJson` 封装：

```javascript
const API = '/toonflow/api'

function fetchJson(path, init) {
  return fetch(API + path, {
    headers: { 'content-type': 'application/json' },
    ...init,
  }).then(async (r) => {
    const d = await r.json().catch(() => ({}))
    if (!r.ok || d.ok === false) throw new Error(d.error || ('HTTP ' + r.status))
    return d
  })
}

// 用法
const projects = await fetchJson('/project.list')
const plan = await fetchJson('/plan.get', {
  method: 'POST',
  body: JSON.stringify({ projectId: 'demo-001' })
})
```

### 5.2 状态轮询

参照 better-sidebar ChangesTab 的轮询模式（2.5s 间隔）：

```javascript
function usePolling(visible, projectId, interval = 2500) {
  const [shots, setShots] = useState([])
  const pull = useCallback(async () => {
    if (!projectId) return
    const data = await fetchJson('/shot.batch_status', {
      method: 'POST',
      body: JSON.stringify({ projectId })
    })
    setShots(data.shots)
  }, [projectId])

  useEffect(() => {
    void pull()
    if (!visible) return                              // 不可见时停止轮询
    const timer = window.setInterval(() => void pull(), interval)
    return () => window.clearInterval(timer)
  }, [visible, pull, interval])

  return shots
}
```

### 5.3 样式方案

参照 better-sidebar 的 CSS Modules + 主题令牌：

```css
/* toonflow.module.css */
.projectCard {
  padding: 12px;
  border-radius: 8px;
  background: var(--dsw-alias-bg-surface-secondary);
  border: 1px solid var(--dsw-alias-border-default);
  cursor: pointer;
  transition: background var(--ds-motion-duration-fast) var(--ds-motion-easing-standard);
}
.projectCard:hover {
  background: var(--dsw-alias-bg-surface-tertiary);
}

.statusBadge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 10px;
  font-size: var(--dsw-font-size-xs);
}
.statusDraft     { background: var(--dsw-alias-bg-surface-tertiary); color: var(--dsw-alias-text-secondary); }
.statusReady     { background: #e3f2fd; color: #1565c0; }
.statusQueued    { background: #fff8e1; color: #f57f17; animation: pulse 1.5s infinite; }
.statusDone      { background: #e8f5e9; color: #2e7d32; }
.statusFailed    { background: #ffebee; color: #c62828; }

.thumbnail {
  width: 120px;
  height: 68px;
  border-radius: 4px;
  object-fit: cover;
  background: var(--dsw-alias-bg-surface-tertiary);
}
.thumbnailPlaceholder {
  composes: thumbnail;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--dsw-alias-text-placeholder);
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}
```

使用方式（参照 better-sidebar 的 `clsx` 模式）：

```javascript
import css from './toonflow.module.css'
import clsx from 'clsx'

const statusClass = {
  draft: css.statusDraft,
  prompt_ready: css.statusReady,
  image_queued: css.statusQueued,
  image_ready: css.statusReady,
  video_queued: css.statusQueued,
  video_ready: css.statusDone,
  failed: css.statusFailed,
}

function StatusBadge({ status }) {
  return h('span', { className: clsx(css.statusBadge, statusClass[status]) }, statusLabel[status])
}
```

### 5.4 组件模式

参照 better-sidebar 的 Card 模式（SideCardSection.tsx:804-853）：

```javascript
// 项目卡片
function ProjectCard({ project, onClick }) {
  return h('div', { className: css.projectCard, onClick },
    h('div', { className: css.cardTitle }, project.title),
    h(ProgressBar, { done: project.shotsDone, total: project.shotsTotal }),
    h('div', { className: css.cardMeta },
      `${project.characterCount} 角色 · ${project.sceneCount} 场景`
    ),
    h('div', { className: css.cardTime }, timeAgo(project.updatedAt))
  )
}

// 镜头行（核心组件）
function ShotRow({ shot, onAction }) {
  return h('div', { className: css.shotRow },
    h('div', { className: css.shotHeader },
      h('span', { className: css.shotOrder }, `#${shot.order}`),
      h('span', { className: css.shotDesc }, shot.description),
    ),
    h('div', { className: css.shotMedia },
      shot.imagePath
        ? h('img', { className: css.thumbnail, src: `/toonflow/file?path=${shot.imagePath}` })
        : h('div', { className: css.thumbnailPlaceholder }, '📷'),
      shot.videoPath
        ? h('video', { className: css.thumbnail, src: `/toonflow/file?path=${shot.videoPath}`, controls: true })
        : h('div', { className: css.thumbnailPlaceholder }, '🎬'),
    ),
    h('div', { className: css.shotFooter },
      h('span', { className: css.shotCharacters },
        shot.characterNames.join(', '), ' · ', shot.sceneName
      ),
      h(StatusBadge, { status: shot.status }),
      h(ShotActions, { shot, onAction }),
    ),
  )
}
```

### 5.5 上下文按钮（参照 Toonflow 的 compulsory 模式）

```javascript
function ShotActions({ shot, onAction }) {
  const buttons = []
  switch (shot.status) {
    case 'draft':
    case 'prompt_ready':
      buttons.push({ label: '生成首帧', action: 'generate_image' })
      break
    case 'image_queued':
    case 'video_queued':
      // 无按钮，StatusBadge 的 pulse 动画已表示进行中
      break
    case 'image_ready':
      buttons.push({ label: '生成视频', action: 'generate_video' })
      break
    case 'video_ready':
      // 已完成，无操作
      break
    case 'failed':
      if (shot.retryCount < 3) {
        buttons.push({ label: `重试 (${shot.retryCount}/3)`, action: 'retry' })
      }
      break
  }
  return h('div', { className: css.shotActions },
    ...buttons.map(b =>
      h('button', {
        className: css.actionBtn,
        onClick: () => onAction(shot.id, b.action)
      }, b.label)
    )
  )
}
```

### 5.6 页面导航

参照 better-sidebar 的 `tab.meta` 持久化模式：

```javascript
function ToonflowApp({ ctx, store, scope, tab, visible }) {
  // 路由状态持久化到 tab.meta（刷新不丢失）
  const meta = tab.meta || {}
  const [view, setView] = useState(meta.view || 'list')
  const [projectId, setProjectId] = useState(meta.projectId || null)

  const navigate = useCallback((nextView, nextProjectId) => {
    setView(nextView)
    setProjectId(nextProjectId)
    // 持久化（参照 better-sidebar ChangesTab 的 patchMeta 模式）
    ctx.get('betterSidebar')?.updateTab(tab.id, {
      meta: { ...meta, view: nextView, projectId: nextProjectId }
    })
  }, [ctx, tab.id, meta])

  switch (view) {
    case 'list':       return h(ProjectList, { visible, onSelect: id => navigate('dashboard', id) })
    case 'dashboard':  return h(Dashboard, { visible, projectId, navigate })
    case 'shots':      return h(ShotBoard, { visible, projectId, navigate })
    case 'shot':       return h(ShotDetail, { visible, projectId, shotId: meta.shotId, navigate })
    case 'export':     return h(ExportPanel, { visible, projectId, navigate })
  }
}
```

## 6. 核心流程（参照 Toonflow-app 实现）

### 6.1 状态机

参照 Toonflow 的三态模型（未生成→生成中→已完成/失败），扩展为分镜专用：

```
draft → prompt_ready → image_queued → image_ready → video_queued → video_ready
                                  ↘ failed ↙           ↘ failed ↙
```

状态中文映射（运营人员看到的）：

| 状态 | 显示 | 颜色 |
|---|---|---|
| draft | 草稿 | 灰 |
| prompt_ready | 就绪 | 蓝 |
| image_queued | 首帧生成中… | 黄 + pulse 动画 |
| image_ready | 首帧完成 | 黄绿 |
| video_queued | 视频生成中… | 黄 + pulse 动画 |
| video_ready | 完成 | 绿 |
| failed | 失败 | 红 |

### 6.2 单镜头生成流程

参照 Toonflow 的 `batchGenerateImage.ts` 异步模式：

```
运营点击「生成首帧」
  ↓
POST /toonflow/api/shot.generate_image { projectId, shotId }
  ↓
Host 端:
  1. 读取 shot 数据 + 关联角色参考图
  2. 将参考图路径传给 dsh-comfyui generate（I2I 模式）
  3. 更新 shot.status = 'image_queued'，写入 imageJobId
  4. 启动后台轮询 dsh-comfyui job 状态
  5. Job 完成 → 复制输出到 assets/shots/ → 更新 imagePath + status = 'image_ready'
  6. Job 失败 → 更新 status = 'failed' + lastError
  ↓
UI 端:
  usePolling 每 2.5s 拉取 shot.batch_status
  状态变化 → 重新渲染 StatusBadge + 缩略图
```

### 6.3 批量生成流程

参照 Toonflow 的 `concurrentCount` 并发控制：

```
运营点击「批量生成」
  ↓
POST /toonflow/api/shot.batch_generate { projectId }
  ↓
Host 端:
  1. 筛选所有 status = prompt_ready | draft 的镜头
  2. 按 order 排序
  3. 并发控制：最多同时 3 个 job（不像 Toonflow 的 5，因为视频生成更重）
  4. 每个镜头走单镜头流程
  5. 单个失败不阻塞其他镜头
  ↓
UI 端:
  Dashboard 进度条实时更新（done/total）
  ShotBoard 每行状态独立刷新
```

### 6.4 角色参考图生成

参照 Toonflow 的资产生成流程：

```
运营点击角色卡片上的「生成图」
  ↓
Host 端:
  1. 读取角色描述（character-bible 中的外貌关键词）
  2. 组装 T2I 提示词（画风前缀 + 角色描述 + 全身图约束）
  3. 调用 dsh-comfyui generate（T2I 模式）
  4. 完成后保存到 assets/characters/{charId}.png
  5. 更新 characters.json 中的 imagePath
  ↓
UI 端:
  角色卡片从占位图标变为缩略图头像
```

### 6.5 导出成片

```
运营点击「导出 MP4」
  ↓
Host 端:
  1. 收集所有 video_ready 镜头的 videoPath
  2. 按 order 排序
  3. 生成 FFmpeg concat 文件列表
  4. 执行 ffmpeg -f concat -safe 0 -i list.txt -c:v libx264 output.mp4
  5. 保存到 projects/{id}/output/final-{timestamp}.mp4
  ↓
UI 端:
  显示输出路径 + 「打开文件夹」按钮
```

## 7. 数据结构

### 7.1 项目目录

```
workspace/projects/<project-id>/
├── project.json
├── characters.json
├── scenes.json
├── shots.json
├── assets/
│   ├── characters/
│   ├── scenes/
│   └── shots/
└── output/
```

### 7.2 镜头结构

```json
{
  "id": "shot-001",
  "order": 1,
  "durationSec": 5,
  "characterIds": ["char-001"],
  "sceneId": "scene-001",
  "description": "女主推门进入昏暗房间",
  "camera": "中景，缓慢向前推进",
  "imagePrompt": "...",
  "videoPrompt": "...",
  "referenceImages": [],
  "imageJobId": null,
  "imagePath": null,
  "videoJobId": null,
  "videoPath": null,
  "status": "draft",
  "retryCount": 0,
  "lastError": null,
  "updatedAt": "2026-09-02T10:00:00Z"
}
```

### 7.3 写入规则

所有 JSON 写入：tmpfile + atomic rename。路径规范化 + 项目边界校验。每次写入更新 updatedAt。

## 8. Host HTTP API

```
POST /toonflow/api/project.list
POST /toonflow/api/project.get           { projectId }
POST /toonflow/api/project.create        { title, description? }
POST /toonflow/api/project.delete        { projectId }

POST /toonflow/api/plan.get              { projectId }
POST /toonflow/api/plan.update_shot      { projectId, shotId, updates }

POST /toonflow/api/shot.batch_status     { projectId }
POST /toonflow/api/shot.generate_image   { projectId, shotId }
POST /toonflow/api/shot.generate_video   { projectId, shotId }
POST /toonflow/api/shot.retry            { projectId, shotId }
POST /toonflow/api/shot.batch_generate   { projectId, concurrentCount? }

POST /toonflow/api/char.generate_image   { projectId, characterId }

POST /toonflow/api/asset.register        { projectId, assetType, entityId, path }

POST /toonflow/api/export.preview        { projectId }
POST /toonflow/api/export.run            { projectId, resolution?, fps? }

GET  /toonflow/file?project=...&path=... → 图片/视频二进制
```

Host 路由注册方式（参照 dsh-comfyui lib/index.js:69-120）：

```javascript
ctx.effect(() => ctx.webServer.register({
  kind: 'prefix',
  path: '/toonflow/api',
  handler: async (req, res) => {
    const sub = new URL(req.url, 'http://localhost').pathname.replace(/^\/toonflow\/api/, '')
    try {
      switch (sub) {
        case '/project.list': return sendJson(res, 200, await projectList(config))
        case '/project.get':  return sendJson(res, 200, await projectGet(config, await readBody(req)))
        // ...
      }
    } catch (e) {
      return sendJson(res, 500, { ok: false, error: e.message })
    }
  }
}))

function sendJson(res, code, obj) {
  res.writeHead(code, { 'content-type': 'application/json' })
  res.end(JSON.stringify(obj))
}
```

## 9. UI 页面设计

### 9.1 页面 A：项目列表

```
┌────────────────────────────────┐
│  Toonflow               [+ 新建] │
├────────────────────────────────┤
│  ┌──────────────────────────┐  │
│  │  月光下的告别              │  │
│  │  ████████░░  4/6 完成     │  │
│  │  2 角色 · 3 场景 · 5 分钟前 │  │
│  └──────────────────────────┘  │
│  ┌──────────────────────────┐  │
│  │  星际逃亡                 │  │
│  │  ░░░░░░░░░░  0/8 完成     │  │
│  │  3 角色 · 2 场景 · 2 小时前 │  │
│  └──────────────────────────┘  │
└────────────────────────────────┘
```

### 9.2 页面 B：项目仪表盘

```
┌────────────────────────────────┐
│  ← 月光下的告别                  │
├────────────────────────────────┤
│  角色 (2)                       │
│  ┌─────┐  ┌─────┐              │
│  │ 头像 │  │ 头像 │              │
│  │ 林风 │  │ 苏雨 │              │
│  │[生成图]│  │ ✅  │              │
│  └─────┘  └─────┘              │
│                                │
│  场景 (3)                       │
│  ┌────┐ ┌────┐ ┌────┐          │
│  │街道│ │卧室│ │公园│           │
│  └────┘ └────┘ └────┘          │
│                                │
│  分镜 (6)          [进入分镜→]   │
│  ┌──┐┌──┐┌──┐┌──┐┌──┐┌──┐     │
│  │✅││✅││⏳││❌││○ ││○ │     │
│  │1 ││2 ││3 ││4 ││5 ││6 │     │
│  └──┘└──┘└──┘└──┘└──┘└──┘     │
│                                │
│  [▶ 批量生成]     [📦 导出 MP4] │
└────────────────────────────────┘
```

### 9.3 页面 C：分镜面板（核心）

```
┌────────────────────────────────┐
│  ← 分镜              [▶ 全部生成] │
├────────────────────────────────┤
│  #1 女主推门进入昏暗房间          │
│  ┌────────┐ ┌────────┐         │
│  │ [首帧]  │ │ [视频] ▶│         │
│  └────────┘ └────────┘         │
│  苏雨 · 卧室          ✅ 完成   │
│────────────────────────────────│
│  #2 男主在窗前点燃一支烟          │
│  ┌────────┐ ┌─ ─ ─ ─ ┐        │
│  │ [首帧]  │   待生成           │
│  └────────┘ └─ ─ ─ ─ ┘        │
│  林风 · 卧室       🟡 首帧完成   │
│                   [▶ 生成视频]  │
│────────────────────────────────│
│  #3 两人在走廊对视               │
│  ┌─ ─ ─ ─ ┐                   │
│    占位图                       │
│  └─ ─ ─ ─ ┘                   │
│  林风, 苏雨 · 走廊               │
│  ❌ 失败: ComfyUI 超时          │
│  重试 1/3         [🔄 重试]    │
│────────────────────────────────│
│  #4 苏雨转身离去                 │
│  ○ 草稿           [▶ 生成首帧]  │
└────────────────────────────────┘
```

### 9.4 页面 D：镜头详情

```
┌────────────────────────────────┐
│  ← #2 男主在窗前点燃一支烟        │
├───────────────┬────────────────┤
│  ┌──────────┐ │  描述           │
│  │  首帧大图  │ │  男主在窗前…    │
│  │          │ │  [编辑]         │
│  └──────────┘ │                │
│  ┌──────────┐ │  镜头运动       │
│  │  视频     │ │  特写，缓慢拉远 │
│  │  播放器   │ │  [编辑]         │
│  │    ▶     │ │                │
│  └──────────┘ │  图片提示词     │
│               │  masterpiece.. │
│               │  [编辑]         │
│               │                │
│               │  视频提示词     │
│               │  camera slow.. │
│               │  [编辑]         │
├───────────────┴────────────────┤
│  🟡 首帧完成  Job: comfy-a1b2  │
│  [▶ 生成视频]  [🔄 重新生成首帧] │
└────────────────────────────────┘
```

### 9.5 页面 E：导出面板

```
┌────────────────────────────────┐
│  ← 导出                        │
├────────────────────────────────┤
│  ☑ #1 女主推门    5s   ✅      │
│  ☑ #2 男主点烟    4s   ✅      │
│  ☐ #3 走廊对视    --   ❌      │
│  ☐ #4 苏雨离去    --   ○       │
│                                │
│  可导出: 2 镜头 · 预计 9 秒     │
│  1280×720 · 24fps              │
│                                │
│  [📦 导出 MP4]                 │
│                                │
│  历史: final-0902.mp4  [📂打开] │
└────────────────────────────────┘
```

## 10. 分阶段实施

### Phase 1：UI 空壳（Mock 数据）

**交付**：完整的 5 个页面，硬编码 Mock 数据，所有导航可点击。

**文件清单**：
```
dsh-toonflow/
├── package.json                    # 含 dsh.client 声明
├── cordis.patch.yml                # 插件注册
├── lib/
│   ├── index.js                    # Host 空壳（只注册 /toonflow/file 路由）
│   └── client.js                   # __ModuleLoader__.load + registerTab
├── src/client/
│   ├── mock-data.js                # 2 项目, 3 角色, 2 场景, 6 镜头(覆盖全部 7 状态)
│   ├── toonflow.module.css         # CSS Modules + --dsw-alias 令牌
│   ├── ToonflowApp.js              # 路由 + tab.meta 持久化
│   ├── views/
│   │   ├── ProjectList.js
│   │   ├── Dashboard.js
│   │   ├── ShotBoard.js
│   │   ├── ShotDetail.js
│   │   └── ExportPanel.js
│   └── components/
│       ├── StatusBadge.js
│       ├── ProgressBar.js
│       ├── ProjectCard.js
│       ├── CharacterCard.js
│       ├── ShotRow.js
│       ├── ActionButton.js         # disabled + tooltip「即将支持」
│       ├── Breadcrumb.js
│       └── EmptyState.js
└── README.md
```

**按钮状态**：
- ✅ 可用：页面导航、面包屑返回、卡片点击
- 🔒 禁用：所有生成/导出按钮（hover 显示「即将支持」）
- 🔒 禁用：编辑按钮（Phase 2 接通）

**验收 checklist**：
- [ ] 侧边栏出现 Toonflow 标签页
- [ ] 项目列表渲染 2 个 Mock 项目卡片（含进度条）
- [ ] 点击卡片进入仪表盘，角色/场景/分镜缩略图正确显示
- [ ] 仪表盘点「进入分镜」→ ShotBoard，6 个镜头行覆盖所有状态
- [ ] 状态徽标颜色+中文标签正确（草稿/就绪/生成中/完成/失败）
- [ ] 生成中状态有 pulse 动画
- [ ] 失败镜头显示错误原因
- [ ] 点击镜头进入详情页，左右分栏布局
- [ ] 导出页正确区分可导出/不可导出镜头
- [ ] 所有禁用按钮 hover 有 tooltip
- [ ] 整体风格与 DSH 暗色/亮色主题一致（使用 --dsw-alias 令牌）
- [ ] 刷新页面后当前位置不丢失（tab.meta 持久化）

---

### Phase 2：接通数据层

**新增/修改**：
```
lib/
├── index.js                    # 添加 API 路由
└── lib/
    ├── project.js              # 项目 CRUD
    ├── store.js                # 原子 JSON 读写
    └── schema.js               # 校验
src/client/
├── api.js                      # fetchJson 封装（替换 mock-data）
└── hooks/useProject.js         # 数据加载 hook
```

**接通的 API**：project.list / project.get / project.create / plan.get / plan.update_shot

**新启用按钮**：
- ✅「+ 新建」→ 创建空项目
- ✅ 镜头详情「编辑」→ 修改提示词并保存
- ✅ 缩略图 → 从 /toonflow/file 真实加载

**验收 checklist**：
- [ ] 创建新项目 → 项目列表新增卡片
- [ ] 手动放一张图到 assets/characters/ → 角色卡片显示缩略图
- [ ] 编辑镜头提示词 → 刷新后数据持久化
- [ ] 删除项目 → 列表更新

---

### Phase 3：接通单镜头生成

**前置**：dsh-comfyui 已验证可用。

**新增**：
```
lib/lib/
├── generate.js                 # dsh-comfyui 调用桥接
└── assets.js                   # 资产注册
src/client/
└── hooks/usePolling.js         # 2.5s 状态轮询
```

**接通的 API**：shot.generate_image / shot.generate_video / shot.retry / char.generate_image

**新启用按钮**：
- ✅「生成角色图」
- ✅「生成首帧」
- ✅「生成视频」
- ✅「重试」

**验收 checklist**：
- [ ] 点击「生成首帧」→ 徽标变「生成中…」+ pulse → 自动变「首帧完成」→ 缩略图出现
- [ ] 点击「生成视频」→ 同上 → 视频可播放
- [ ] 失败 → 显示原因 + 「重试」可用
- [ ] 刷新页面 → 状态不丢失

---

### Phase 4：接通批量 + 导出

**新增**：
```
lib/lib/
├── export.js                   # FFmpeg 拼接
```

**接通的 API**：shot.batch_generate / export.preview / export.run

**新启用按钮**：
- ✅「批量生成」
- ✅「导出 MP4」
- ✅「打开文件夹」

**验收 checklist**：
- [ ] 点击「批量生成」→ 所有就绪镜头依次生成 → 进度条实时更新
- [ ] 单个失败不阻塞其他
- [ ] 导出 MP4 → 文件可播放
- [ ] 全程不需要任何命令行或 JSON 操作

---

### Phase 5：接通 Agent 工具

**新增**：
```
lib/lib/
├── tools.js                    # 5 个 Agent 工具定义
skills/
├── screenplay.md
├── character-bible.md
├── storyboard.md
└── visual-prompt.md
```

**验收 checklist**：
- [ ] 对话中输入剧情 → Agent 创建项目 + 计划
- [ ] 切到侧边栏 → 数据已在
- [ ] Agent 触发生成 → UI 状态实时变化

## 11. 技能文件（Phase 5）

参照 Toonflow 的 `production_execution_storyboard_panel.md` 等技能文件结构：

| 文件 | 对应 Toonflow 技能 | 用途 |
|---|---|---|
| screenplay.md | scriptAgent 系列 | 输入剧情→输出角色/场景/分镜结构 |
| character-bible.md | production_execution_derive_assets.md | 角色外貌规范（发型/发色/瞳色/服装） |
| storyboard.md | production_execution_storyboard_panel.md | 分镜设计（构图/运镜/站位） |
| visual-prompt.md | 无直接对应 | 提示词写作规范（画风前缀 + 角色关键词） |

## 12. MVP 验收标准

Phase 4 完成后全部满足：

1. 运营打开侧边栏 → 项目列表 → 角色和分镜
2. 点按钮生成角色参考图
3. 点按钮生成分镜首帧和视频
4. 失败 → 看到原因 → 点重试
5. 导出 MP4 → 可播放
6. 刷新/重启 → 状态保持
7. **全程不需要命令行、JSON 或提示词知识**

## 13. 明确不做

Electron · 无限画布 · 登录/权限 · SQLite · 供应商管理 · 向量记忆 · 三层 Agent · 事件图谱 · 素材库 · 多语言 · 云端 · 多视频模型 · 转场/BGM/字幕/TTS · 时间线编辑器

## 14. 停止条件

- 无法导入或执行任何 I2V 工作流（Phase 3 阻塞）
- 角色参考图在 3 个镜头中无法保持身份一致
- ComfyUI 输出无法稳定保存为本地路径
- 单个 5 秒镜头成本不可接受
