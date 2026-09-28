# 密钥移出git

- 类型：Bug 修复
- 目标：密钥改存 `meiji/config/models.local.json`（git 忽略），`config/models.json` 不含密钥。
- 调研：`docs/research/调研-密钥移出git.md`

## 待用户决定
作废并重新生成网关密钥。

## 改动
### 阶段 1：本地覆盖文件
1. `meiji/models/router.js:defaults` — 只读 `config/models.json` → 再读可选的 `config/models.local.json` 浅合并覆盖，文件不存在时忽略；参数可传入本地文件路径便于测试 → AC-1、AC-3
2. `.gitignore` — 新增 `/meiji/config/models.local.json` → AC-2
3. `meiji/config/models.local.json` — 新建，只含 `apiKey`（从工作区 `config/models.json` 移入，权限 0600）→ AC-1
4. `meiji/config/models.json` — `apiKey` 恢复为空 → AC-1

验证：`git check-ignore -v meiji/config/models.local.json` 命中；`node -e` 读取 `defaults()` 的 apiKey 非空 → AC-1、AC-2

### 阶段 2：测试
1. `meiji/tests/models.test.js` — 真实密钥断言 → 使用测试密钥；新增本地文件覆盖与缺失两个用例 → AC-3
2. `meiji/tests/image.test.js` — `defaults()` 结果补测试密钥，不依赖真实密钥 → AC-3

验证：`cd meiji && npm test` 与基线对比，不新增失败 → AC-4

### 阶段 3：文档
1. `.agents/development.md` 第 3 节、`.agents/architecture.md` 第 2 节 — 密钥位置改为 `config/models.local.json` 或运行时文件 → AC-1

## 验收标准
AC-1 ～ AC-4（见调研）

## 验证结果
已执行：AC-1～AC-4 全部通过，详见 `docs/implement/实施-密钥移出git.md`。
