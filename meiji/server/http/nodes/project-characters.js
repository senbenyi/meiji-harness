import promptModel from '../../prompts/models/project-characters.js';
import { commonValues } from '../../prompts/inputs.js';

const output0 = {
  "type": "JSON",
  "structure": {
    "characters": [
      {
        "name": "角色姓名",
        "gender": "性别（必填；无依据时填未明确）",
        "era": "年代（必填；无依据时填未明确）",
        "position": "角色定位",
        "age_range": "年龄段",
        "body_type": "身材描述",
        "hairstyle": "发型描述",
        "signature_props": [
          "签名道具"
        ],
        "immutable_traits": [
          "不可改特征"
        ],
        "costumes": [
          {
            "name": "服装名称",
            "color": "服装颜色",
            "material": "服装材质",
            "props": [
              "随服装出现的道具"
            ]
          }
        ]
      }
    ]
  },
  "requirements": "1. 只返回上述JSON结构；只列本次新增或变更的角色，无变更时 characters 为空数组；没有明确服装时 costumes 为 []。\n2. 角色及服装字段严格遵守上述源结构；不在返回中生成ID、编号、图片地址或额外字段，由程序保留、分配并维护。\n3. 不附解释或Markdown代码围栏。\n4. signature_props、immutable_traits、costumes[].props 必须为字符串数组，每项一条；没有内容时返回 []。禁止将这些字段返回为字符串、对象或 null。其余人物和服装资料字段按结构返回字符串。"
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
      完整剧本: input.script,
      项目角色库目录: input.characters,
    };
  },
  actions: {
    generate: {
      input: {"language":"string","requirements":"string","script":"string","characters":"array"},
      output: output0,
    },
    regenerate: {
      input: {"language":"string","requirements":"string","script":"string","characters":"array","opinion":"string","content":"object"},
      output: output0,
    },
    review: {
      input: {"language":"string","requirements":"string","script":"string","characters":"array","opinion":"string","content":"object"},
      output: output1,
    },
  },
};
