import { defaultRules } from '../rule-defaults.js';
// 角色某套服装定妆照节点模型。
import { emptyNodeStateModel } from "./node_state_model.js";
export const emptyCostumeImageModel = (costume_id = "") => ({ rules: defaultRules('costume-image'), node_state: emptyNodeStateModel(), costume_id, address: "" });
