# 短剧流程闭环修复与实机验收

> 范围：按用户要求先修流程，内容、表演、声音与视觉连续性的质量审核留到下一步。旧小说项目和旧视频没有自动重写。
> 状态：真实服务全链路通过；重启后复验通过。2026-10-06 23:04（上海时间）保存最终验收记录。

> 浏览器验收勘误：后续逐页截图确认，DOM 中有产物不代表页面可读。画布 Flex 收缩造成卡片被压扁和裁切，已用单条 CSS 修复；重复展示、自动跳页等问题仍待处理。原有生成链路证据不变，页面不能视为全面验收通过。见[逐页检查报告](2026-10-06-drama-browser-audit.md)。

## 最大问题与修复

此前最大的流程问题是主编排把“子任务返回了结果、视频文件生成了”当成了完成，缺少贯穿领域数据、后台任务、生成请求、画布和交付文件的同一套完成条件。这是我先前设计与实现的责任，不能归因于小说本身，也不能只归因于子 Agent。

| 断点 | 修复文件与行为 |
| --- | --- |
| 上游缺失仍能生成视频 | `lib/domain/policies.js`、`lib/production/drama.js`：分析、正式剧本、角色/场景设定图、分镜图成为视频生成的前置条件；参考图→分镜图→视频→分集拼接→全剧交付具有明确依赖，失败阻塞下游 |
| 子任务失败被吞掉、已完成文本不可见 | `lib/script/novel-production.js`、`lib/index.js`：保留失败结果，逐阶段落地分析、规划、剧本；恢复只补缺失任务；空镜允许明确声明无人出镜，角色镜头必须绑定对应人物 |
| 宿主真实契约与测试替身不一致 | `lib/index.js`：从真实 session.header.cwd 解析工作区，并将 workspaceId 传给后台任务；`lib/script/novel-production.js` 使用宿主支持的结构化 schema 子集，时长等限制由业务校验执行 |
| 镜头顺序、时长与输入丢失 | `lib/script/contracts.js`、`lib/index.js`：按显式 order 物化分集和镜头，按正式镜头顺序拼接；时长传到底层视频请求，角色、场景和分镜图传入真实生成图 |
| 重试重复生成、重启丢失进度 | `lib/domain/production.js`、`lib/index.js`：保留 attemptId/promptId 检查点，下载失败复用原任务；有效工作租约不被抢占；同源并发入口合并；重复恢复使用当前修订号 |
| 队列完成与正式交付脱节 | `lib/index.js`、`lib/domain/policies.js`：校验完整镜头、批准状态、可解码文件与实际时长；写入 step-10-delivery，登记 Deliverable 后才能完成项目；重复入口校验文件存在和哈希，失效媒体不能交付 |
| 页面四阶段为空、进度误导 | `lib/domain/read-models.js`、`studio/app.js`：从领域事实投影分析、设定、剧本、分镜图和交付，显示各阶段真实数量与阻塞错误；流程完成和质量未审核分别显示 |

参考了本地开源项目 `/Users/mac/ai/code/ArcReel/lib/workflow/workflow_rules.py` 与 `server/agent_toolset/workflow_completion.py` 的阶段检查点和版本化完成事实。保留当前领域模型，修复实际执行链路。

## 自动化验证

- 完整 `npm run test:all`：110 通过，0 失败。
- 完整 `npm run smoke:all`：通过；`git diff --check`：通过。
- 最后的画布档位投影修正后，阶段门禁与完整入口集成测试再次运行：12 通过，0 失败。
- `tests/plugin/drama-flow.test.js` 从真实注册工具入口执行源文导入、文本落盘、后台任务、真实 ffmpeg 拼接和正式交付；外部模型与 Comfy 服务使用测试替身。
- 集成测试覆盖同源并发调用、连续两次下载失败、宿主插件重挂载、恢复不重复提交 GPU、完成后复用，以及删除交付文件后拒绝假报成功。
- 领域测试覆盖缺上游禁止视频、参考图失败阻塞下游、子任务失败保留上游、失效资产禁止交付，以及子 Agent 返回乱序 JSON 时仍按 order 物化。

