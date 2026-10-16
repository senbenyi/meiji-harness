// 静态节点目录：节点仍嵌套保存在项目 JSON；任务组只编排指向这些节点的任务。
const freezeDefinitions = (definitions) =>
  Object.freeze(
    Object.fromEntries(
      Object.entries(definitions).map(([key, value]) => [
        key,
        Object.freeze(value),
      ]),
    ),
  );

export const NODE_DEFINITIONS = freezeDefinitions({
  // 剧本本身是节点，审核与修改都是作用于它的任务。审核任务只有 AI 审核步骤，未通过不自动修改；
  // 修改任务按审核意见改写剧本再 AI 审核，未通过时再修改一次，共两轮修改与审核。
  "script-review": {
    targetKind: "project",
    field: "script",
    label: "剧本",
    handler: "text",
    output: "text",
    programReview: false,
    aiReview: true,
    retryRounds: 1,
    precheck: "project-text",
  },
  "project-summary": {
    targetKind: "project",
    field: "project_summary",
    label: "项目摘要",
    handler: "text",
    output: "text",
    programReview: false,
    aiReview: true,
    retryRounds: 2,
    precheck: "project-text",
  },
  "project-characters": {
    targetKind: "project",
    field: "character_library",
    label: "剧本重要角色",
    handler: "text",
    output: "text",
    programReview: false,
    aiReview: true,
    retryRounds: 2,
    precheck: "project-text",
  },
  // 仅供历史任务识别与默认图只读定位；新命令不接受此业务。
  "character-image": {
    retired: true,
    targetKind: "character",
    field: "character_image",
    label: "角色图",
    handler: "media",
    output: "image",
    programReview: false,
    aiReview: false,
    retryRounds: 0,
    precheck: "character-image",
  },
  "costume-image": {
    targetKind: "costume",
    field: "costume_images",
    label: "角色定妆照",
    handler: "media",
    output: "image",
    programReview: false,
    aiReview: false,
    retryRounds: 0,
    precheck: "costume-image",
  },
  "episode-summary": {
    targetKind: "episode",
    field: "summary",
    label: "展示摘要",
    handler: "text",
    output: "text",
    programReview: false,
    aiReview: true,
    retryRounds: 2,
    precheck: "episode-summary",
  },
  outline: {
    targetKind: "episode",
    field: "story_outline",
    label: "故事大纲",
    handler: "text",
    output: "text",
    programReview: true,
    aiReview: true,
    retryRounds: 2,
    precheck: "outline",
  },
  'episode-scenes': { targetKind: 'episode', field: 'scene_catalog', label: '提取场景', handler: 'text', output: 'text', programReview: false, aiReview: true, retryRounds: 2, precheck: 'episode-scenes' },
  'scene-image': { targetKind: 'scene', field: 'reference_image', label: '场景参考图', handler: 'media', output: 'image', programReview: false, aiReview: false, retryRounds: 0, precheck: 'scene-image' },
  shots: {
    targetKind: "episode",
    field: "shot_list",
    label: "镜头表",
    handler: "text",
    output: "text",
    programReview: true,
    aiReview: true,
    retryRounds: 2,
    precheck: "shots",
  },
  seconds: {
    targetKind: "shot",
    field: "seconds_storyboard",
    label: "每秒分镜",
    handler: "text",
    output: "text",
    programReview: true,
    aiReview: true,
    retryRounds: 2,
    precheck: "seconds",
  },
  storyboard: {
    targetKind: "shot",
    field: "text_to_video_prompt",
    label: "分镜提示词",
    handler: "text",
    output: "text",
    programReview: false,
    aiReview: true,
    retryRounds: 2,
    precheck: "storyboard",
  },
  'first-last-frame': { targetKind: 'shot', field: 'first_last_frame_prompt', label: '首尾帧参数编排', handler: 'program', output: 'request', programReview: false, aiReview: false, retryRounds: 0, precheck: 'video-pack' },
  multimodal: { targetKind: 'shot', field: 'multimodal_prompt', label: '多模态参数编排', handler: 'program', output: 'request', programReview: false, aiReview: false, retryRounds: 0, precheck: 'video-pack' },
  video: {
    targetKind: "shot",
    field: "video",
    label: "视频",
    handler: "media",
    output: "video",
    programReview: true,
    aiReview: false,
    retryRounds: 2,
    precheck: "video",
  },
  tail: {
    retired: true,
    targetKind: "shot",
    field: "last_frame",
    label: "尾帧与实际时长",
    handler: "media",
    output: "image",
    programReview: false,
    aiReview: false,
    retryRounds: 0,
    precheck: "tail",
  },
  assembly: {
    targetKind: "episode",
    field: "assembly",
    label: "合片",
    handler: "media",
    output: "video",
    programReview: false,
    aiReview: false,
    retryRounds: 0,
    precheck: "assembly",
  },
});

export const OPERATION_DEFINITIONS = freezeDefinitions({
  "shot-characters": { retired: true, targetKind: "shot", label: "镜头角色与服装（已并入镜头表）", handler: "program", output: "none", programReview: false, aiReview: false, retryRounds: 0 },
  "script-split": {
    targetKind: "project",
    label: "拆分剧集",
    handler: "text",
    output: "episodes",
    programReview: true,
    aiReview: true,
    retryRounds: 2,
  },
  "character-delete": {
    targetKind: "character",
    label: "角色",
    handler: "program",
    output: "none",
    programReview: false,
    aiReview: false,
    retryRounds: 0,
  },
  "costume-delete": {
    targetKind: "costume",
    label: "服装",
    handler: "program",
    output: "none",
    programReview: false,
    aiReview: false,
    retryRounds: 0,
  },
});

export const BUSINESS_DEFINITIONS = Object.freeze({
  ...NODE_DEFINITIONS,
  ...OPERATION_DEFINITIONS,
});

export const BUSINESS_TARGET = Object.freeze(
  Object.fromEntries(
    Object.entries(BUSINESS_DEFINITIONS).map(([business, definition]) => [
      business,
      definition.targetKind,
    ]),
  ),
);

export const NODE_TYPES = Object.freeze(Object.keys(NODE_DEFINITIONS));
export const TEXT_BUSINESSES = Object.freeze(
  Object.entries(BUSINESS_DEFINITIONS)
    .filter(([, definition]) => definition.handler === "text")
    .map(([business]) => business),
);
