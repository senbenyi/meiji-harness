# 输出健康闸门契约（跨仓指针）

契约的**定义源不在本仓**，在 `llm-ai-model/contracts/`：

| 文件 | 内容 |
|---|---|
| `llm-ai-model/contracts/media-gate-contract.json` | 判据、阈值、指标定义与探针口径 |
| `llm-ai-model/contracts/receipt-schema-v1.json` | 产物 receipt 的 JSON Schema |
| `llm-ai-model/contracts/README.md` | 所有权、修改流程、**实现执行器前必读的三个坑** |
| `llm-ai-model/tests/fixtures/media-gate/` | 样本集生成脚本与期望判定 |

放在模型仓的理由见 [执行计划](./ai-native-factory-execution-plan.md) 的责任矩阵：单产物技术真实性归模型能力层。

## 本仓已完成（P3）

契约以 **JS 模块内联**而非 vendor JSON——`package.json` 的 `files` 不含 `contracts/`，插件安装后读不到外部文件。

| 产出 | 位置 |
|---|---|
| 契约内联模块（生成物，勿手改） | `src/domain/media-gate-contract.js` |
| 同步脚本 | `scripts/sync-media-gate-contract.mjs` |
| 漂移检测 | `tests/production/media-gate.test.js` 比对 `CONTRACT_HASH` 与定义源 |

契约在模型仓变更后，运行 `node scripts/sync-media-gate-contract.mjs` 重新同步，否则漂移测试会失败。

**为什么插件也要一份执行器**：本仓的生产链路只直连 ComfyUI，**从不经过 model API**，因此没有任何远端 receipt 可验——每个产物的判定和 receipt 都由本仓自产（`producedBy: "plugin-local"`）。

## 分层归属

按 CLAUDE.md 的依赖方向约束：

- 探针执行（spawn ffprobe/ffmpeg）→ `src/infrastructure/`
- 放行决策与跨产物 QC → `src/application/`
- 状态转换与失效规则 → `src/domain/`

不要在 `production-service.js` 里同时写这三件事；`pnpm check:source-imports` 必须继续通过。
