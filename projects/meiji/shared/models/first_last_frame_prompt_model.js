// 首尾帧视频生成提示词节点模型。
import { emptyNodeStateModel } from "./node_state_model.js";
export const emptyFirstLastFramePromptModel = () => ({ node_state: emptyNodeStateModel(), model: "", prompt: "", seconds: 0, size: "", input_reference: "" });
