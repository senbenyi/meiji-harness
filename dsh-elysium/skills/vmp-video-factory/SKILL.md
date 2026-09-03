---
name: vmp-video-factory
description: 在 DeepSeek Harness 聊天框中创建、检查、生产、续跑、同步和验收固定 2 镜、2 视频的原创成人短视频单集。
---

# VMP Video Factory

- 只调用 `_dsh_external_dsh_elysium_factory`；Elysium 内置合同驱动并通过隧道进入远程 ComfyUI。不要绕过插件直接拼装工作流或执行远端脚本。
- 生产单固定为 `vmp-1`：只包含 `shot-01` 和 `shot-02`，每镜生成一个长视频，最终成片不少于 40 秒。
- 所有角色必须是已授权的虚构成年人；所有参与者明确年满 18 岁、内容自愿、素材权利完整。信息不足时停止生产并询问用户。
- 新建生产单使用 `action=create`；然后依次 `check`、`status`。不得覆盖同名生产单，输入变化必须使用新 `episode_id`。
- `action=run` 的 `images`、`video`、`all` 会产生远端 GPU 成本。必须针对本次单集和阶段获得用户明确授权，才能传 `confirm_authorized_adults=true`。
- 失败或 Harness 重启后先 `action=status`，再使用相同生产单和阶段续跑。不得删除、覆盖或伪造正式产物。
- 某个镜头或视频块失败时，先查看 `status`，再用 `action=retry` 和精确 `target` 重置；随后执行相应阶段即可断点续跑。
- 技术流水线完成后用 `action=artifact` 获取 `final` 和 `qc`，在工厂界面交给用户完整观看。
- 只有用户明确确认人物一致性、肢体、镜头语义、内容合规和交付质量后，才执行 `action=approve`。
- 仅当本地状态为 `approved` 时，才能称为完整交付。
