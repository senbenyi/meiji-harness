# Meiji

## 数据保存与共享图片

项目主 JSON 使用递增的 `revision`。单个服务进程内按项目串行提交，剧集更新在锁内合并；生成任务按读取版本提交，冲突时保留新编辑并释放自己的运行状态。不要运行多个写入同一 DSH_HOME 的服务实例。

新生成的人物、场景、衣服、道具、发型和铅笔分镜先保存到 `storages/meiji/image-drafts/<draftId>/`，剧集的 `pendingImages` 记录待确认预览，不修改当前图片。用户点击“确认使用”后调用上传接口，取得 `imageUrl`，再保存到 `storages/meiji/assets/<category>/<assetId>/` 并更新关联。上传失败保留预览和原图。确认入口独立于模型工具，模型不能自动批准。人物归入人物素材，场景与铅笔分镜归入场景素材，衣服、道具和发型归入道具素材。项目保存 `assetId`、`assetCategory`、`imageUrl` 和预览地址；视频任务保存提交时的 `assetIds`。重新生成创建新预览，确认后创建新素材，不覆盖旧素材。

图片编辑区的“从素材库选择”可以关联已有素材；“删除图片”只解除当前关联。旧项目图片继续兼容读取；提交视频时，会把所需的旧本地参考图登记为素材。素材库不自动删除未引用图片。项目内 images 目录仍可能保留生成缓存，共享引用指向素材库文件。

面板调用必须携带 `operationId` 并校验会话。多集制作操作必须提供 `episodeId`。参考图片变化后，已有视频和合成结果标记为 `stale`，需要重新生成后才能参与合成。

Harness 外部插件，源码位于 `Meiji/meiji/`，不修改上游 Harness。测试：`npm test`。

## 目录与职责

保留 7 个一级目录：`client`、`server`、`models`、`tools`、`skills`、`config`、`tests`。

| client 路径 | 职责 |
| --- | --- |
| panel.js | 加载浏览器模块的入口 |
| app.js | 组合进行中项目与片库两个模块 |
| shell.js | 右栏外壳、标题、加号和收起图标 |
| session/ | 正在进行的会话项目：流程概要、空态加号、当前项目 |
| library/ | 片库：短剧列表与素材 |
| api.js | 同源请求与资源地址 |
| dom.js | 元素和标签栏组件 |
| styles.css | 面板样式 |

`server/data/projects.js` 管理项目，`server/data/library.js` 管理素材文件与元数据，`server/http/library-routes.js` 管理导入、读取与分段播放，`server/http/routes.js` 组合鉴权后的 HTTP 路由。浏览器仅加载白名单内的客户端模块。

## 页面行为

右侧栏标题为「极乐世界」，标题右侧是新建加号；最右侧提供片库与图标式收起/展开。点击标题进入正在进行的会话项目：顶部固定流程概要「剧情 / 分片 / 成片」。没有进行中项目时，概要下方显示大加号「创建项目」；已有则展示该项目。片库是独立模块，只有点击片库按钮时展示。

片库只有点击片库按钮时展示：顶层为「短剧 / 素材」。短剧下显示「进行中 / 已完成」，分别对应 `in-progress` 与 `completed`。一级使用贴顶下划线标签，二级使用紧凑分段按钮。当前不会自动执行生成流程或将项目标记完成。

素材下分为人物、场景、道具、声音、视频。前三类支持 PNG/JPG/WebP/GIF；声音支持 MP3/WAV/M4A/OGG/FLAC；视频支持 MP4/WebM/MOV。音视频是否可直接播放取决于浏览器对文件编码的支持，均可下载原文件。支持一次选择多个文件，逐个导入并报告每个失败项；单文件最大 512 MB。

## 本地存储

源码与用户数据分开，持久化根目录是 `$DSH_HOME/storages/meiji/`，本机对应 `/Users/tom/Documents/ChatGPT/Meiji/.dsh/storages/meiji/`。

```text
meiji/
├── models.json
├── projects/
│   └── <项目UUID>.json
└── assets/
    ├── characters/
    ├── scenes/
    ├── props/
    ├── audio/
    └── video/
        └── <素材UUID>/
            ├── metadata.json
            └── original.<扩展名>
```

