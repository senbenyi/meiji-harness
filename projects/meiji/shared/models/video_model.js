import { defaultRules } from '../rule-defaults.js';
// 镜头视频生成媒体节点模型。
import { emptyNodeStateModel } from "./node_state_model.js";
export const emptyVideoModel = () => ({ rules: defaultRules('video'), node_state: emptyNodeStateModel(), server_address: "", address: "" });
