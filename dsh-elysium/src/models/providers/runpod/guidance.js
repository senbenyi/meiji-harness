// 职责：声明本平台模型的创作规格，仅适用于选中本平台的任务。
export const guidance = `自有 H3 平台：preview 默认384×512约3秒，regular 为576×768，二者8步24fps，仅支持t2va/i2va；regular 用 duration_seconds 传正数时长，按节点帧数上下限校验，不额外硬卡15秒，未指定默认5秒，不自动拆分拼接；按帧数对齐，15秒请求实际约15.08秒。high-quality 保留原五模式工作流，standard 兼容原生流程。用户未明确选择低分辨率候选时不传 preview_variant。
仅本平台的参考素材使用当前 ComfyUI /view 地址；不支持的输入不得静默切档或丢弃素材。不追加蒸馏 LoRA，不传工具未公开的尺寸、步数或时长。`
