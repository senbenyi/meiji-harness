# AI 代码审查报告 — dsh-elysium

> 审查范围：`dsh-elysium/src/` 全部 ~40 个源文件
> 基线：`runpod` 分支 `f5abbe9`
> 日期：2026-09-14

---

## 一、入口 · 调用链 · 数据流

### 1.1 入口

| 入口 | 文件 | 触发方 |
|------|------|--------|
| 插件注册 | `index.js:18` `apply(ctx, config)` | Cordis 框架加载 |
| 视频生成工具 | `tools/video.js:15` `workflow_generate_video` | AI agent 调用 |
| 视频恢复工具 | `tools/video.js:42` `workflow_resume_video` | AI agent 调用 |
| 任务状态查询 | `tools/model-jobs.js:6` `model_job_status` | AI agent 调用 |
| 任务结果查询 | `tools/model-jobs.js:28` `model_job_result` | AI agent 调用 |
| 工具发现 | `tools/discovery.js:56` `elysium_load_tools` | AI agent 调用 |
| 项目 CRUD HTTP | `http/project-routes.js:8` `PROJECT_ROUTE` | Web 前端 |
| 导演 CRUD HTTP | `http/director-routes.js:7` `DIRECTOR_ROUTE` | Web 前端 |
| 媒体代理 HTTP | `http/media-routes.js:12` `MEDIA_ROUTE` | Web 前端 |

### 1.2 视频生成主链路

```
workflow_generate_video(args, exec)                  # tools/video.js:32
  └─ startVideoJob(args, exec)                       # video/service.js:25
      └─ withVideoSessionLock(exec, ...)             # 会话级串行化
          └─ startVideoJobLocked(args, exec)
              ├─ validateVideoPlan(plan)              # video/plan.js:17
              ├─ findVideoCall → getJob (复用逻辑)    # video/call-binding.js + jobs/query.js
              ├─ createJob(projectId, plan)           # jobs/create.js
              ├─ bindVideoCall(jobId, exec)           # video/call-binding.js
              └─ launch(jobId)                        # video/launcher.js:15
                  └─ withLaunchLock(directory, ...)   # jobs/lock.js:35
                      └─ launchLocked(...)
                          ├─ open(worker.lock, 'wx')  # 独占创建
                          ├─ spawn(worker.js)          # 分离子进程
                          └─ lock.writeFile(pid)
  └─ waitJob(job, signal)                            # jobs/wait.js → getJob 轮询

worker.js (独立进程)                                  # video/worker.js
  └─ executeComfyVideo(projectId, jobId, plan)       # video/execution.js:15
      ├─ prepareComfyWorkflow                        # comfyui/execution.js:6
      │   ├─ buildVideoGraph → buildProfileGraph     # video/graph.js + video/profile.js
      │   └─ client.validate(graph)                  # comfyui/client.js:43
      ├─ runComfyWorkflow                            # comfyui/execution.js:21
      │   ├─ submitComfyPrompt                       # comfyui/submission.js:4
      │   └─ client.wait(promptId, timeoutMs)        # comfyui/client.js:88
      ├─ collectVideoArtifacts                       # video/artifacts.js
      └─ 失败 → 最多 5 次指数退避重试
```

### 1.3 数据流

```
输入:  args(prompt/mode/profile/media_url) → request.json (持久化)
状态:  status.json (queued → running → prepare/submit/execute → succeeded/failed)
提交:  comfyui-submission.json (submitting → prompt_id → 归档失败)
图:    comfyui-workflow.json (恢复时复用已保存的图，不重建)
产物:  comfyui-history.json → artifacts → comfyui_view_url / local_media_path
索引:  sessions/{hash}/calls/{callHash} → jobId (call-binding)
项目:  projects/{id}/project.json + anchors.json + storyboard.json + deliverables.json + materials.json
```

---

## 二、按方向审查

### 方向 1：架构与模块分层

**结论：无严重问题。**

