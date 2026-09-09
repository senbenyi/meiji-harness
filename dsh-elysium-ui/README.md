# dsh-elysium-ui

Harness 对话内媒体任务卡，以及设置 → 极乐世界 → 导演设置。

- 启用开关控制导演管理界面和后续请求中的已保存导演目录。
- 新增、修改、删除导演名称和提示词，点击保存后写入 Harness 原生设置。
- 保存带版本检查；其他页面修改后需重新加载，避免覆盖。
- 仅注册只读工具 `elysium_read_director`，不注册生成接口、项目工作台或 ComfyUI 驱动；媒体状态和视频流由工具插件提供。
- 宿主通过原生 `system-prompt/assemble` 向 `elysium` 提供导演 ID、名称和版本索引，不注入正文；长视频或连续剧创作选定后由AI按ID读取一个导演，版本未变且内容仍在上下文时复用。短视频直接生成不读取导演，长篇未指定导演时使用默认叙事方法。保存不调用模型、不生成视频；关闭或删除后读取失败，其他preset不暴露此工具。

配置命名空间为 `dsh-elysium-ui`，字段为 `enabled` 和 `directors`。
部署脚本完整覆盖 Harness 设置时，应在 `app/config/harness-settings.yaml` 中管理同名配置，否则界面保存值会被覆盖。

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm test
pnpm build
pnpm package:registry
```

独立安装 `registry/`；工具插件部署脚本不负责部署本 UI。

## 服务器部署

在仓库根目录执行 `bash app/deploy_dsh_elysium_ui.sh`，发布到 `veo-comfyui` 并重启远端 Harness，访问本地隧道 `http://127.0.0.1:23080/`。媒体任务卡还需要最新工具插件；完整顺序、Python 环境和配置覆盖范围见 [部署说明](../docs/harness.md)。

## 本机部署

在仓库根目录执行：

```sh
bash app/deploy_dsh_elysium_ui_local.sh
```

需要 Node.js 20+、pnpm 和已安装的 `dsh`。脚本依次安装依赖、测试、构建、打包，注册到本机 `web` profile，重启本机 Harness 并检查 HTTP。默认使用 `~/.dsh`，可通过绝对路径 `DSH_HOME` 指定已有 Harness 配置目录；保留现有设置。

访问 `http://127.0.0.1:3080/`，刷新后打开「设置 → 极乐世界 → 导演设置」。`23080` 是服务器隧道，与本机实例分开。启动日志位于 `$DSH_HOME/logs/dsh-elysium-ui-local.log`；若 3080 被其他程序或启动管理器占用，先手动停止。工作目录为本仓库，因此会加载仓库内适用的指令和技能。脚本通过链接安装 `registry/`，安装后请保留此目录。

## 模块边界

- `src/index.js`：设置注册、Elysium 导演索引及只读加载工具。
- `src/client/index.js`：浏览器插件入口，仅组合功能。
- `src/client/settings/directors.js`：导演设置及原生设置版本冲突处理。
- `src/client/media/api.js`：同源状态/媒体 URL 与 HTTP 读取。
- `src/client/media/model.js`：工具结果兼容解析与阶段文案。
- `src/client/media/card.js`：原生 `tool.call.toolview` 卡片、轮询生命周期、卡片内播放器。
- `scripts/client-source.mjs`：声明模块顺序，测试与构建共用；React 由宿主提供，避免再引入框架副本。

构建将浏览器模块合并到兼容原发布入口的 `lib/client.js`。业务卡片只注册视频创建/恢复工具，不接管整个聊天流、上下文注入或其他工具卡片。复用宿主会话与调用 ID，不在浏览器重建工具调用拓扑。导演设置仍独立工作；媒体接口不可用时卡片显示连接错误。

## 媒体任务卡

需同时发布工具插件：它保存 `session_id + call_id → job_id`，通过 `/plugins/dsh-elysium/media/status` 提供摘要，通过 `/video` 提供 MP4 流。页面凭据由宿主启动页注入，URL 相对当前页面，不硬编码 3080 或 23080。独立 UI 包不依赖工具插件源码或旧 `dsh-elysium`。

卡片每3秒读取状态；网络失败退避到最多30秒；完成/失败停止轮询；卸载中止请求并清理计时器。刷新/回到原对话后重新查询持久关联。运行态只显示真实阶段，不编造百分比。服务器重启后页面凭据失效会要求刷新。旧完成调用可从宿主已加载的原会话工具结果找回任务 ID。

视频优先使用 tools 返回的 `comfyui_view_url`，默认经本机 6016 隧道直连 ComfyUI `/api/view`；播放器放在任务详情下方，不展示独立链接，无需公网。tools 将最终成片发布到 ComfyUI 输出目录，内部文件路径不进入默认交付。旧版 tools 的同源视频接口保留兼容，支持 Range 与 HEAD。访问边界沿用单用户 Harness 与 ComfyUI 隧道，不提供多租户权限管理。

第一版不增加 GPU 生成调用，不自动恢复失败任务，不提供未实现的取消按钮。失败展示原因并保留执行记录；关闭浏览器后后台生产继续，返回后刷新卡片，未实现操作系统/站外完成通知。停止模型等待也不等于取消 GPU 任务。

发布验收：检查运行/失败/完成三态、断线恢复、刷新后关联、原对话内视频加载与下载、有效 Range 206、错误 Range 416、页面凭据失效，以及导演设置保存。测试素材不能替代服务器真实视频验收。
