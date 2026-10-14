import promptModel from '../../prompts/models/seconds.js';
import { commonValues } from '../../prompts/inputs.js';

const output0 = {
  "type": "JSON",
  "structure": {
    "storyboard": [
      {
        "time_range": "0–1s",
        "action": "动作内容",
        "camera": "镜头内容",
        "space": "空间内容",
        "audio": "音频内容",
        "handoff": "交接状态",
        "dialogue": [
          {
            "speaker_id": "",
            "speaker_name": "说话人",
            "mode": "画内",
            "dialogue_text": "台词"
          }
        ]
      }
    ]
  },
  "requirements": "1. 仅返回上述JSON结构；字段只能为 time_range、action、camera、space、audio、handoff、dialogue 及其 speaker_id、speaker_name、mode、dialogue_text。无对白时 dialogue 为 []。\n2. 从0秒起按镜头表参考时长连续覆盖；普通节拍按秒划分，只有钩子所在秒可包含亚秒节拍。\n3. 音频字段承载对应时间段的对白、旁白、音效、呼吸或无声；不新增镜头表没有的台词。\n4. 动作、镜头、空间及交接符合镜头表；不附解释或Markdown代码围栏。"
};

const output1 = {
  "type": "JSON",
  "structure": {
    "是否通过": true,
    "原因": ""
  },
  "requirements": "1. 仅返回符合上述结构的JSON，不附解释、修订正文或Markdown代码围栏。\n2. “是否通过”为 true 或 false。为 true 时“原因”为空字符串，为 false 时写明具体问题。"
};

export default {
  promptModel,
  compose(input) {
    return {
      ...commonValues(input),
      本镜镜头表: input.shot,
      本集角色资料: input.characters,
      已确认出镜绑定: input.bindings,
    };
  },
  actions: {
    generate: {
      input: {"language":"string","requirements":"string","shot":"object","characters":"array","bindings":"array"},
      output: output0,
    },
    regenerate: {
      input: {"language":"string","requirements":"string","shot":"object","characters":"array","bindings":"array","opinion":"string","content":"object"},
      output: output0,
    },
    review: {
      input: {"language":"string","requirements":"string","shot":"object","characters":"array","bindings":"array","opinion":"string","content":"object"},
      output: output1,
    },
  },
};