分层为 `index.js` 入口 → `tools/` 工具适配 → `video/` 业务逻辑 → `comfyui/` 后端客户端 → `jobs/` 通用任务基础设施 → `projects/` 项目持久化 → `http/` HTTP 路由。

无跨层调用或循环依赖。唯一需注意的是 `jobs/query.js:2` 依赖 `video/worker-owner.js`，从通用层引用特化层，但这是有意为之——job 存活检测需要 worker 身份验证能力。

### 方向 2：业务流程完整性

**结论：主链路完整；1 项边界缺失。**

| # | 位置 | 问题证据 | 触发条件 | 实际影响 | 修复建议 |
|---|------|---------|---------|---------|---------|
| F-1 | `video/service.js:69-70` | `resumeVideoJobLocked` 在 `job.status === 'failed' && job.backend === 'comfyui'` 时传 `retryFailed=true`，其他失败状态直接调用 `launch(jobId)` 但 `retryFailed=false` | 任务失败但 `backend` 字段缺失或非 `comfyui` | `submission.js` 不会归档失败提交，可能复用已有 `prompt_id` 而非重新提交 | 当前仅有 comfyui 一种 backend，实际不触发。若未来新增 backend，需补充分支。可接受。 |

### 方向 3：业务规则正确性

**结论：规则实现正确；1 项可观察。**

| # | 位置 | 问题证据 | 触发条件 | 实际影响 | 修复建议 |
|---|------|---------|---------|---------|---------|
| F-2 | `video/profile.js:16` | 帧数对齐公式 `frames = requestedFrames + (5 - requestedFrames % 17 + 17) % 17` 使 `requestedFrames % 17 === 5` 时不加帧 | `duration_seconds` 恰好算出 `requestedFrames % 17 === 5` | 无错误，这是数学正确的——目标是 `frames % 17 === 5`，已满足时不需调整 | 无需修复 |
| F-3 | `video/plan.js:23` | `preview` 和 `regular` 仅允许 `t2va`/`i2va` 模式 | 用户尝试 `preview` + `fl2va` | 返回 422 错误，符合预期 | 无需修复 |

### 方向 4：模块边界与耦合

**结论：无严重问题；1 项设计权衡。**

| # | 位置 | 问题证据 | 触发条件 | 实际影响 | 修复建议 |
|---|------|---------|---------|---------|---------|
| F-4 | `projects/store.js:26` | `createProjectStore` 通过参数注入 `readJob`、`newId`、`directorExists`，解耦良好 | — | 正面发现：依赖注入使测试可替换 | — |
| F-5 | `jobs/query.js:2` | 通用 `jobs/` 层 import `video/worker-owner.js` | 新增非 video 类型的 job | 所有 job 的存活检测都走 video worker 逻辑 | 可接受：当前仅有 video 类型 job。若新增类型，需抽象 `workerAlive` 接口 |

### 方向 5：接口与契约

**结论：1 项实际问题。**

| # | 位置 | 问题证据 | 触发条件 | 实际影响 | 修复建议 |
|---|------|---------|---------|---------|---------|
| F-6 | `http/project-routes.js:29` | `store.change('create', body)` 返回 201，但 `store.change('import', body)` 也返回 200 | import 动作成功 | import 在语义上是在项目中新增锚点素材，返回 200 合理（update 语义） | 可接受 |
| F-7 | `tools/model-jobs.js:24` | `model_job_status` 的 `execute` 调用 `getJob(args.job_id, exec?.signal)` 但 `getJob` 函数签名只接受一个参数 `(jobId)` | 每次调用 | 第二个参数 `exec?.signal` 被静默忽略；`getJob` 内部不支持 abort signal | 将 signal 传入 `getJob` 以支持取消，或移除多余参数避免误导 |

### 方向 6：数据模型与约束

**结论：无严重问题。**

