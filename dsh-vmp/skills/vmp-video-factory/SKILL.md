---
name: vmp-video-factory
description: 在 DeepSeek Harness 聊天框中创建、检查、生产、续跑和验收原创成人短视频 VMP 单集。
---

# VMP Video Factory

- spec 固定写入 `/Users/mac/ai/llm-ai-veo/llm-ai-model/workflows/mvp/episodes/<episode_id>.json`，严格遵循相邻的 `episode.schema.json`，固定 12 镜。
- 所有角色必须是虚构成年人；所有参与者明确年满 18 岁、内容自愿、素材权利完整。信息不足时停止生产。
- 只用 `_dsh_external_dsh_vmp` 工具执行生产动作；不得直接调用 ComfyUI、Qwen、Wan 或旧 Toonflow 生成接口。
- 创建 spec 后先 `action=check`。`images`、`video`、`all` 会产生远端 GPU 成本，必须先说明 episode、profile 和阶段，获得本次明确授权后才传 `confirmed=true`。
- 失败后先 `action=status`，再使用相同 spec 和阶段续跑；禁止删除、覆盖或伪造正式产物。
- `all` 返回 `technical_complete=true` 后用 `action=sync` 拉回成片，在插件或聊天中交给用户完整观看。
- 只有用户明确确认人物一致性、肢体结构、镜头语义、内容合规和交付可用性后，才用 `stage=approve`、验收人和 `review_confirmed=true` 登记人工验收。
- 仅当 `delivery_complete=true` 时称为完整交付；单个 prompt、图片、视频块或技术 QC 均不等于完整交付。
