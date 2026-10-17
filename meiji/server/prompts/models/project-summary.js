import { languageRule, reviewLanguageRule, reviseScopeRule } from './common.js';
// 生成、修订、审核都用短规则。审核分类由 reviewPolicy 统一追加。
const generateRules = {
  基础规则: "1. 根据完整剧本写项目级简短摘要。\n2. 只保留剧本已经写出的人物、事件和结局。不补充剧本没有写明的动机、后传、画幅和总时长。\n3. 表述比剧本短。不写镜头和制作说明。",
};
export default {
  generate: {
    system: { 规则: generateRules, 语言要求: languageRule },
    user: {
      任务: "依据完整剧本生成项目摘要。",
      背景信息: { 完整剧本: "{{完整剧本}}" },
      补充需求: "{{补充需求}}",
    },
  },
  regenerate: {
    system: {
      规则: { ...generateRules, 修改范围: reviseScopeRule },
      语言要求: languageRule,
    },
    user: { 任务: "按修改意见修订项目摘要。", 修改意见: "{{修改意见}}" },
  },
  review: {
    system: {
      规则: {
        核对清单: "对照完整剧本。摘要应比剧本短，只保留已写出的人物、事件和结局。具体事实冲突、漏掉关键结局或凭空续写才拒绝。不要求逐场复述，不要求补写剧本没写的内容，不凭估计报字数。修改意见只用来核对上次的问题是否已解决。通过时原因留空。",
      },
      语言要求: reviewLanguageRule,
    },
    user: {
      任务: "审核当前目标最新的项目摘要。通过时原因留空。",
      背景信息: { 完整剧本: "{{完整剧本}}" },
      修改意见: "{{修改意见}}",
      待审核内容: "{{待审核内容}}",
      补充需求: "{{补充需求}}",
    },
  },
};
