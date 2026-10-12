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
  "project-summary": {
    targetKind: "project",
    field: "项目摘要",
    label: "项目摘要",
    handler: "text",
    output: "text",
    review: true,
    precheck: "project-text",
  },
  "project-characters": {
    targetKind: "project",
    field: "角色库",
    label: "剧本重要角色",
    handler: "text",
    output: "text",
    review: true,
    precheck: "project-text",
  },
  "character-image": {
    targetKind: "character",
    field: "图片",
    label: "角色图",
    handler: "media",
    output: "image",
    review: false,
    precheck: null,
  },
  "costume-image": {
    targetKind: "costume",
    field: "图片",
    label: "服装图",
    handler: "media",
    output: "image",
    review: false,
    precheck: "costume-image",
  },
  "episode-summary": {
    targetKind: "episode",
    field: "摘要",
    label: "展示摘要",
    handler: "text",
    output: "text",
    review: true,
    precheck: "episode-summary",
  },
  outline: {
    targetKind: "episode",
    field: "故事大纲",
    label: "剧情",
    handler: "text",
    output: "text",
    review: true,
    precheck: "outline",
  },
  shots: {
    targetKind: "episode",
    field: "镜头表",
    label: "镜头表",
    handler: "text",
    output: "text",
    review: true,
    precheck: "shots",
  },
  seconds: {
    targetKind: "shot",
    field: "每秒分镜",
    label: "每秒分镜",
    handler: "text",
    output: "text",
    review: true,
    precheck: "shots-input",
  },
  storyboard: {
    targetKind: "shot",
    field: "文本提示词",
    label: "分镜提示词",
    handler: "text",
    output: "text",
    review: true,
    precheck: "storyboard",
  },
  video: {
    targetKind: "shot",
    field: "视频",
    label: "视频",
    handler: "media",
    output: "video",
    review: false,
    precheck: "video",
  },
  tail: {
    targetKind: "shot",
    field: "尾帧",
    label: "尾帧与实际时长",
    handler: "media",
    output: "image",
    review: false,
    precheck: "tail",
  },
  assembly: {
    targetKind: "episode",
    field: "合片",
    label: "合片",
    handler: "media",
    output: "video",
    review: false,
    precheck: "assembly",
  },
});

export const OPERATION_DEFINITIONS = freezeDefinitions({
  script: {
    targetKind: "project",
    label: "剧本",
    handler: "text",
    output: "text",
    review: true,
  },
  "script-split": {
    targetKind: "project",
    label: "拆分剧集",
    handler: "text",
    output: "episodes",
    review: false,
  },
  "character-delete": {
    targetKind: "character",
    label: "角色",
    handler: "program",
    output: "none",
    review: false,
  },
  "costume-delete": {
    targetKind: "costume",
    label: "服装",
    handler: "program",
    output: "none",
    review: false,
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
