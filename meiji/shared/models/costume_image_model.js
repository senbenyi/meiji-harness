// 角色某套服装定妆照节点模型。
import { emptyNodeStateModel } from "./node_state_model.js";
export const emptyCostumeImageModel = (costume_id = "") => ({ node_state: emptyNodeStateModel(), costume_id, address: "" });
