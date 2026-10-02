# 删除 h3skill 参考目录

- 类型：重构
- 目标：删除不再需要的 h3skill 参考资料及失效引用。
- 非目标：不修改生产 skills、视频生成规则或运行数据。

## 验收标准与调研结论
| AC | 输入/状态 → 可观测结果 | 判定 | 依据 |
|---|---|---|---|
| AC-1 | 执行清理 → meiji/h3skill 目录不存在 | 已确认可删除 | 全仓搜索仅见文档及测试排除列表引用，无业务加载 |
| AC-2 | 清理后 → 开发规范和架构测试无失效引用，测试无新增失败 | 未验收 | 实施后运行 npm test |

## 调用链与证据
此目录为独立参考资料，无生产入口；实际生产规则由 skills/skill-catalog.js 与 skills/load-skills.js 管理。
GitNexus status 索引有效；已执行 h3skill query 及架构测试 sources 的 context/upstream impact；源码搜索补查动态引用。

| 来源 | 支持的结论 |
|---|---|
| .agents/meiji-dev.md:144 | 仅有官方文件名保留说明 |
| meiji/tests/architecture.test.js:26 | 仅为目录遍历排除项 |

## 待用户决定
无。用户已明确要求删除。

## 改动
### 阶段 1：清理参考目录
1. `meiji/h3skill/` — 整个目录删除 → AC-1
2. `.agents/meiji-dev.md:文件命名规则` — 删除 h3skill 文件名保留说明 → AC-2
3. `meiji/tests/architecture.test.js:sources` — 删除 h3skill 排除项 → AC-2

验证：目录存在性检查、引用搜索、npm test、git diff --check。

## 验证结果
基线与改动后均为 589 通过、0 失败、0 取消。目录已删除；两处引用搜索无结果；git diff --check 通过。GitNexus detect-changes 的全工作区结果包含先前未提交重构，本次仅删除参考资料并清理上述两处引用。AC-1、AC-2 均通过。
