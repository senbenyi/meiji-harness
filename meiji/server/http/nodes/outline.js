import { outlineBudget } from '../../prompts/duration-policy.js';
import promptModel from '../../prompts/models/outline.js';
import { commonValues } from '../../prompts/inputs.js';

const output0 = {
  "type": "JSON",
  "structure": {
    "segments": [
      {
        "sequence": 1,
        "duration_seconds": 1,
        "body": "本段完整剧情（含必要的合理补充）",
        "causal": "与前后段的承接，无明确承接可为空"
      }
    ]
  },
  "requirements": "仅返回 JSON，不附解释或 Markdown 围栏。sequence 从 1 连续递增；duration_seconds 为有限正数，允许小数；body 为完整剧情的非空字符串；causal 为字符串。先规划并锁定段数、顺序和逐段时长，duration_seconds 合计以本集参考时长为目标，允许上下30秒，选择可正常呈现的总量并锁定，再以各段自身已锁定的 duration_seconds 为时间约束，保留对应原剧情，并在原剧情明显不足以匹配允许范围下限时补充合理情节，填写 body 与 causal；整集参考时长仅用于规划分配和总和校验，填充阶段不重新估时。每项剧情必须保留在 body；仅输出最终完整 segments，不输出规划草稿或计算过程。"
};

const output1 = {
  "type": "JSON",
  "structure": {
    "是否通过": true,
    "原因": ""
  },
  "requirements": "仅返回 JSON，不附解释或 Markdown 围栏。是否通过为布尔值；通过时原因为空，未通过时写明原文事实冲突、补充不合理或内容与时长不匹配的具体问题；不得仅因合理补充没有逐句原文依据而拒绝。"
};

export default {
  promptModel,
  compose(input) {
    return {
      ...commonValues(input),
      时长规划: outlineBudget(input.duration),
      本集剧情: input.plot,
      本集时长秒: input.duration,
      本集要求: input.requirements,
    };
  },
  actions: {
    generate: {
      input: {"language":"string","requirements":"string","plot":"string","duration":"number"},
      output: output0,
    },
    regenerate: {
      input: {"language":"string","requirements":"string","plot":"string","duration":"number","opinion":"string","content":"object"},
      output: output0,
    },
    review: {
      input: {"language":"string","requirements":"string","plot":"string","duration":"number","opinion":"string","content":"object"},
      output: output1,
    },
  },
};