各素材分类使用相同的 UUID 目录结构，文件名不作为存储路径，允许同名素材重复导入。元数据记录版本、ID、分类、原文件名、文件类型、字节数、导入来源和创建时间。项目 JSON 以 UUID 为文件名，记录版本、唯一 ID、标题、整数秒时长、摘要、状态、阶段、工作流和创建/更新时间。点击创建后写入该文件，创建完成即展示项目 ID。

导入先流式写入 `<素材UUID>.upload/`，文件和元数据均成功写入后，原子重命名为正式目录。失败导入清理临时目录；进程意外退出残留的 `.upload` 不进入素材列表，可在服务停止后清理。素材是全局片库，目前不归属于某个项目；后续项目引用应保存素材 ID，不复制原文件。备份时复制整个 `storages/meiji/`，恢复到同版本的运行目录即可。当前短剧由工作区绑定决定，不记在浏览器里。

导入和读取均沿用 Harness 登录保护；写请求要求同源自定义请求头。文件格式按扩展名与分类校验，不做转码、内容识别或去重；不接收 HTML/SVG 等主动内容。原文件下载和音视频 Range 请求均需登录。

## 模型与工作流

网关地址、密钥和四个模型名写在 `config/models.json`。运行中的一份是 `storages/meiji/models.json`，文本、图片和视频都读它。密钥不返回给浏览器。

制作顺序由 `server/flow/gates.js` 的门禁决定：简报、大纲、角色、场景、镜头表、每秒指令、文本分镜，然后逐镜交给 MiniMax H3。铅笔分镜在镜头详情里生成，成片拼接仍只保留卡片。

右栏左边缘可拖拽调整宽度，聊天区域同步适配；宽度记入浏览器 localStorage，刷新、收起后展开均恢复。窗口缩小时自动限制宽度，拖拽手柄也支持左右方向键。

## 短剧工作区

每部短剧通过主 JSON 的 `workspaceId`、`workspacePath` 关联专属 Harness 工作区。工作区目录是 `storages/meiji/projects/<projectId>/`，主数据暂沿用 `storages/meiji/projects/<projectId>.json`，媒体继续保存在项目目录内。

创建或从片库选择短剧时，创建或复用该目录对应的工作区，打开已有未归档会话；没有会话则新建。浏览器通过 Harness 的持久化会话选择刷新进入目标工作区。短剧改名同步工作区名称，同名冲突添加项目 ID 后缀。

旧 `workspaceIds` 和旧映射仅保留，不自动迁移历史会话；只有主 JSON 的 `workspaceId` 与当前会话所属工作区一致时，才允许执行该短剧的操作。

## 通用自检与人工审核

每集统一保存 `episodes[].feedback[目标]`，不再在业务内容中保存 `shots.check/review`、`selfCheck` 或各类专用审核字段。

```json
{
  "check": { "passed": false, "failures": ["时长不足"] },
  "review": { "status": "changes-requested", "text": "增加环境镜头", "history": [] }
}
```

- `check.passed`：`null` 未检查、`true` 已通过、`false` 未通过；`failures` 只存流程校验或执行错误。
- `review.status`：`pending` 待审、`changes-requested` 需修改、`approved` 已确认；`text` 只存待处理人工意见，历史意见统一保存在 `review.history`，不再自动参与生成。
- 流程目标：`summary`、`brief`、`outline`、`characters`、`scenes`、`shots`、`seconds`、`storyboard`、`films`、`assembly`。
- 单对象目标：`shot:S01`、`seconds:S01`、`storyboard:S01`、`pencil:S01`、`film:S01`、`image:C01`、`image:C01:clothes`。同一 ID 在不同剧集互不影响。

重新生成读取当前目标的自检失败原因和人工意见。生成成功且校验通过后清空失败原因与待处理人工意见，审核状态回到待审；失败保留人工意见。图片上传确认完成后才标记人工审核通过。批量任务只向每一镜传入它自己的意见和批量共用意见。

旧数据通过 `server/data/feedback-migration.js` 迁移到同一结构并删除旧字段。生成函数返回的临时 `check` 用于校验结果传递，保存时归入 `feedback`，不形成第二份持久化状态。
