// 项目根对象及其全部一级结构模型。
import { createId } from "../task_contract.js";
import { emptyProjectSummaryModel } from "./project_summary_model.js";
import { emptyScriptModel } from "./script_model.js";
import { emptyScriptReviewModel } from "./script_review_model.js";
import { emptyCharacterLibraryModel } from "./character_library_model.js";
export const emptyProjectModel = (fields = {}) => ({ id: createId("project"), name: "", creation_mode: "剧本", aspect_ratio: "1344x768", creative_direction: "", reference_episode_duration_seconds: 150, project_summary: emptyProjectSummaryModel(), script: emptyScriptModel(), script_review: emptyScriptReviewModel(), character_library: emptyCharacterLibraryModel(), episodes: [], ...fields });
export { emptyProjectSummaryModel, emptyScriptModel, emptyScriptReviewModel, emptyCharacterLibraryModel };
