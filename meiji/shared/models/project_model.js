// 项目根对象及其全部一级结构模型。
import { createId } from "../task_contract.js";
import { emptyProjectSummaryModel } from "./project_summary_model.js";
import { emptyScriptModel } from "./script_model.js";
import { emptyCharacterLibraryModel } from "./character_library_model.js";
export const emptyProjectModel = (fields = {}) => ({ id: createId("project"), name: "", creation_mode: "剧本", aspect_ratio: "768x1344", creative_direction: "", reference_episode_duration_seconds: 150, project_summary: emptyProjectSummaryModel(), script: emptyScriptModel(), character_library: emptyCharacterLibraryModel(), scene_library: { scenes: [] }, episodes: [], latest_tasks: {}, latest_groups: {}, ...fields });
export { emptyProjectSummaryModel, emptyScriptModel, emptyCharacterLibraryModel };
