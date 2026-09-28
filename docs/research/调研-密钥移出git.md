# 密钥移出git调研

## 结论
- AC-1 — 已确认 — `defaults()` 只读 `config/models.json`，密钥目前写在该 git 跟踪文件中，需新增本地文件读取。
- AC-2 — 已确认 — `.gitignore` 未忽略任何本地密钥文件。
- AC-3 — 已确认 — `models.test.js`、`image.test.js` 断言真实密钥（`startsWith('sk-')`），依赖仓库内密钥。
- AC-4 — 已确认 — 同一密钥存在于已推送提交 `11bfa75`（根 `config/models.json`），`80c445f` 清空；本任务不改历史，需人工作废密钥。

## 规格
- 目标：密钥只保存在本地不入 git 的文件，`config/models.json` 不含密钥，功能不变。
- 非目标：1. 不重写 git 历史；2. 不改运行时 `storages/meiji/models.json` 的读写；3. 不引入环境变量方案。
- 验收标准：
  - AC-1：`config/models.json` 的 `apiKey` 为空；`meiji/config/models.local.json` 存在时，`defaults()` 返回其中的 `apiKey`（本地文件覆盖同名字段）。
  - AC-2：`git status` 不显示 `models.local.json`，`git check-ignore` 命中。
  - AC-3：测试不依赖真实密钥；本地文件缺失时 `defaults()` 返回空 `apiKey` 不报错。
  - AC-4：`npm test` 不新增失败（基线 246 通过 / 19 失败）。

## 调用链
```text
server/data/models.js modelStore.read()
├─ storages/meiji/models.json 存在 → 直接使用（本地运行数据，不入 git）
└─ ENOENT → models/router.js defaults() → 读 config/models.json（git 跟踪，含密钥）
   → normalizeModels() 缺 apiKey 抛「需要网关密钥」
```

## 证据
| 来源（文件:行） | 支持的结论 |
|---|---|
| `meiji/server/data/models.js:11` | 运行时文件缺失才回退 `defaults()` |
| `meiji/models/router.js:7-9` | `defaults()` 只读 `config/models.json` |
| `meiji/tests/models.test.js:19` | 测试断言密钥以 `sk-` 开头 |
| `git log -S <key>` | 命中 `11bfa75`、`80c445f`，均在 `origin/meiji` |

## 问题
| AC | 预期 | 实际 | 根因 |
|---|---|---|---|
| AC-1 | 仓库文件无密钥 | 工作区 `config/models.json` 含密钥 | 默认配置是唯一的非运行时来源 |

## 待用户决定
作废并重新生成网关密钥（历史已泄露到私有仓库）。
