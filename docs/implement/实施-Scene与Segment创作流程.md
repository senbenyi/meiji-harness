# Scene 与 Segment 创作流程实施记录

## 已修改文件

- `dsh-elysium/src/database/schemas/production.js`、`database/managers/production.js`、`database/managers/projects.js`：Scene、Segment、素材意图、不可变制作快照、输入/视频版本及轻量摘要；项目元数据最后发布快照指针，既有数据保留。
- `dsh-elysium/src/server/projects/{production,segment-assets,segment-queue,composition,workflow}.js`：AI 分阶段读写、素材图生成与恢复、逐段串行队列、单段提交、时间线及导出任务。
- `dsh-elysium/src/server/jobs/create.js`、`server/workflows/videos/service.js`：预分配任务身份、审核输入快照校验、重复恢复不改原始输入。
- `dsh-elysium/src/tools/project/{production,workflow,project}.js`、`tools/prompts/creation.js`、`src/index.js`：新阶段工具、当前项目对话绑定及定时恢复；聊天工具不提供视频审核提交。
- `dsh-elysium/src/models/managers/runtime/index.js`、`models/protocols/{comfyui/plan.js,ssh-media/compose.js,ssh-media/compose.py}`、`models/providers/{autodl,runpod}/index.js`：实际后端描述与服务器合片协议；AutoDL 使用已有 Python 环境。
- `dsh-elysium/src/models/providers/autodl/workflows/minimax-h3/{plan,director,profile}.js`、`models/providers/runpod/workflows/minimax-h3/profile.js`：片段画幅、秒数传入实际图，保留原始 Prompt。
- `dsh-elysium/src/client/workbench/{production-ui,production-workflow,segment-editor,project-generation,projects,styles}.js`、`scripts/loader.js`：七步卡片、横向列表、独立详情、编辑草稿与路由绑定、单段/全部按钮和版本选择；新建项目移除旧集数字段，保留时长/画幅/导演/参考剧情。
- `dsh-elysium/tests/{production,production-ui,project-polling,project-workflow,project-panel,project,workbench,creation-commands,autodl-h3-video}.test.js`：新增业务专项测试并将相关 UI 回归切换为 Scene/Segment；保留无关素材库变更。
- `dsh-elysium/README.md`、原计划、`.claude/progress.md`：新流程、真实能力与验证记录。

## 验收标准核对

| AC | 状态 | 验证方式与证据 |
|----|------|----------------|
| AC-1 | 通过 | 临时目录测试快照重读一致、稳定 ID、输入版本保留、上游修改失效；原数据没有删除。新结构在 `projects/<id>/production/revisions/<snapshot>/`，详见计划目录树。 |
| AC-2 | 通过 | 浏览器实测项目 `4ba45756`：真实 Qwen 生成 10 秒 Scene、1 个 Segment、2 位人物及七类素材描述、3 个分镜；编辑运镜后保存并返回片段详情，导航和草稿不混用。 |
| AC-3 | 通过 | 实际 AI 生成 H3 Prompt，人工修改后保存第二个版本；本地回读与页面正文一致，真实后端为 AutoDL、Dasiwa H3 Turbo。图编译测试确认 Prompt、4.5 秒和 16:9 进入实际导演节点。 |
| AC-4 | 通过（模拟执行） | 单段只启动指定段；外层跳过当前已成功段；下一段等待前段完成；失败暂停和恢复使用原 job_id；新建服务实例后续跑，不重复启动已运行任务。未批量调用 GPU 视频生成。 |
| AC-5 | 通过（分层验证） | 100 段时间线顺序、越界裁切拒绝、冻结导出、重启后读取与成功后不重复合片；服务器真实 ffmpeg 合成两段自建红/蓝测试视频，验证裁切、字幕、淡入淡出、无声段补音轨、音量和背景音乐。中文字幕/混音样本状态 succeeded，实际时长 1.574 秒。 |

## 验证结果

- 插件测试：207 项通过；Harness 测试：10 项通过。
- `node scripts/build.mjs`、`node scripts/registry.mjs` 构建发布通过，Harness 已重启。
- `git diff --check` 通过。
- 真实模型调用限文本阶段；未声称完成真实 H3 视频画质或人物一致性验收。
- 浏览器回归发现并修复两类缺陷：素材描述返回形状不完整却保存为空；保存分镜后路由切换时旧草稿传入片段编辑器。另修复无输入/无视频时 `undefined === undefined` 导致成片阶段误判就绪的问题。
- 服务器 `/usr/bin/ffmpeg` 可用；为中文 drawtext 安装 `fonts-noto-cjk`，使用现有 `/root/autodl-tmp/venvs/comfyui-minimax-h3/bin/python`。没有重启模型服务，也没有下载媒体到本机。

## 当前能力与边界

- 服务器当前安装 Dasiwa H3 Turbo 衍生权重，没有官方 H3 Base。输入详情展示实际模型，未把 Turbo 产物标记为 Base。
- 新流程当前支持 t2va 和单张首帧 i2va。人物/服装/道具等其他图片引用在输入详情标明为文字描述参考；没有实现多参考图/多音频原生条件注入。素材图按第 4 步按钮生成；纯文字模式不强制生成图片。
- Segment 视频时长优先使用任务实测值；无实测值时暂用计划时长，合片服务器再次 ffprobe 并限定到实际可用时长。
- 淡入淡出是片段边缘淡入/淡出，不是重叠交叉溶解；场景一致性和模型对运镜的遵循仍需人工审核。
- 浏览器保留“流程验收：书店重逢”文本示例，包含两版 H3 输入、没有视频生成任务，方便查看新流程。

## 人工待办

- 无阻塞的部署待办。实际视频生成与画面一致性仍按产品第 5 步人工审核提交。
