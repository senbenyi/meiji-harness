# dsh-elysium-tools

独立的 Harness 媒体插件，自带工作流、任务卡、Elysium 预设和创作技能，不依赖 UI 插件或仓库 `app/`。

## 安装

需要 Harness、Node.js 20.16+、Python 3、FFmpeg、FFprobe，以及已安装所需模型和节点的 ComfyUI。

交付包安装后重新加载 Harness：

```sh
dsh plugin --profile web add --workspace-root /absolute/path/to/package
```

从源码准备交付包，在本插件目录执行：

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm test
pnpm build
pnpm package:registry
dsh plugin --profile web add --workspace-root ./registry
```

## 配置

将 [连接配置示例](config/cordis.patch.example.yml) 合并到 `$DSH_HOME/profiles/web/cordis.patch.yml`，未设置 DSH_HOME 时使用 `~/.dsh`。

- `comfyUrl`：Harness 可访问的 ComfyUI 地址。
- `publicUrl`：浏览器可访问的 ComfyUI 地址；须单独填写，插件不建立隧道。
- `artifactsRoot` / `stateRoot`：默认 `$DSH_HOME/elysium/artifacts` / `tasks`；自定义时填写本机绝对路径。
- `python` / `ffmpeg` / `ffprobe`：默认命令名，也可填写程序绝对路径。
- `legacyOutputRoot`：仅恢复历史非 HTTP 任务时需要。
- `enableAtomicTools`：默认 false；测试兼容原子入口时才开启。

配置优先级：插件显式配置 → 兼容环境变量 → 默认值；两个服务地址无默认值。完整字段校验以 `src/config.js` 为准。

已有模型可直接使用；需要新增时参考 [宿主模型配置](config/harness-settings.example.yaml)，按实际端点和模型调整，密钥放环境变量。按需合并，不覆盖已有设置；权限由宿主管理。

## 使用

新会话选择“极乐世界”，描述制作目标即可。插件不强制切换默认预设或模型。

| 操作 | 工具 |
|---|---|
| 视频／多镜头制作 | `workflow_generate_video` |
| 视频恢复 | `workflow_resume_video` |
| 图片／已有视频合片 | `model_generate_image` / `model_concat_video` |
| 图片、合片恢复 | `model_job_resume` |
| 查询状态／结果 | `model_job_status` / `model_job_result` |

参数以工具 schema 为准。多镜头使用 `shots`，保留镜号、素材和目标总时长；每段生成 1–15 秒，`duration` 总和等于目标时长。模式为 independent、reference、continue、reuse。

输入素材须为 `artifactsRoot` 内真实文件的绝对路径，通过 HTTP 上传，无需挂载远端目录。Web 自带任务卡与播放器，CLI 返回任务结果和产物地址。

等待中断不取消后台任务；先查询原 `job_id`，技术失败排除原因后恢复，改稿或换素材新建任务并 reuse 未变镜头。生成、技术校验通过不代表人工认可；参考素材或相同 seed 不保证身份、口型或输出完全一致。
