# dsh-elysium-ui

独立的导演设置和提示词读取插件。只依赖 Harness 的设置、工具及浏览器扩展接口，不依赖 tools 插件、Elysium 预设、ComfyUI 或仓库 app/。

## 安装

交付包安装：`dsh plugin --profile web add --workspace-root /absolute/path/to/package`，随后重新加载 Harness。源码目录内发布准备命令：

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm test
pnpm build
pnpm package:registry
dsh plugin --profile web add --workspace-root ./registry
```

安装后打开「设置 → 极乐世界 → 导演设置」，新增导演名称与提示词并保存。在任意 Harness 预设的会话中，模型可通过 `elysium_read_director` 按 ID 读取指定导演；继续使用宿主已有模型，无需配置 ComfyUI。

## 配置与行为

插件默认 `enabled: true`、`directors: []`。可选配置示例随包提供在 [config/settings.example.yaml](config/settings.example.yaml)，不需要部署目录。

索引只包含 ID、名称和版本，不主动注入提示词正文。长篇创作选定导演后按需读取，同版本仍在上下文时复用。短视频不自动读取导演。关闭或删除后不能继续读取；保存采用版本检查，冲突时重新加载。

此插件提供导演管理，不执行媒体生成。媒体任务卡由生成工具所属的 dsh-elysium-tools 自带；两个插件可分别安装，也可同时安装。

## 验证

`pnpm test` 验证导演新增、保存、删除、冲突处理、普通预设中的读取及客户端入口注册。交付包包含服务端、浏览器入口、配置示例；React 由宿主提供。服务器部署和真实模型调用须另行验收。
