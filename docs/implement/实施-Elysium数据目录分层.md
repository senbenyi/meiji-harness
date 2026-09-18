# Elysium 数据目录分层实施记录

## 已修改文件

- `dsh-elysium/src/utils/storage-paths.js`、各业务 Store/Service — 统一 `config`、`pools`、`projects`、`runtime`、`uploads` 五类一级路径；项目任务、生产回执和媒体仍归项目所有。
- `dsh-elysium/config/settings.json`、服务器 registry/selection Store — 将连接、模型选择和平台配置拆分到 `config/`。
- `dsh-elysium/src/business/directors/store.js` — 导演库唯一持久化位置改为 `pools/directors.json`。
- `dsh-elysium/scripts/migrate-home.mjs` — 无覆盖合并旧数据、拆分混合配置、保持凭据权限，并将旧写入源归档到 `runtime/migrations/`。
- `dsh-elysium/tests/storage-layout.test.js`、`home-migration.test.js` 及相关路径测试 — 覆盖目录边界、配置拆分、数据保留、归档和 provider 隔离。
- `dsh-elysium/README.md`、`.claude/standards.md` — 固化五类目录职责和唯一数据根。

## 验证结果

- 定向迁移/provider 边界测试：5/5 通过。
- 插件全量测试：162 项中 161 通过；唯一失败为受限环境无法确认 worker 完整命令行身份的既有测试，与本次路径改动无关。
- Harness 测试：7/7 通过。
- `pnpm build`、`pnpm package:registry`：通过；服务端源码、`lib`、`registry` 对应文件 SHA-256 一致。
- 本机数据保护：迁移前后排除迁移备份的 `pools/projects/runtime/uploads` 954 个文件清单完全一致，清单 SHA-256 为 `09f63806b6f1d438183f3570530838acc1da9427ddf1efd9bb6e93c903f24367`。
- `runtime/` 原有 `calls`、`sessions`、`tunnels` 完整保留；旧目录与原始配置归档到 `runtime/migrations/2026-09-18T02-19-51.872Z/`。
- `config/servers.json` 只保留连接字段，选择数据进入 `config/selection.json`，平台配置进入 `config/providers/`；相关文件权限均为 `0600`。
- Harness 已重启至 PID 91118；导演接口返回 200，接口与 `pools/directors.json` 均为 5 条且 SHA-256 同为 `d597adb95d34161938e0e9e6c8e8c6b0b73d19bd48e97682a05f4986b915a212`；访问后 `~/.elysium` 未重建。

## 人工待办

- 无。
