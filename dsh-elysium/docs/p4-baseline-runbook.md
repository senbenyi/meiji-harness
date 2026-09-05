# P4 端到端基线执行手册

**性质：** 决策门。这一阶段**只允许修 bug，不允许加能力**——否则决策门失去意义。
**依据：** [执行计划](./ai-native-factory-execution-plan.md) P4；[rollout](./ai-native-factory-rollout.md) §11

## 前置

1. 服务器上 ComfyUI 与 dsh web 均已启动，插件已安装。
2. 模型侧允许未验证能力派单——否则跑不出验证所需的证据：
   ```sh
   export MODEL_API_ALLOW_UNVERIFIED=1
   ```
   基线通过后改回 `0`，并把确实验证过的能力在 `capabilities.py` 里标 `verified`。
3. 若插件与 ComfyUI 共享文件系统，配置 `comfyui.sharedInputRoot` 指向 ComfyUI 的
   `input/` 目录；不共享就留空——留空时"零上传"这一项会如实记为不适用，不会谎报通过。

## 执行

```sh
cd dsh-elysium
node scripts/baseline-run.mjs \
  --base-url http://127.0.0.1:3080 \
  --workspace /root/autodl-fs/elysium-workspace \
  --repeat 3 \
  --out baseline-report.json
```

`--workspace` 必须指向服务真正在用的工作区，脚本要读产物旁边的 `.receipt.json`
来核对泄漏率；不给就跳过这项核对，决策门第一条无法判定。

`--repeat 3` 是 P50/P95 的最低样本量；要更稳的分位数就加到 10。

## 报告怎么读

`baseline-report.json` 的 `decisionGate` 是判定结论：

| 字段 | 含义 | 通过条件 |
|---|---|---|
| `noFakeSuccess` | 标了 succeeded 但 receipt 说没过闸门的产物 | `leaked` 为空 |
| `receiptsComplete` | 每个成功产物都有可解析的 receipt | `missing` 为空 |
| `zeroUpload` | HTTP 上传次数 | 共享区已配置时 `uploads === 0`；未配置时为 `null`（不适用） |
| `reachedReview` | 每轮都跑到人工终审 | `reviewed === total` |

`pass: null` 表示该部署形态下不适用，**不是通过**。脚本退出码只在出现 `pass: false`
时为 1。

其余指标在 `latency`（P50/P95）、`runs[].tasks`（首次通过率、平均重试次数、自动恢复率）、
`runs[].gpuSecondsPerVideoMinute`。

`manualScores` 是角色一致性与镜头连续性的人工评分，脚本量不出来，评审看完片自己填。

## 通过之后要做的两件事

1. **复标定闸门阈值。** 契约现在标着 `provisional`，阈值来自合成样本。用 `runs[].receipts`
   里记录的真实 `metrics` 分布复核 `llm-ai-model/contracts/media-gate-contract.json`，
   特别是 `flatFrameRatio` 的熵阈值——雾景、纯色天空这类合法画面天然低熵，有误杀风险。
   确认后把 `status` 改成 `stable` 并升 `contractVersion`。
2. **标记已验证能力。** 把跑通且产物过闸门的能力在 `capabilities.py` 里改成
   `"status": "verified"`，然后关掉 `MODEL_API_ALLOW_UNVERIFIED`。

## 没通过怎么办

回到 P1–P3 修复，不要进 P5/P6。常见三类：

- **有泄漏**（`leaked` 非空）：闸门规则没覆盖到这种失败形态。补样本、补规则，两侧执行器同步。
- **receipt 缺失**：放行点漏挂了闸门，检查 `production-service.js` 的两处放行点。
- **跑不到终审**：看 `runs[].issues` 里的 `QC_GATE_FAILED` 判据 id——如果同一条规则反复命中，
  多半是阈值定得过紧，属于复标定问题而不是模型问题。
