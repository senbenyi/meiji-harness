// 剧集镜头表节点模型。
import { emptyNodeStateModel } from "./node_state_model.js";
export const emptyShotListModel = () => ({ node_state: emptyNodeStateModel(), shots: [] });