| # | 位置 | 问题证据 | 触发条件 | 实际影响 | 修复建议 |
|---|------|---------|---------|---------|---------|
| F-8 | `projects/schema.js:4` 和 `jobs/paths.js:6` | `validProjectId` 定义了两次：schema 版 `typeof id === 'string' && /^[a-f0-9]{8}$/` vs paths 版 `/^[a-f0-9]{8}$/.test(value || '')` | paths 版传入 `null` 返回 `false`（因 `|| ''`），schema 版传入 `null` 也返回 `false`（因 `typeof` 检查） | 行为一致，但 null 安全机制不同 | 可接受：有意隔离——schema 做类型层校验，paths 做宽松防御 |

### 方向 8：并发与线程安全

**结论：无严重问题；锁设计严谨。**

| # | 位置 | 问题证据 | 触发条件 | 实际影响 | 修复建议 |
|---|------|---------|---------|---------|---------|
| F-9 | `jobs/lock.js:12-33` | `acquireLaunchLock` 使用 `mkdir` 原子创建 + `owner` 文件记录 `pid:uuid` | 多进程同时启动任务 | 正确：mkdir 是原子操作；stale lock 通过 rename 回收避免 TOCTOU | 无需修复 |
| F-10 | `video/launcher.js:28-35` | `worker.lock` 使用 `open('wx')` 独占创建，EEXIST 时检查 `workerAlive` | 并发 launch 请求 | 正确：`worker.lock` 操作在 `withLaunchLock` 保护内，同一时刻只有一个进程操作 | 无需修复 |
| F-11 | `projects/store.js:65-68` | promise chain 串行化 `enqueue(action)` + `operations.catch(() => {})` | 多个并发项目变更请求 | 正确：`.catch(() => {})` 只维护内部链连续性，调用者通过 `operation` 变量接收错误 | 无需修复 |
| F-12 | `video/service.js:18-23` | `withVideoSessionLock` 对同一 session 的操作串行化 | 同 session 并发视频生成 | 正确：防止同 session 内并发提交 | 无需修复 |

### 方向 12：性能与容量

**结论：2 项需关注。**

| # | 位置 | 问题证据 | 触发条件 | 实际影响 | 修复建议 |
|---|------|---------|---------|---------|---------|
| F-13 | `jobs/paths.js:17-27` | `findJobRoot` 线性扫描所有项目目录 `readdir(projects)` → 逐项 `access(directory)` | 项目数量增长到数百或数千 | 每次 `getJob` → `findJobRoot` 都要遍历所有项目目录，O(N) 磁盘 IO。在 `client.wait` 轮询中每 2 秒调用一次 `getJob`，但此时 `findJobRoot` 用于检测 worker 存活的路径，而 `worker.js` 直接使用 `projectJobRoot` 不走 `findJobRoot` | 当项目数 <100 时无影响（本地工具场景）。若规模增长，可加内存缓存或 jobId→projectId 索引文件 |
| F-14 | `assets/catalog.js:36-55` | `listAssets` 遍历所有项目的所有 job 目录，逐个 `readFile(status.json)` + `stat` + `availableJobSummary`（含 `openLocalMedia`） | 素材列表请求 + 大量历史任务 | 每次 list 请求执行 O(projects × jobs) 次文件读取，无缓存。`availableJobSummary` 为每个成功任务打开文件句柄验证 | 短期可接受（本地工具，数据量小）。长期建议维护索引文件或 SQLite |

### 方向 13：资源与生命周期

**结论：1 项实际问题。**

