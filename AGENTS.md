# llm-dsh-plugins

DeepSeek Harness 插件、运行配置与部署脚本。

## 项目结构
- `dsh-elysium-tools/` — 工具注册、参数处理、任务调用与媒体卡片。
- `dsh-elysium-ui/` — 独立导演设置界面与提示词读取，不依赖工具插件。
- `app/config/` — 本机 Harness、远端模型服务地址与隧道设置。
- `dsh-elysium-tools/.dsh/.agent-presets/elysium/` — 随包安装的 Agent preset、人格、协作指令和创作技能。
- `app/` — 部署入口；`app/common/` 提供配置解析、安装、启动和隧道脚本。

## 铁律
- 插件不允许上传、下载、保存文件方法
- 插件中媒体、视频、图片一律使用服务器url
- Harness 只在本机运行；远端服务器只保留模型服务。

## 与短剧批量生产的边界
- `workflow_generate_video` 面向单镜头/多镜头对话式生成，不做角色资产冻结、不做自动一致性校验。跨镜头/跨集角色一致性的短剧批量生产权威入口是 `llm-ai-model/workflows/drama-production/drama_orchestrator.py`，独立于本插件运行，不经过 Harness 会话；不要在本插件里重新实现分镜/角色资产/自动 QC 这套逻辑。
- 该编排器为满足人工审片需要，会在本机保留生成候选素材供人看图判断，这是这套人机协作精修流程特有的例外，不代表插件的“不落地媒体”铁律被放松；插件本身仍然只用服务器 URL。

## 构建、开发命令
- `pnpm install --frozen-lockfile --ignore-scripts`：按锁文件安装依赖。
- `pnpm test`：运行当前插件的测试。
- `pnpm build`：生成可分发的构建产物。
- `pnpm package:registry`：组装 registry 包。
