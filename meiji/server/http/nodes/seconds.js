import { invalid } from '../../../shared/task_contract.js';
import { validateShape } from '../validate-shape.js';
import promptModel from '../../prompts/models/seconds.js';
import { commonValues } from '../../prompts/inputs.js';

const output0 = {
  "type": "JSON",
  "structure": {
    "end_state": "最后一刻的人物、物件与环境状态",
    "pending_actions": "未完成动作；无则为空",
    "pending_dialogue": "尚未发声且明确需要跨镜继续的原话；已说内容不重抄，被打断且无后续则为空",
    "continuing_audio": "切点仍持续的声音与声源；无则为空",
    "storyboard": [
      {
        "time_range": "0–2s",
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
  "requirements": "1. 仅返回上述JSON结构；顶层为 storyboard、end_state、pending_actions、pending_dialogue、continuing_audio；storyboard 节拍字段为 time_range、action、camera、space、audio、handoff、dialogue 及其 speaker_id、speaker_name、mode、dialogue_text。end_state 必须明确且非空；其他镜末事项没有时为空字符串。末段 handoff 留空，统一以顶层镜末字段记录跨镜交接。无对白时 dialogue 为 []。目录内说话人的 speaker_id 必须原样使用角色ID，speaker_name 只作显示；目录外人物及独立旁白的 speaker_id 为空，不生成ID。\n2. 从0秒起按节拍连续覆盖，末段结束时间等于镜头表参考时长；节拍长度按一个主要动作或一段持续状态决定，不固定为1秒或其他范围；普通短动作可用亚秒节拍，有依据的持续状态可跨多秒。time_range 是节拍起止，不是切镜；机位未变要在 camera 写明，只有真正换机位才写剪辑切镜和新机位，跨秒停留在 action 写明保持什么。关键发声、接触、结果时点可写在拍内，不机械拆格。\n3. dialogue_text仅承载原台词、旁白或心声，不新增镜头表没有的台词。语气、节奏、可见嘴部状态和听者反应写action；audio写发声时点、声源、音效、呼吸或静默/延续，不重抄原话，不增加表演字段。\n4. 动作、镜头、空间及交接符合镜头表；不附解释或Markdown代码围栏。"
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
      镜头表出镜绑定: input.shot.on_screen_characters,
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
      input: {"language":"string","requirements":"string","shot":"object","characters":"array","previous":["object","null"]},
      output: output0,
    },
    regenerate: {
      input: {"language":"string","requirements":"string","shot":"object","characters":"array","previous":["object","null"],"opinion":"string","content":"object"},
      output: output0,
    },
    review: {
      input: {"language":"string","requirements":"string","shot":"object","characters":"array","previous":["object","null"],"opinion":"string","content":"object"},
      output: output1,
    },
  },
};
