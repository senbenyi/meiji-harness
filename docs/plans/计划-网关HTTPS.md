# 网关HTTPS

- 类型：Bug 修复
- 目标：默认网关地址改为 HTTPS。
- 调研：`docs/research/调研-网关HTTPS.md`

## 待用户决定
本机验证 HTTPS 可连通；运行时 `storages/meiji/models.json` 已存在时需在面板设置中同步修改。

## 改动
### 阶段 1
1. `meiji/config/models.json:baseUrl` — `http://43.154.247.11/v1` → `https://43.154.247.11/v1` → AC-1
2. `meiji/tests/models.test.js:13`、`meiji/tests/image.test.js:39-40` — 断言地址改为 https → AC-2

验证：`cd meiji && npm test` 与基线（246 通过 / 20 失败）对比不新增失败 → AC-2；本机 curl → AC-3

## 验收标准
AC-1 ～ AC-3（见调研）

## 验证结果
已执行：AC-1、AC-2 通过；AC-3 待本机验证。详见 `docs/implement/实施-网关HTTPS.md`。