| # | 位置 | 问题证据 | 触发条件 | 实际影响 | 修复建议 |
|---|------|---------|---------|---------|---------|
| F-15 | `http/media-routes.js:62` | `pipeline(media.handle.createReadStream({ autoClose: false, ... }), res)` 使用 `autoClose: false` | 正常流式传输 | 正确：`finally { await media.handle.close() }` 在 :64 行确保关闭。`autoClose: false` 避免 stream 和 finally 竞争关闭 | 无需修复 |
| F-16 | `video/execution.js:15` | `timeoutMs = 451 * 60_000`（约 7.5 小时），`tools/video.js:10` `timeoutMs + 60_000` | 极端慢任务 | 超时设计合理：worker 内部 451 分钟，工具层额外 1 分钟余量 | 无需修复 |
| F-17 | `http/media-routes.js:71` | 上游 fetch 使用 `AbortSignal.timeout(120_000)` | 上游 ComfyUI 响应慢 | 120 秒超时合理 | 无需修复 |
| F-18 | `comfyui/client.js:43-57` | `validate()` 中 4 通道并行请求 `object_info`，`failure` 变量用于快速失败 | 节点类型请求失败 | 正确：第一个失败后设置 `failure`，其余通道检测到后退出循环。但 `failure ||= error` 可能丢弃后续更有价值的错误 | 可接受：第一个失败即可代表问题 |
| F-19 | `video/worker.js:24` | `finally { await unlink(worker.lock).catch(() => {}) }` | worker 进程被 kill 或正常退出 | 正确：SIGTERM/SIGINT 先 abort controller，finally 清理 lock。但 SIGKILL 无法捕获，lock 文件残留 | 正确处理：`workerAlive` 检测 PID 存活状态，dead worker 的 lock 会被回收 |

### 方向 14：依赖容错

**结论：设计良好；1 项边界需注意。**

| # | 位置 | 问题证据 | 触发条件 | 实际影响 | 修复建议 |
|---|------|---------|---------|---------|---------|
| F-20 | `video/execution.js:44-50` | 瞬态错误重试：`TimeoutError`、`fetch failed`、HTTP 408/429/502/503/504，指数退避 2s→4s→8s→16s→30s | ComfyUI 暂时不可达 | 正确：最多 5 次重试，backoff 上限 30 秒，支持 signal 取消 | 无需修复 |
| F-21 | `comfyui/submission.js:15-22` | 丢失 POST 恢复：扫描 queue + history 寻找 `elysium_job_id` 匹配 | POST 响应丢失 | 正确：找到则复用 `prompt_id`，找不到抛错禁止自动重提 | 无需修复 |
| F-22 | `comfyui/submission.js:21` | `prompts.find(item => item?.[3]?.elysium_job_id === jobId)` 搜索 queue_running + queue_pending + 全部 history | ComfyUI history 非常大时 | `client.request('history')` 拉取全部历史记录。如果 ComfyUI 运行了数千个任务，这个响应可能很大 | 可接受：恢复路径低频调用。极端情况下 ComfyUI 自身会清理 history |
| F-23 | `comfyui/client.js:100-106` | 3 轮 poll 确认 prompt 不在 queue 和 history 后才报 `COMFYUI_TASK_NOT_FOUND` | ComfyUI 重启导致历史丢失 | 正确：避免单次 snapshot 差异导致误判。报错后禁止自动重提 | 无需修复 |

### 方向 15：缓存正确性

**结论：无严重问题。**

项目不使用独立缓存层。关键「缓存」行为：

| # | 位置 | 问题证据 | 触发条件 | 实际影响 | 修复建议 |
|---|------|---------|---------|---------|---------|
| F-24 | `comfyui/execution.js:8-13` | `prepareComfyWorkflow` 缓存已准备的 workflow 到 `comfyui-workflow.json`，恢复时直接读取 | 恢复已失败的任务 | 正确：`JSON.stringify(prepared.plan) !== JSON.stringify(plan)` 校验一致性，不一致则拒绝 | 无需修复 |
| F-25 | `http/media-routes.js:55,73` | `Cache-Control: no-store` 用于所有媒体响应 | 浏览器缓存 | 正确：避免凭据过期后缓存仍可访问 | 无需修复 |

### 方向 16：可观测性

**结论：2 项需关注。**

