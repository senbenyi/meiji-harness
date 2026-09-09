# llm-dsh-plugins

DeepSeek Harness 插件、运行配置与部署脚本。

## 项目结构
- `dsh-elysium-tools/` — 工具注册、参数处理、任务调用与媒体卡片。
- `dsh-elysium-ui/` — 独立导演设置界面与提示词读取，不依赖工具插件。
- `dsh-elysium/` — 已废弃的旧插件，未经明确要求不修改或删除。
- `app/config/` — 可选服务器部署的运行参数与宿主设置。
- `dsh-elysium-tools/.dsh/.agent-presets/elysium/` — 随包安装的 Agent preset、人格、协作指令和创作技能。
- `app/` — 部署入口；`app/common/` 提供配置解析、安装、启动和隧道脚本。

## 铁律
- 插件不允许上传、下载、保存文件方法
- 插件中媒体、视频、图片一律使用服务器url

## 构建、开发命令
- `pnpm install --frozen-lockfile --ignore-scripts`：按锁文件安装依赖。
- `pnpm test`：运行当前插件的测试。
- `pnpm build`：生成可分发的构建产物。
- `pnpm package:registry`：组装 registry 包。