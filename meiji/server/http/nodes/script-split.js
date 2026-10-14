import promptModel from '../../prompts/models/script-split.js';
import { commonValues } from '../../prompts/inputs.js';
import { numberedScript } from '../../handlers/script-split.js';

const output0 = {
  "type": "JSON",
  "structure": {
    "剧集": [
      {
        "序号": 1,
        "起始段落": "P001",
        "结束段落": "P012",
        "预估时长秒": 150
      }
    ]
  },
  "requirements": "1. 仅返回符合上述结构的JSON，不附解释、剧本正文或Markdown代码围栏。\n2. 序号从1连续递增；起始段落、结束段落使用【编号剧本】中的段落编号，同一集内起始段落不晚于结束段落；预估时长秒为正整数。\n3. 每次返回完整剧集数组，包括未修改的剧集；第一集从P001开始，每集起始编号等于上一集结束编号加1，最后一集覆盖编号剧本的最后一段。"
};

export default {
  promptModel,
  compose(input) {
    return {
      ...commonValues(input),
      编号剧本: numberedScript(input.script),
      参考单集时长秒: input.duration,
    };
  },
  actions: {
    generate: {
      input: {"language":"string","requirements":"string","script":"string","duration":"number","opinion":"string"},
      output: output0,
    },
    regenerate: {
      input: {"language":"string","requirements":"string","script":"string","duration":"number","opinion":"string","content":"object"},
      output: output0,
    },
  },
};
