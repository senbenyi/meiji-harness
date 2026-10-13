// 一组关联制作任务的固定字段模型。
import { createId } from "../task_contract.js";
export const createTaskGroupModel = (fields = {}) => ({ id: createId("group"), project_id: "", episode_id: null, name: "任务组", group_type: "single", action: "generate", source: "panel", shot_ids: [], created_at: new Date().toISOString(), ...fields });
