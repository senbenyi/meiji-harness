# 项目约定

本文件定义项目结构与编码约定，所有阶段（调研/计划/实施）均须遵守。

## 1. 插件结构

项目仅包含 dsh-elysium-tools 插件。

```
dsh-elysium-tools/
├── src/                # 源代码
│   ├── index.js        # 插件入口，导出 name / inject / apply
│   ├── http/           # 媒体查询、下载代理与项目 CRUD（project.js）
│   └── client/         # React.createElement，无 JSX
│       ├── media/      # 媒体卡片
│       └── panel/      # 素材侧栏与项目管理（project.js：锚点、分镜、交付）
├── scripts/            # 构建脚本（统一目录名）
│   ├── build.mjs       # src → lib + 生成 client.js
│   ├── client-source.mjs # 客户端模块拼接
│   └── package-registry.mjs # 组装 registry/
├── tests/              # 单元测试
├── lib/                # 构建产物（git-ignored）
├── registry/           # 发布产物（git-ignored）
├── package.json
├── cordis.patch.yml
├── dsh.plugin.json
└── README.md
```

**规则**：
- 构建脚本目录统一命名为 `scripts/`。
- `package.json` 中 `scripts.build` 和 `scripts.package:registry` 指向 `scripts/` 下的脚本。
- 新增客户端模块（含 `panel/`）后须同步更新 `scripts/client-source.mjs` 的模块列表，依赖在前、`index.js` 最后。
- `panel/` 使用 `load(name, (require, exports) => { ... })` 定义模块；拼接脚本适配宿主的 `{ id, factory }` 注册格式，不引入 bundler。
- 媒体及项目端点共用注入 token，客户端通过 `mediaUrl()` 构建带凭据的 URL。用户下载流式代理上游，不保存媒体文件；项目 JSON 使用临时文件加 rename 原子写入。

## 2. 预设结构

预设位于 `harness/.agent-presets/`。

```
harness/.agent-presets/
├── _base/                  # 公共基础 cordis 配置
│   └── agent.cordis.yml    # 共享模板（teaching/free/director 共用）
├── elysium-teaching/
│   ├── preset.yml          # 名称、描述、排序
│   ├── agent.cordis.yml    # → ../_base/agent.cordis.yml（符号链接）
│   ├── persona.md          # 人设提示词
│   └── rules.md            # 行为规则
├── elysium-free/           # 同上结构
├── elysium-director/       # 同上结构
└── elysium-standard/       # 独立 cordis（原生完整工具）
    ├── preset.yml
    └── agent.cordis.yml
```

**规则**：
- teaching/free/director 三个预设共享同一份 `agent.cordis.yml`，通过符号链接指向 `_base/agent.cordis.yml`。
- 修改共享配置只改 `_base/agent.cordis.yml` 一处。
- elysium-standard 保持独立配置（工具集不同）。
- 预设目录不保留空 `skills/` 目录；仅在有实际技能文件时创建。

## 3. 部署与配置

```
app/common/               # 本地部署脚本
harness/config/            # Harness 配置模板
harness/deploy.sh          # 服务器部署（需 root）
```

**规则**：
- `harness/config/settings.yaml` 使用 `__PLACEHOLDER__` 占位符，由 `config_loader.py` 渲染。
- 部署脚本支持 `SKIP_COMFYUI_CHECK=1` 跳过 ComfyUI 检查。
- 服务器部署用 `operator-agent.cordis.yml` 覆盖教学预设（安全限制）。

## 4. 测试

```
tests/                     # 项目级测试（部署、配置、预设）
dsh-elysium-tools/tests/   # 工具插件单元测试
```

**规则**：
- Node.js 测试用 `node --test`，Python 测试用 `unittest`。
- 新增工具/功能必须有对应测试。

## 5. 铁律

- 插件不允许上传、下载、保存文件方法。
- 插件中媒体、视频、图片一律使用服务器 URL。
- Harness 只在本机运行；远端服务器只保留模型服务。
