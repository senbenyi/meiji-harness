import { parseSections } from '../../prompts/parse-sections.js';
import { assertPromptDialogue } from '../../../shared/dialogue-integrity.js';
import promptModel from '../../prompts/models/storyboard.js';
import { commonValues } from '../../prompts/inputs.js';

const output0 = {
  "type": "文本",
  "sections": ["integrated_multimodal_description", "overall_soundscape", "non_diegetic_music"],
  "requirements": "1. 只返回以下三段及其内容，不返回JSON、分镜时间表、解释或Markdown代码围栏；画面段用连贯自然段转写，不按秒分条、不以区间时间码逐行复制时间线：integrated_multimodal_description、overall_soundscape、non_diegetic_music。\n2. 三段正文及运镜描述使用语言要求指定的输出语言；固定段名不翻译，对白、旁白、心声、歌词和画面文字保留原文并按规则标记说话人。一句台词完整放在同一个<d>中，不能拆成多个片段；同一人物连续说多句台词时，可以全部放在一个<d>中，也可以在完整句子之间分开。不得因逐秒分镜、停顿或动作拆开一句台词。\n3. 忠实转写已审核的每秒分镜，不改事件、动作、人物、服装、时间线或时长。\n4. 环境声和非叙事配乐分别写入对应段落；无声时按节点规则输出。"
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
      本镜每秒分镜: input.storyboard,
      本镜参考时长秒: input.duration,
      本镜角色资料: input.characters,
    };
  },
  validateResult(value, input, action) { if (action !== 'review') assertPromptDialogue(input.storyboard, parseSections(value, output0.sections).integrated_multimodal_description); },
  actions: {
    generate: {
      input: {"language":"string","requirements":"string","storyboard":"object","duration":"number","characters":"array"},
      output: output0,
    },
    regenerate: {
      input: {"language":"string","requirements":"string","storyboard":"object","duration":"number","characters":"array","opinion":"string","content":["object","string"]},
      output: output0,
    },
    review: {
      input: {"language":"string","requirements":"string","storyboard":"object","duration":"number","characters":"array","opinion":"string","content":["object","string"]},
      output: output1,
    },
  },
};
