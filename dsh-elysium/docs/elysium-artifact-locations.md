# 极乐世界本地产物位置

## 数据根目录

极乐世界运行时数据默认保存在：

```text
/Users/mac/.dsh/profiles/web/data/elysium/projects
```

每个项目使用独立目录：

```text
projects/<projectId>/
```

这里是运行时数据，不属于 Git 仓库。删除项目会同时删除该项目下的单集和生成产物。

## 当前验收项目

项目：`E2E验收-雾港来信-20260904`

项目 ID：`project-mtmebbz4-ivxi8x`

单集：`雾港来信`

单集 ID：`episode-mtmebhxg`

完整目录：

```text
/Users/mac/.dsh/profiles/web/data/elysium/projects/project-mtmebbz4-ivxi8x
```

## 目录结构

```text
project-mtmebbz4-ivxi8x/
├── project.json
├── characters.json
├── scenes.json
├── shots.json
├── assets/
├── output/
└── episodes/
    └── episode-mtmebhxg/
        ├── assets.json
        ├── episode.json
        ├── issues.json
        ├── plan.json
        ├── script.json
        ├── state.json
        ├── tasks.json
        └── artifacts/
            ├── assets/       # 角色资产
            ├── anchors/      # 每章人物一致性起始帧
            ├── chapters/     # 章节视频
            └── final/        # 最终成片和 QC 文件
```

部分 JSON 文件可能随版本调整，但所有生成媒体统一位于单集的 `artifacts/` 目录。

## 当前媒体文件

### 角色资产

目录：

```text
/Users/mac/.dsh/profiles/web/data/elysium/projects/project-mtmebbz4-ivxi8x/episodes/episode-mtmebhxg/artifacts/assets
```

文件：`cast-main-1788493931774.png`

### 人物一致性起始帧

目录：

```text
/Users/mac/.dsh/profiles/web/data/elysium/projects/project-mtmebbz4-ivxi8x/episodes/episode-mtmebhxg/artifacts/anchors
```

每章只保存一张起始帧，例如 `chapter-01-anchor-01`；其余五段连续性由 SVI2Pro latent 延续，不再单独生成关键帧图片。

### 章节视频

```text
/Users/mac/.dsh/profiles/web/data/elysium/projects/project-mtmebbz4-ivxi8x/episodes/episode-mtmebhxg/artifacts/chapters/chapter-01-1788494955916.mp4
```

### 插件生成的最终成片

```text
/Users/mac/.dsh/profiles/web/data/elysium/projects/project-mtmebbz4-ivxi8x/episodes/episode-mtmebhxg/artifacts/final/final-1788494955928.mp4
```

同目录还保存技术质检文件：`qc-1788494973688.json`。

该成片是在时间轴缺陷修复前生成的历史产物，安装新版本不会自动覆盖它。

## 验收副本

为避免删除项目时丢失验收证据，文件另外复制到：

```text
/Users/mac/Downloads/elysium-e2e-20260904
```

主要文件：

- `雾港来信-final-timescaled-validation.mp4`：使用修复后时间轴逻辑合成的推荐版本。
- `雾港来信-final.mp4`：修复前版本，用于复现尾部截断缺陷。
- `01-qwen-plan.png` 至 `06-approved-final.png`：关键页面截图。
- `07-contact-sheet.jpg`：修复前成片抽帧。
- `09-anchor-contact-sheet.jpg`：六张锚点汇总。
- `10-timescaled-contact-sheet.jpg`：修复后成片抽帧。
- `qc.json`：原始技术质检结果。

## 打开目录

在 macOS 终端执行：

```bash
open /Users/mac/.dsh/profiles/web/data/elysium/projects/project-mtmebbz4-ivxi8x
open /Users/mac/Downloads/elysium-e2e-20260904
```

## 备份建议

需要长期保留时，应备份整个项目目录，而不只是最终 MP4。完整项目目录同时包含故事、剧本、制作规划、任务状态、角色资产、关键帧、章节视频和最终成片。

删除极乐世界项目之前，先复制项目目录或验收副本到其他位置。
