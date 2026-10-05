// 功能技能注册信息。基础生产规则只读，正文只来自 task 的功能文件；
// 自审使用 review 目录中对应的审核 skill（reviewFile / reviewVariants），不复用生成规则。
export const stageCatalog = [
  { id: 'project-summary', kind: 'stage', label: '项目摘要提取', logLabel: '项目摘要', output: 'json', languageMode: 'story', fields: [], order: 0,
    fixedConstraints: true, constraintFile: 'generate-project-summary-skill.md', reviewFile: 'review-project-summary-skill.md' },
  {
    "id": "episode",
    "kind": "stage",
    "label": "剧集摘要",
    "logLabel": "本集剧情",
    "output": "json",
    "languageMode": "story",
    "fields": [],
    "order": 1,
    "fixedConstraints": true,
    "constraintFile": "generate-episode-summary-skill.md",
    "reviewFile": "review-episode-summary-skill.md"
  },
  {
    "id": "outline",
    "kind": "stage",
    "label": "剧情整包",
    "logLabel": "剧情大纲",
    "output": "json",
    "languageMode": "story",
    "panel": "outline",
    "assetStages": [
      "outline"
    ],
    "fields": [],
    "order": 2,
    "fixedConstraints": true,
    "constraintFile": "generate-story-outline-skill.md",
    "constraintVariants": {
      "outline": "generate-story-outline-skill.md",
      "characters": "extract-story-characters-skill.md",
      "scenes": "extract-story-scenes-skill.md",
      "props": "extract-story-props-skill.md"
    },
    "reviewFile": "review-story-outline-skill.md",
    "reviewVariants": {
      "outline": "review-story-outline-skill.md",
      "characters": "review-story-characters-skill.md",
      "scenes": "review-story-scenes-skill.md",
      "props": "review-story-props-skill.md"
    }
  },
  {
    "id": "shots",
    "kind": "stage",
    "label": "镜头表",
    "logLabel": "镜头表",
    "output": "json",
    "panel": "shots",
    "assetStages": [
      "shots"
    ],
    "related": [
      "shot-revise"
    ],
    "fields": [],
    "order": 3,
    "fixedConstraints": true,
    "constraintFile": "generate-shot-table-skill.md",
    "reviewFile": "review-shot-table-skill.md"
  },
  {
    "id": "shot-revise",
    "kind": "stage",
    "label": "单镜修订",
    "logLabel": "单镜修订",
    "output": "json",
    "panel": "shots",
    "assetStages": [
      "shots"
    ],
    "related": [
      "shots"
    ],
    "fields": [],
    "order": 4,
    "fixedConstraints": true,
    "constraintFile": "generate-shot-table-skill.md",
    "reviewFile": "review-shot-revision-skill.md"
  },
  {
    "id": "seconds",
    "kind": "stage",
    "label": "每秒指令",
    "logLabel": "每秒指令",
    "output": "text",
    "panel": "seconds",
    "assetStages": [
      "seconds"
    ],
    "fields": [],
    "order": 5,
    "fixedConstraints": true,
    "constraintFile": "generate-seconds-instructions-skill.md",
    "reviewFile": "review-seconds-instructions-skill.md"
  },
  {
    "id": "storyboard",
    "kind": "stage",
    "label": "多模态引用编排",
    "logLabel": "多模态引用编排",
    "output": "text",
    "panel": "storyboard",
    "assetStages": [
      "storyboard",
      "film"
    ],
    "fields": [],
    "order": 6,
    "fixedConstraints": true,
    "constraintFile": "generate-text-storyboard-skill.md",
    "reviewFile": "review-text-storyboard-skill.md"
  },
  {
    "id": "video",
    "kind": "stage",
    "label": "成片",
    "logLabel": "成片",
    "output": "video",
    "panel": "film",
    "fields": [],
    "order": 7,
    "fixedConstraints": true,
    "constraintFile": "generate-video-skill.md"
  },
  {
    "id": "image-prompt",
    "kind": "stage",
    "label": "图片提示词改写",
    "logLabel": "图片提示词",
    "output": "json",
    "fields": [],
    "order": 8,
    "fixedConstraints": true,
    "codeOnly": true,
    "reviewFile": "review-image-prompt-skill.md"
  },
  {
    "id": "character-image",
    "kind": "stage",
    "label": "人物参考图",
    "logLabel": "人物参考图",
    "output": "image",
    "fixedConstraints": true,
    "fields": [],
    "order": 9,
    "constraintFile": "generate-character-image-skill.md"
  },
  {
    "id": "scene-image",
    "kind": "stage",
    "label": "场景参考图",
    "logLabel": "场景参考图",
    "output": "image",
    "fields": [],
    "order": 10,
    "fixedConstraints": true,
    "constraintFile": "generate-scene-image-skill.md"
  },
  {
    "id": "part-image",
    "kind": "stage",
    "label": "道具图片",
    "logLabel": "道具图片",
    "output": "image",
    "fields": [],
    "order": 11,
    "fixedConstraints": true,
    "constraintFile": "generate-part-image-skill.md"
  }
]
