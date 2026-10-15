// 剧本节点：正文、版本、修改历史与节点状态。剧本审核与按审核意见修改都是作用于剧本节点的任务。
import { emptyNodeStateModel } from "./node_state_model.js";
import { emptyScriptRevisionModel } from "./script_revision_model.js";
export const emptyScriptModel = () => ({ version: 1, updated_at: "", body: "", future_plot: "", revision_history: [], node_state: emptyNodeStateModel() });
export { emptyScriptRevisionModel };
