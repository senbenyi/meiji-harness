import { invalid } from '../../../shared/task_contract.js';
import { validateShape } from '../validate-shape.js';
import promptModel from '../../prompts/models/seconds.js';
import { commonValues } from '../../prompts/inputs.js';

const output0 = {
  "type": "JSON",
  "structure": {
    "end_state": "最后一刻的人物、物件与环境状态",
    "pending_actions": "未完成动作；无则为空",
    "pending_dialogue": "未结束对白及发声进度；无则为空",
    "continuing_audio": "切点仍持续的声音与声源；无则为空",
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
  "requirements": "1. 仅返回上述JSON结构；顶层为 storyboard、end_state、pending_actions、pending_dialogue、continuing_audio；storyboard 节拍字段为 time_range、action、camera、space、audio、handoff、dialogue 及其 speaker_id、speaker_name、mode、dialogue_text。end_state 必须明确且非空；其他镜末事项没有时为空字符串。末段 handoff 留空，统一以顶层镜末字段记录跨镜交接。无对白时 dialogue 为 []。\n2. 从0秒起按镜头表参考时长连续覆盖；普通节拍按秒划分，只有钩子所在秒可包含亚秒节拍。\n3. 音频字段承载对应时间段的对白、旁白、音效、呼吸或无声；不新增镜头表没有的台词。\n4. 动作、镜头、空间及交接符合镜头表；不附解释或Markdown代码围栏。"
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
      前镜交接资料: input.previous,
      本集角色资料: input.characters,
      已确认出镜绑定: input.bindings,
    };
  },
  validateInput(input) {
    if (input.previous === null) return;
    validateShape(input.previous, { shot_number: '', end_state: '', pending_actions: '', pending_dialogue: '', continuing_audio: '', last_beats: output0.structure.storyboard }, '输入.previous');
    if (!input.previous.shot_number.trim() || !input.previous.end_state.trim() || !input.previous.last_beats.length)
      invalid('输入.previous', '前镜需有编号、结束状态和末尾节拍');
  },
  validateResult(value, input, action) {
    if (action !== 'review' && !value.end_state.trim()) invalid('响应.end_state', '结束状态不能为空');
  },
  actions: {
    generate: {
      input: {"language":"string","requirements":"string","shot":"object","characters":"array","bindings":"array","previous":["object","null"]},
      output: output0,
    },
    regenerate: {
      input: {"language":"string","requirements":"string","shot":"object","characters":"array","bindings":"array","previous":["object","null"],"opinion":"string","content":"object"},
      output: output0,
    },
    review: {
      input: {"language":"string","requirements":"string","shot":"object","characters":"array","bindings":"array","previous":["object","null"],"opinion":"string","content":"object"},
      output: output1,
    },
  },
};
