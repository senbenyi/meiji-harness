import { splitBudget } from '../../prompts/duration-policy.js';
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
    ],
    "排除段落": ["P002"]
  },
  "requirements": "1. 仅返回符合上述结构的JSON，不附解释、剧本正文或Markdown代码围栏。\n2. 序号从1连续递增；起始段落、结束段落使用【编号剧本】中的段落编号，同一集内起始段落不晚于结束段落；预估时长秒为正整数。\n3. 每次返回完整剧集数组和排除段落。剧集按原文顺序排列且起止范围互不重叠；排除段落不得重复。每一个段落编号要么落在某一集的起止范围内，要么列入排除段落。落在范围内又被排除的段落不写入该集剧情。没有无关内容时排除段落为空数组。"
};

export default {
  promptModel,
  compose(input) {
    return {
      ...commonValues(input),
      时长规划: splitBudget(input.duration),
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
    review: {
      input: {language:"string", requirements:"string", script:"string", duration:"number", opinion:"string", content:"object"},
      output: {
        type: "JSON",
        structure: {"是否通过": true, "原因": ""},
        requirements: "只返回JSON。是否通过为布尔值，通过时原因为空；拒绝时一次列出具体剧集、P编号、对白/剧情/动作的容量冲突及最小切点或估时修正方向。不按字数换算，不输出修订切点数组。",
      },
    },
  },
};