| # | 位置 | 问题证据 | 触发条件 | 实际影响 | 修复建议 |
|---|------|---------|---------|---------|---------|
| F-26 | 全局 | 日志输出仅 `index.js:45` `ctx.logger?.info` 一处；worker 错误写入文件系统 `execution.log` | 运行时问题诊断 | 无结构化日志、无 metrics、无 tracing。问题诊断依赖读文件系统 | 本地工具场景可接受。生产部署需补充结构化日志 |
| F-27 | `video/execution.js:21-22` | `debug.diagnostic_path` 和 `debug.log_path` 写入 status.json | 排错 | 正面：timing 和 diagnostics 完整记录了每个阶段的耗时与代码版本 | — |
| F-28 | `http/media-routes.js:81-84` | HTTP 错误处理：未发送 header 时返回 503，已发送则 `res.destroy()` | 流式传输中途报错 | 正确：已发 header 后无法再发状态码，destroy 是唯一选择。但无日志记录 | 建议为 `res.destroy()` 路径增加错误日志 |

### 方向 18：代码卫生与可维护性

**结论：2 项卫生问题（已在前次审查中记录）。**

| # | 位置 | 问题证据 | 触发条件 | 实际影响 | 修复建议 |
|---|------|---------|---------|---------|---------|
| F-29 | `.gitignore` | 缺少 `__pycache__/` 和 `*.pyc` 规则 | Python 测试运行后 | .pyc 文件误入版本控制（当前暂存区有 10 个） | 更新 .gitignore，撤销 .pyc 暂存 |
| F-30 | `app/` 目录 | 仅含 .pyc 缓存，无源码，无引用 | — | 空目录残留 | 删除 `app/` |
| F-31 | 全局代码风格 | 一致的单文件职责声明注释、中文错误信息、严格模式校验 | — | 正面发现：每个文件首行声明职责，命名全局统一 | — |

### 方向 19：配置、构建与部署

**结论：无严重问题。**

| # | 位置 | 问题证据 | 触发条件 | 实际影响 | 修复建议 |
|---|------|---------|---------|---------|---------|
| F-32 | `config.js:6-17` | `requiredConfig` 校验路径为绝对路径、URL 不含凭据/空白/查询参数 | 错误配置 | 正确：启动时即报错，不会静默接受无效配置 | 无需修复 |
| F-33 | `config.js:30-46` | `resolveConfig` 拒绝未知配置键，freeze 返回值 | 拼写错误的配置键 | 正确：`throw new Error('未知插件配置')` | 无需修复 |
| F-34 | `config.js:49-56` | `workerEnvironment` 从当前 `runtimeConfig()` 重建 env，不泄漏宿主环境中的旧值 | worker 进程启动 | 正确：delete 旧值 → 赋新值 | 无需修复 |
| F-35 | `jobs/diagnostics.js:7-16` | `codeVersion` 显式列出所有参与执行的模块文件，计算 SHA256 指纹 | 版本追踪 | 正面：任何执行语义变更都会改变指纹 | — |

### 方向 20：变更影响与根因

**结论：重构后无残留引用。**

| # | 位置 | 问题证据 | 触发条件 | 实际影响 | 修复建议 |
|---|------|---------|---------|---------|---------|
| F-36 | 全局 | `grep 'dsh-elysium-tools'` 返回 0 结果 | — | 旧目录名已完全清理 | — |
| F-37 | `runpod/scripts/` | import 路径均为 `../../dsh-elysium/src/` | — | 远端脚本已迁移到新路径 | — |
| F-38 | `harness/.dsh/profiles/web/cordis.patch.yml` | 引用 `@dsh-external/dsh-elysium` | — | 与 `package.json` 和 `index.js` 一致 | — |

---

## 三、安全审查

