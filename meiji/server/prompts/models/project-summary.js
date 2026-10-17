import { languageRule, reviewLanguageRule, reviewMethodRule, reviseScopeRule } from './common.js';
// 节点动作要求；输入/输出契约定义在 server/http/nodes。
// 本节点生成规则；重新生成与审核按需引用，避免逐动作复制。
const generateRules = {
  "基础规则": "1. 根据完整剧本写项目级简短摘要。\n2. 只保留剧本已经写出的人物、事件和结局。不补充剧本没有写明的动机、后传、画幅和总时长。\n3. 表述比剧本短。不写镜头和制作说明。",
};
export default {
  "generate": {
    "system": {
      "规则": generateRules,
      "语言要求": languageRule
    },
    "user": {
      "任务": "依据本次资料生成当前目标的项目摘要。",
      "背景信息": {
        "完整剧本": "{{完整剧本}}",
      },
      "补充需求": "{{补充需求}}"
    }
  },
  "regenerate": {
    "system": {
      "规则": {
        ...generateRules,
        "修改范围": reviseScopeRule,
      },
      "语言要求": languageRule
    },
    "user": {
      "任务": "依据本次资料和修改意见重新生成当前目标的项目摘要。",
      "修改意见": "{{修改意见}}"
    }
  },
  "review": {
    "system": {
      "规则": {
        "审核方式": reviewMethodRule,
        "基础规则": "1. 对照完整剧本检查项目摘要是否忠实概括设定、主要人物、核心冲突、关键发展与结局，是否有具体事实冲突、关键遗漏或凭空续写。只有能指出剧本与待审内容的实际差异才判为问题，不要求逐场复述。\n2. 不凭估计报告字符数超限。剧本未交代的内容不能要求补写。",
      },
      "语言要求": reviewLanguageRule
    },
    "user": {
      "任务": "审核当前目标最新的项目摘要。",
      "背景信息": {
        "完整剧本": "{{完整剧本}}",
      },
      "修改意见": "{{修改意见}}",
      "待审核内容": "{{待审核内容}}",
      "补充需求": "{{补充需求}}"
    }
  }
};
