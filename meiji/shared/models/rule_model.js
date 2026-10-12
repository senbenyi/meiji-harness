// 项目规则及适用范围模型。
import { createId } from "../task_contract.js";
export const emptyRuleModel = (fields = {}) => ({ id: createId("rule"), scope: "project", applicable_business_types: [], node_id: "", category: "其他", constraint: "参考", content: "", ...fields });
