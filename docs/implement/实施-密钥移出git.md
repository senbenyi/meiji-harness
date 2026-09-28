# 密钥移出git实施记录

## 已修改文件
- `meiji/models/router.js` — `defaults()` 读取可选的 `config/models.local.json` 并浅合并覆盖；文件不存在时忽略
- `meiji/config/models.json` — `apiKey` 恢复为空，与 HEAD 一致
- `meiji/config/models.local.json` — 新建（git 忽略，权限 0600），仅含 `apiKey`
- `.gitignore` — 新增 `/meiji/config/models.local.json`
- `meiji/tests/models.test.js` — 改用测试密钥；新增本地文件覆盖/缺失用例
- `meiji/tests/image.test.js` — 改用测试密钥
- `.agents/development.md`、`.agents/architecture.md` — 更新密钥位置

## 验收标准核对
| AC | 状态 | 验证方式与证据 |
|---|---|---|
| AC-1 | 通过 | `git diff HEAD -- meiji/config/models.json` 为空；`defaults()` 返回 51 位密钥，本地文件缺失时返回 `""` |
| AC-2 | 通过 | `git check-ignore -v` 命中 `.gitignore:53` |
| AC-3 | 通过 | `models.test.js`、`image.test.js` 在有/无本地文件时均 15/15 通过 |
| AC-4 | 通过 | 全量 246 通过 / 19–20 失败；差异项 `one shot can generate video while other storyboards are absent` 为既有不稳定测试（未改代码的副本中 6 次失败 2 次） |

## 测试
基线失败 19 项；改动后失败 19–20 项，无新增确定性失败。无本地密钥文件时全量失败 41 项：大量测试经 `setupModel` 读取默认配置并需要真实密钥，为既有问题（HEAD 同样 43 项失败），未在本任务处理。

## 人工待办
- [ ] 到网关后台作废并重新生成密钥（旧密钥在已推送提交 `11bfa75` 中），新密钥写入 `meiji/config/models.local.json`。
- [ ] 若运行目录 `$DSH_HOME/storages/meiji/models.json` 已存在，运行时以它为准，需在面板设置中同步更新新密钥。
