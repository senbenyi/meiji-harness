# Elysium 数据根目录与导演链路修复实施记录

## 已修改文件

- `dsh-elysium/src/utils/config.js` — 默认数据根改为 `$DSH_HOME/storages/elysium`。
- `dsh-elysium/src/utils/storage-paths.js`、业务 Store/Service — 将全部业务路径统一归入 `config`、`pools`、`projects`、`runtime`、`uploads`。
- `dsh-elysium/src/servers/registry/store.js`、`src/servers/selection/store.js` — 连接和模型选择分别使用 `config/servers.json`、`config/selection.json`。
- `dsh-elysium/scripts/migrate-home.mjs` — 无覆盖合并旧目录及散落配置；拆分混合配置，并将旧写入源归档到 `runtime/migrations/`。
- `dsh-elysium/src/client/workbench/directors.js`、`styles.js` — 新增/编辑取消文案分离，整卡点击编辑改为独立编辑按钮，动作列容纳编辑和删除。
- `dsh-elysium/tests/director-panel.test.js`、`director.test.js`、`config.test.js`、`home-migration.test.js` — 覆盖入口、单次请求、服务端最终值、失败草稿、重载、权限、默认根及无损迁移。
- `dsh-elysium/README.md`、`.claude/standards.md` — 记录唯一默认数据根及目录职责。

## 验收标准核对

| AC | 状态 | 验证方式与证据 |
|----|------|--------------|
| AC-1 | 通过 | `director-panel.test.js` 验证明确添加入口及服务端最终返回值回显。 |
| AC-2 | 通过 | 测试验证独立编辑按钮、导演卡无 `onClick`、拖动标题保持。 |
| AC-3 | 通过 | 测试验证新增/修改各一次请求、失败保留草稿、Store 重载及 JSON `0600`。 |
| AC-4 | 通过 | 构建产物和已重启的 Harness 均使用 `$DSH_HOME/storages/elysium`；访问后 `~/.elysium` 未重建。 |
| AC-5 | 通过 | 迁移前后 954 个业务文件清单及 SHA-256 完全一致。 |
| AC-6 | 通过 | 运行接口与 `pools/directors.json` 均为 5 条，顺序和 SHA-256 完全一致。 |
| AC-7 | 通过 | 连接、选择和 provider 配置已拆分到 `config/`，权限为 `0600`；原文件进入迁移归档。 |
| AC-8 | 通过 | build、registry 打包、链接包指纹和 Harness 重启通过，3080 返回 Harness 身份响应。 |

## 人工待办

- 无。
