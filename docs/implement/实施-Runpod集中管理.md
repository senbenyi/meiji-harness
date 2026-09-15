# Runpod 集中管理实施记录

2026-09-15。职责：记录专属内容归位、外部依赖收口及实际验证。计划见 `docs/plans/计划-Runpod集中管理.md`。

## 改动

| 位置 | 结果 |
| --- | --- |
| `dsh-elysium/src/servers/providers/runpod/` | 正式实现保持集中；新增 tests/contract.test.js、legacy/operations.md、legacy/third-cup-preview.mjs、resources/workflow-previews.json；README 统一说明当前入口及归档边界。 |
| 根目录 `runpod/` | 撤销。服务管理调用公共 `dsh-elysium/scripts/server-service.mjs <provider> <action>`；隧道调用 `harness/scripts/tunnel.mjs`，不再维护平台外重复 CLI。 |
| 旧制作脚本 | 作为历史材料迁入平台 legacy。旧脚本不匹配当前项目级 CLI，三个旧脚本已按 Git 原始字节保留，仅供审计，不作为当前入口；当前生产由公共 production-runner.mjs 承担。未执行制作、重提任务或修改案例数据。 |
| Runpod workflows/ 与公共同步路由 | 五份完整模板、三份档位配置、图构建与同步编译器迁入平台 workflows；已撤销字段剥离逻辑，恢复完整 UI 元数据。公共同步入口只路由所选平台。 |
| scripts/test.mjs、package.json | npm test 动态发现公共测试及各 provider/tests，平台专属测试随模块管理，不留固定导入。 |
| scripts/build.mjs、servers/provider-loader.js | provider 的 tests/legacy/resources 排除出发布产物和执行代码指纹，避免源码/发布包指纹不一致。 |
| 公共测试 | H3 测试更正文件名；模拟服务域名去平台化；删除验收中的平台名只作为场景配置；增加公共模块边界测试；H3 专属测试随模板归位，校验完整 UI 元数据保留。 |
| Harness 预设与测试 | 创作规则/教学说明使用公共 ComfyUI 能力名称；公共路由测试替代对已撤销 CLI 的依赖。 |
| README、Harness README、AGENTS、standards、制作资料当前入口说明 | 更新集中管理目录、命令及约束；历史回执和研究记录保留原证据，不改写平台归属。 |

## 验证

- `cd dsh-elysium && npm test`：155 项通过，0 失败；其中 Runpod 专属契约与进程生命周期测试由模块目录动态发现。
- `node --test harness/tests/*.test.mjs`：16 项通过，0 失败。
- `npm run build && npm run package:registry`：通过。
- 实际导入 registry 插件、比较源码与 registry 的 Runpod 执行代码指纹：一致。
- registry 不含 provider/tests、legacy、resources：通过。
- 物理删除 Runpod 的临时副本：独立替代适配器仍完成本地 worker 提交/恢复、服务器切换、批次/参考帧、媒体与项目接口；原平台任务缺失时明确失败。
- Runpod H3 模板重新编译：API 图、绑定与完整 workflow 元数据一致；无删字段步骤。
- `provider-boundary.test.js`：公共 business/comfyui/tools/client/prompts 不包含 Runpod 平台名称或直接 provider 实现导入；旧根目录不存在。
- `git diff --check`：通过。

本次未连接真实平台、启停远端服务或修改真实存储。上述验收是代码边界与本地模拟服务验收，不代表其他平台已真实接入。

## 原始内容恢复与核对

用户纠正后，已撤回将原有模板视作公共资源的判断。以下文件恢复自迁移前 Git HEAD（b6f522e），迁入 Runpod 后逐字节一致；graph/profile 只调整导入路径。三个旧脚本的原始内容也已保留。

| 文件（workflows/minimax-h3/ 下） | 原始与迁移后相同的 SHA-256 |
| --- | --- |
| `templates/fl2va-loop.json` | `c03af4f062322e0f4e4b0ab56725821f64bddeb3b69a9c586beec1e102d8930d` |
| `templates/fl2va.json` | `c6be9855c7d4cf5965d9dad36e6d5aae09b2ee8f1c5eba85c4d4a46962750ef7` |
| `templates/i2va.json` | `e1a387719c91fe6a883a3b18cccf9f1af64118a3fc3324a7ba2ddc52d3cf587d` |
| `templates/r2va.json` | `f54244f2e3ecccb769a5e0d4201a704707996afe0b330677511f944ce3713901` |
| `templates/t2va.json` | `5e92d2de742348c8a2c25b2614dbe99395632bdde36e00b21d48fc8a91ed894f` |
| `profiles/preview-low-resolution.json` | `1e5e16bfe7f89ef170ac46150c5511ec84d8eed0685106a59b6965fc7ca6cd81` |
| `profiles/preview.json` | `e6b14fbdbe11c42a21c0890527290da4d6142132730c61d2a71ddd0d0f7d75cd` |
| `profiles/regular.json` | `265fb0a72897e6d23918838a090b42af1ca8f8379f5b5c532da0ba68babaacf7` |

旧 manual 配置通过核心路由使用原 Runpod 模板；独立替代平台测试使用自己的最小测试图，不复用或复制 Runpod 模板。真实其他平台仍未接入。
