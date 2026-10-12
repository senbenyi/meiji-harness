// 角色服装资料模型。
import { createId } from "../task_contract.js";
export const emptyCostumeModel = (fields = {}) => ({ id: createId("costume"), number: "", name: "", description: "", color: "", material: "", props: "", ...fields });
