import { languageRule, reviewLanguageRule, reviseScopeRule } from './common.js';
// 生成、修订、审核都用短规则。审核分类由 reviewPolicy 统一追加。
const generateRules = {
  基础规则: "1. 只依据【本集剧情】提取简短剧集摘要。只写本集剧情里已经发生的事件。\n2. 不补充本集剧情没有写出的情节，不写入后续镜头或角色安排。表述比本集剧情短。",
};
export default {
  generate: {
    system: { 规则: generateRules, 语言要求: languageRule },
    user: {
      任务: "根据本集剧情生成简短剧集摘要，不新增、修改或规划剧情。",
      背景信息: { 本集剧情: "{{本集剧情}}" },
      补充需求: "{{补充需求}}",
    },
  },
  regenerate: {
    system: {
      规则: { ...generateRules, 修改范围: reviseScopeRule },
      语言要求: languageRule,
    },
    user: { 任务: "按本集剧情和修改意见修订剧集摘要，不新增或规划剧情。", 修改意见: "{{修改意见}}" },
  },
  review: {
    system: {
      规则: {
        核对清单: "只对照本集剧情。摘要应比剧情短，只写已经发生的事。新增或改变人物、关系、事件、因果或结尾才拒绝，并引用两边原文。允许省略细节。不用完整剧本、创作方向或历史摘要当剧情来源。修改意见只用来核对上次的问题是否已解决。通过时原因留空。",
      },
      语言要求: reviewLanguageRule,
    },
    user: {
      任务: "按核对清单审核剧集摘要。通过时原因留空。",
      背景信息: { 本集剧情: "{{本集剧情}}" },
      修改意见: "{{修改意见}}",
      待审核内容: "{{待审核内容}}",
      补充需求: "{{补充需求}}",
    },
  },
};
