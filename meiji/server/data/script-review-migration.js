import { emptyNodeStateModel } from '../../shared/models/node_state_model.js';

// v16–v18：剧本本身是节点，审核与修改都是剧本节点上的任务，只保留 script.node_state。
// 早期 v16 的独立 script_review 节点并入剧本状态；v17 的 script.review 结论字段移除（修改意见已在 node_state.reason）。
// 幂等；旧版本迁移在校验前也先调用，避免新字段使旧链路校验失败。
export function normalizeScriptNode(project) {
  const legacy = project.script_review;
  delete project.script_review;
  delete project.script_revision.review;
  if (!project.script_revision.node_state) project.script_revision.node_state = legacy?.node_state ? { ...emptyNodeStateModel(), ...legacy.node_state } : emptyNodeStateModel();
  return project;
}
export const isScriptNodeNormalized = project =>
  !Object.hasOwn(project, 'script_review') && Boolean(project.script_revision.node_state) && !Object.hasOwn(project.script_revision, 'review');