| # | 位置 | 问题证据 | 触发条件 | 实际影响 | 修复建议 |
|---|------|---------|---------|---------|---------|
| S-1 | `http/shared.js:6-9` | `authenticated` 使用 `timingSafeEqual` 比较 token | timing attack | 正确：长度先比较，再 constant-time 比较内容 | 无需修复 |
| S-2 | `http/media-routes.js:20-21` | credentials 端点要求 `x-elysium-media-refresh: 1` 和 `sec-fetch-site: same-origin` | CSRF | 正确：自定义 header 需要 CORS preflight，same-origin 检查防止跨站请求 | 无需修复 |
| S-3 | `comfyui/media-reference.js:8-10` | 校验 URL origin 匹配、无凭据、无 hash、无路径遍历 | 恶意素材 URL | 正确：防止 SSRF 和路径遍历 | 无需修复 |
| S-4 | `assets/local-media.js:9` | `inside(root, path)` 使用 `relative` + `sep` 检查路径是否在根目录内 | 路径遍历攻击 | 正确：配合 `realpath` 解析符号链接后再检查 | 无需修复 |
| S-5 | `assets/local-media.js:31` | `O_NOFOLLOW` flag 防止打开符号链接 | 符号链接指向敏感文件 | 正确：即使通过 `realpath` 检查，仍在 open 时拒绝符号链接 | 无需修复 |
| S-6 | `http/media-routes.js:67` | 上游 fetch 校验 `protocol` 和 `username/password` | 恶意 comfyui_view_url | 正确：防止 SSRF 到内部服务 | 无需修复 |
| S-7 | `http/shared.js:16-31` | `readJsonBody` 限制 2MB，校验为非数组对象 | 大请求 body DoS | 正确：防止内存耗尽 | 无需修复 |

---

## 四、发现汇总

### 需修复（P1）

| # | 方向 | 位置 | 摘要 |
|---|------|------|------|
| F-29 | 18 | `.gitignore` | .pyc 未排除，10 个编译产物在暂存区 |
| F-30 | 18 | `app/` | 重构遗留空目录 |

### 建议改进（P2）

| # | 方向 | 位置 | 摘要 |
|---|------|------|------|
| F-7 | 5 | `tools/model-jobs.js:24` | `getJob` 多余的第二参数（signal）被忽略 |
| F-28 | 16 | `http/media-routes.js:84` | 流式传输中断时 `res.destroy()` 无日志 |

### 长期关注（P3）

| # | 方向 | 位置 | 摘要 |
|---|------|------|------|
| F-13 | 12 | `jobs/paths.js:17-27` | `findJobRoot` O(N) 线性扫描，项目数增长后性能下降 |
| F-14 | 12 | `assets/catalog.js:36-55` | `listAssets` O(N×M) 全量扫描，无索引缓存 |
| F-26 | 16 | 全局 | 无结构化日志/metrics/tracing |
| F-5 | 4 | `jobs/query.js:2` | 通用 jobs 层引用 video 特化层 |

### 无需修复（正面确认）

- 锁机制（F-9, F-10, F-11, F-12）：双层锁设计正确，无竞态
- 重试与恢复（F-20, F-21, F-23）：指数退避、丢失 POST 恢复、3 轮确认，设计完整
- 安全机制（S-1~S-7）：timing-safe 认证、CSRF 防护、SSRF 防护、路径遍历防护均到位
- 配置隔离（F-32~F-34）：AsyncLocalStorage 隔离正确，worker 环境正确传播
- 资源管理（F-15~F-19）：文件句柄、超时、abort signal 管理正确
- 缓存语义（F-24, F-25）：workflow 缓存有一致性校验，HTTP 响应禁止缓存
- 代码版本追踪（F-35）：模块指纹机制完整
- 重构清理（F-36~F-38）：旧路径零残留

---

## 五、结论

项目重构后代码质量良好。核心视频生成链路的锁保护、重试恢复、提交去重、安全防护均设计严谨。2 项卫生问题（.pyc / app/）是唯一必须修复项。2 项接口层建议改进。4 项长期关注与当前规模无关，在项目/任务数量显著增长后需要优化。