这些测试不代替真实模型生成。下面单独记录实机结果。

## 真实服务验证

通过 `scripts/checks/drama-live.mjs` 调用真正的 `studio_novel_create`，使用真实宿主 workflow、文本模型、存储、ComfyUI 与 ffmpeg。输入为仓库内普通短文 `scripts/fixtures/drama-flow.txt`（54 字符，车站取信），未使用原小说的敏感正文。

- 隔离领域数据：`/tmp/dsh-drama-flow-storage/short_video_studio/`；实际媒体仍在常规项目目录。
- 验收项目：`20261006223852287`。
- 媒体 Run：`25e8e7f2-942b-42c8-9468-308c4d004e27`。
- 原始生成报告：`/tmp/dsh-drama-flow-report.json`；重启复验报告：[flow-verification.json](/Users/mac/.dsh/storages/short_video_studio/artifacts/20261006223852287/step-00-project/flow-verification.json)。
- 真实产物：1 份源文、1 集正式剧本、3 张设定图、3 张分镜图、3 个视频镜头、1 份正式交付；六个阶段全部 completed，项目 completed。
- 三镜计划时长为 8、7、8 秒，真实视频为 8、7.292、8 秒；引用数量分别为 2、3、3（第一镜明确为空镜，只引用场景和分镜图；后两镜另有角色图）。
- 最终视频：832×480，559 帧，包含音轨，23.324 秒，2,921,187 字节；计划总时长 23 秒。交付文件存在且 SHA-256 与记录一致。
- 完成后重复入口及宿主重启后再次调用均复用同一 runId，没有新增生成 Attempt。
- [正式交付视频](/Users/mac/.dsh/storages/short_video_studio/artifacts/20261006223852287/step-10-delivery/step-10-25e8e7f2-942b-42c8-9468-308c4d004e27.mp4)。
- [验收画布](http://127.0.0.1:3081/dsh-short-video-studio/?sessionId=drama-flow-4f0c554b-9475-41f9-8047-5b5e8be12d70&workspaceId=c85e6201-acbd-4cf3-9d20-11151610fc74)：隔离验收服务，不改写 3080 上原小说项目。
- Chrome 实际逐个点击六个阶段页签：均显示已完成且有对应产物，资产页 3 张图、分镜页 3 张图、视频页 3 段视频；无页面 JavaScript 异常，档位正确显示 fast。[页面截图](/Users/mac/.dsh/storages/short_video_studio/artifacts/20261006223852287/step-00-project/flow-overview.png)。

### 实机暴露的运行环境断点

ComfyUI 的分镜 KSampler 连续报 `aimdo memory compile error`。错误在任务中明确保存，视频、拼接、交付均被依赖阻塞，没有假报成功。确认远端队列空闲后，在现有启动脚本中增加 `--disable-comfy-compiler`，通过原有进程管理器重启单个 ComfyUI 进程，保留反向隧道。之后同一流程恢复，已成功生成分镜图和视频。

- 服务器启动文件：`/root/autodl-tmp/comfyui-runtime/scripts/run_comfyui_foreground.sh`。
- 修改前备份：`/root/autodl-tmp/comfyui-runtime/backups/run_comfyui_foreground.pre-drama-compiler-fix.sh`。
- 生效检查：运行进程参数包含 `--disable-comfy-compiler`，真实 KSampler 随后成功。没有升级模型或改变生成质量档位。

## 部署与边界

已使用 `dsh plugin --profile web install --force` 同步插件；主服务 3080 已重启并通过静态资源 HTTP 检查。隔离验收服务使用 3081。

最终核验仓库与安装目录的入口、小说编排、剧本契约、阶段门禁、画布投影及前端文件哈希一致。验收时入口 `lib/index.js` 的 SHA-256 为 `60ce938c3fbe49258629f88b1f8a00a855ed937b0c4d54d9b61c05c9a57e8654`。

本轮验收证明阶段产物、依赖、恢复和交付是否闭合。画面好坏、人物与动作连续性、对白/声音正确性尚未审核；交付记录明确保留 `visualReview: not_performed`，界面显示“质量未审核”。历史项目不会因新代码安装而自动变成合格成片。
