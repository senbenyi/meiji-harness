// 项目摘要节点模型。
import { emptyNodeStateModel } from "./node_state_model.js";
export const emptyProjectSummaryModel = () => ({ node_state: emptyNodeStateModel(), body: "", script_version: 1 });
