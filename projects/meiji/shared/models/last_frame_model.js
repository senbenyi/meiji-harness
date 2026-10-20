// 视频任务产出的尾帧媒体节点模型。
import { emptyNodeStateModel } from "./node_state_model.js";
export const emptyLastFrameModel = () => ({ node_state: emptyNodeStateModel(), address: "" });
