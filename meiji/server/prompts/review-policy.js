import { invalid } from '../../shared/task_contract.js';

const sources = {
  'script-split': ['剧本'], 'project-summary': ['剧本'], 'project-characters': ['剧本'],
  'episode-scenes': ['故事大纲', '场景资料'], 'episode-summary': ['本集剧情'], outline: ['本集剧情'], shots: ['故事大纲', '角色资料', '场景资料'],
  seconds: ['镜头表', '前镜交接', '角色资料'], storyboard: ['节拍分镜', '镜头表', '角色资料'],
};
export function reviewPolicy(node, action, route, contract) {
  if (action !== 'review' || contract.output?.structure?.是否通过 !== true) return { route, contract };
  const allowed = sources[node] || [];
  const rule = `拒绝时附加问题数组，一次列出本轮仍存在的问题；每项为修复范围（本节点或上游）、来源、位置、依据、建议。来源只能为${['本节点', ...allowed].join('、')}。候选遗漏/写错属于本节点；只有输入事实本身矛盾或缺少执行必需资料且本节点不能合法修复时才标上游。上游依据必须来自所声明来源中的一段连续原文，不能借其他来源的文字证明该来源有错；不加自写段号、解释或引号。解释写在建议，不把缺少参考图、个人偏好或候选自身错误标为上游。上游问题应给出来源和具体位置，不能要求下游杜撰修补。对照最新候选核实历史意见；已解决项不重复报。通过时问题为空数组或省略。`;
  const stage = route.promptModel.review;
  const output = { ...contract.output,
    optionalStructure: { 问题: [{ 修复范围: '本节点', 来源: '本节点', 位置: '小段/镜头/节拍位置', 依据: '实际原文', 建议: '最小修复方向' }] },
    requirements: contract.output.requirements + '\n拒绝时按“修复定位”规则填写问题数组；通过时问题为空数组或省略。',
  };
  return {
    route: { ...route, promptModel: { ...route.promptModel, review: { ...stage,
      system: { ...stage.system, 规则: { ...stage.system.规则, 修复定位: rule } },
    } } },
    contract: { ...contract, output },
  };
}
export function validateReviewIssues(node, value, input) {
  if (!Object.hasOwn(value, '问题')) return;
  if (!Array.isArray(value.问题) || (value.是否通过 && value.问题.length) || (!value.是否通过 && !value.问题.length))
    invalid('响应.问题', '通过时应为空，拒绝时列出具体问题');
  for (const issue of value.问题) {
    if (!['本节点', '上游'].includes(issue.修复范围)) invalid('响应.问题.修复范围', '仅允许本节点或上游');
    if (!['本节点', ...(sources[node] || [])].includes(issue.来源) || (issue.修复范围 === '上游' && issue.来源 === '本节点'))
      invalid('响应.问题.来源', '需为本节点实际输入来源；上游不得指向本节点');
    if (issue.修复范围 === '上游') {
      const { shot_setup, ...beats } = input.storyboard || {};
      const source = { 剧本: input.script, 本集剧情: input.plot, 故事大纲: input.segments,
        镜头表: input.shot || shot_setup, 前镜交接: input.previous,
        节拍分镜: input.storyboard == null ? undefined : beats, 角色资料: input.characters, 场景资料: input.scenes }[issue.来源];
      if (source == null) invalid('响应.问题.来源', '本次没有提供该上游资料，不能虚构上游阻断');
      const leaves = value => typeof value === 'string' ? [value] : value && typeof value === 'object' ? Object.values(value).flatMap(leaves) : [];
      if (!leaves(source).some(text => text.includes(issue.依据))) invalid('响应.问题.依据', '需引用所声明来源中的真实上游资料连续原文，不能借用其他来源');
    }
    for (const key of ['位置', '依据', '建议']) if (!issue[key].trim()) invalid(`响应.问题.${key}`, '需明确具体内容');
  }
}
