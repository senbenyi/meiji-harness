// 单镜每秒分镜节点模型。
import { emptyNodeStateModel } from "./node_state_model.js";
import { emptyStoryboardContentModel } from "./storyboard_content_model.js";
export const emptySecondsStoryboardModel = () => ({ node_state: emptyNodeStateModel(), transition_from_previous_shot: "", content: emptyStoryboardContentModel() });
