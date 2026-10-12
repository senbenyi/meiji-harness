// 镜头视频生成媒体节点模型。
import { emptyNodeStateModel } from "./node_state_model.js";
export const emptyVideoModel = () => ({ node_state: emptyNodeStateModel(), address: "" });
