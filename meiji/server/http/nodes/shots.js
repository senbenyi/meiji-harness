import promptModel from '../../prompts/models/shots.js';
import { commonValues } from '../../prompts/inputs.js';

const output0 = {
  "type": "JSON",
  "structure": {
    "shots": [
      {
        "title": "镜头标题",
        "number": "S01",
        "duration_seconds": 12,
        "shot_scale": "景别",
        "hook": "视觉笑点",
        "body": "镜头事件正文",
        "continuity_transition": "连续性衔接内容",
        "reference_anchor": {
          "fixed_landmark": "固定地标",
          "character_positions": "人物位置",
          "departed_characters": "离场角色",
          "lighting": "光位"
        },
        "audio_arrangement": {
          "narration": "旁白安排",
          "dialogue": "对白安排",
          "sound_effects": "音效安排"
        }
      }
    ]
  },
  "requirements": "1. 只返回上述JSON结构；字段只能为 title、number、duration_seconds、shot_scale、hook、body、continuity_transition、reference_anchor、audio_arrangement 及其规定子字段。\n2. shots 必须为非空数组。每镜及两个嵌套对象的所有规定字段必须齐全；除 duration_seconds 为整数外，各叶字段一律为字符串，不能返回数组、对象或null。不得返回id、sequence、角色ID或小段编号等额外字段。\n3. duration_seconds 为4至15秒整数；镜头总时长尽量接近本集参考时长。\n4. 钩子使用规则规定的枚举；无旁白、对白或音效时对应值为空字符串。\n5. 只返回完整镜头表，不附解释或Markdown代码围栏。"
};

const output1 = {
  "type": "JSON",
  "structure": {
    "是否通过": true,
    "原因": ""
  },
  "requirements": "1. 仅返回符合上述结构的JSON，不附解释、修订正文或Markdown代码围栏。\n2. “是否通过”为 true 或 false。为 true 时“原因”为空字符串，为 false 时逐项指出小段序号、镜头编号、原文依据、实际差异及最小修正方向，不输出修订镜头表。"
};

export default {
  promptModel,
  compose(input) {
    return {
      ...commonValues(input),
      本集故事小段: input.segments,
      本集时长秒: input.duration,
      本集角色资料: input.characters,
      已有镜头编号目录: input.shotNumbers,
    };
  },
  actions: {
    generate: {
      input: {"language":"string","rules":"array","requirements":"string","segments":"array","duration":"number","characters":"array","shotNumbers":"array"},
      output: output0,
    },
    regenerate: {
      input: {"language":"string","rules":"array","requirements":"string","segments":"array","duration":"number","characters":"array","shotNumbers":"array","opinion":"string","content":"object"},
      output: output0,
    },
    review: {
      input: {"language":"string","rules":"array","requirements":"string","segments":"array","characters":"array","duration":"number","opinion":"string","content":"object"},
      output: output1,
    },
  },
};
