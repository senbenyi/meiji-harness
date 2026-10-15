import { emptyScriptReviewModel } from '../../shared/models/script_review_model.js';

// v16：为已有项目补空的剧本审核节点；已有字段不改。旧版本迁移在校验前也先补齐，避免新字段使旧链路校验失败。
export function addScriptReview(project) {
  if (!Object.hasOwn(project, 'script_review')) project.script_review = emptyScriptReviewModel();
  return project;
}
