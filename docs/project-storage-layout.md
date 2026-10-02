# 短剧项目存储布局

项目数据统一位于 `~/.dsh/storages/short_video_studio`。`bindings/` 是“工作区 + 会话 → 项目”的全局索引，不属于任何单个项目，因此保持在项目目录之外。

```text
short_video_studio/
├── bindings/                         # 会话绑定索引，位置与文件名保持兼容
├── projects/
│   ├── 20261002213427144.json        # Harness Project Domain 权威记录
│   └── 20261002213427144/             # 同一项目的全部文件
│       ├── step-00-project/           # 项目说明、规划、清单
│       ├── step-01-source/            # 原始剧本、小说、参考文本
│       ├── step-02-development/       # 故事开发、项目简报
│       ├── step-03-episode-plan/      # 分集大纲
│       ├── step-04-scripts/           # 分集剧本、镜头表
│       ├── step-05-assets/            # 角色、场景、道具设定
│       ├── step-06-storyboards/       # 分镜与提示词
│       ├── step-07-generation/        # 生成的图片、视频、音频
│       ├── step-08-assembly/          # 拼接与时间线产物
│       ├── step-09-quality-review/    # 质检与审核报告
│       ├── step-10-delivery/          # 最终交付物
│       ├── cache/                     # 可重建缓存
│       ├── tmp/                       # 项目临时文件
│       └── trash/                     # 可恢复归档与迁移备份
├── leases/
├── tmp/
└── trash/
```

## 命名规则

- 项目 ID：使用 Asia/Shanghai 时间生成的 17 位数字 `YYYYMMDDHHmmssSSS`，例如 `20261002213427144`。同一毫秒内创建多个项目时递增 1 毫秒，确保可排序且不重复。
- 项目文件：`step-NN-语义名称-vNNN.扩展名`。例如 `step-04-七列镜头表-S01-v001.pdf`。
- 源文件：按导入顺序使用 `source-001`、`source-002`，不再把 UUID 放进文件名。
- Domain 内部实体 ID 仍可承担引用关系；对用户可见的目录和文件名不得依赖随机 UUID。

## 旧项目迁移

迁移工具默认只输出预演计划，不写磁盘：

```bash
node scripts/tools/migrate-project-layout.mjs \
  --project=<剧本项目ID> \
  --canvas-project=<画布项目ID> \
  --workspace=<旧文件所在工作区>
```

确认预演结果后增加 `--apply`。工具会合并项目记录、更新原位置的 binding、复制并校验文件，然后将旧权威记录与旧工作区目录归档到新项目的 `trash/legacy-import-*`；迁移可从该目录恢复。
