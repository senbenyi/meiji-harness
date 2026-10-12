// 剧集故事大纲节点模型。
import { emptyNodeStateModel } from "./node_state_model.js";
export const emptyStoryOutlineModel = () => ({ node_state: emptyNodeStateModel(), segments: [] });
