import { invalid } from '../../shared/task_contract.js';

const sources = {
  'script-split': ['剧本'], 'project-summary': ['剧本'], 'project-characters': ['剧本'],
  'episode-scenes': ['分集改编', '场景资料'], 'episode-summary': ['本集剧情'], outline: ['原始剧本', '全集规划', '本集规划', '前集实际剧情'], shots: ['分集改编', '角色资料', '场景资料'],
  seconds: ['镜头表', '前镜交接', '角色资料'], storyboard: ['节拍分镜', '镜头表', '角色资料'],
};
export const REVIEW_TYPES = ['上游资料问题', '模型问题', '规则问题', '其他'];

export function reviewPolicy(node, action, route, contract) {
  if (action !== 'review' || contract.output?.structure?.是否通过 !== true) return { route, contract };
  const allowed = sources[node] || [];
  const rule = `审核只返回是否通过、类型、原因三个字段，不返回问题数组。通过时类型和原因均为空字符串。拒绝时类型必须为${REVIEW_TYPES.join('、')}之一，原因一次写清全部成立的问题、对象/位置、依据和可执行处理方向，不再维护第二份问题清单。\n类型按问题根因判断：上游资料问题=实际输入本身存在事实矛盾或缺少本节点无法合法补全的必需资料；模型问题=输入资料及规则有效，但被审核的候选遗漏、写错或未按规则执行；规则问题=要求之间有明确冲突、含糊或无法同时满足；其他=无法明确判断属于前三类的问题。不得为填类型臆造问题，合规时直接通过。\n上游资料来源只能为本次输入的${allowed.join('、') || '实际资料'}，原因须指明来源、位置并引用该来源中真实的连续原文，说明为什么本节点不能合法修复。不能借其他来源的文字证明该来源有错，不把候选自身错误、个人偏好、没有参考图、允许补全的细节或按规则排除无名人物归为上游资料问题。规则问题须指出具体矛盾规则；候选没有遵守清楚的规则属于模型问题，不能伪报规则冲突。其他须说明具体异常及无法归类的原因，不能空泛写不确定。\n同时有多类问题时，类型优先级为规则问题、上游资料问题、其他、模型问题，原因仍一次写全，不遗漏独立问题。上游资料问题、规则问题和其他会停止本节点自动改写，禁止要求模型杜撰或改写上游事实来绕过阻断。对照最新候选核实历史意见，已解决项和违反纳入规则的旧意见不继续报错；原因内部不得一边确认合规、一边据此拒绝。`;
  const stage = route.promptModel.review;
  const output = { ...contract.output,
    structure: { 是否通过: true, 类型: '', 原因: '' },
    requirements: contract.output.requirements + '\n只返回上述三字段JSON，不附说明或代码围栏。是否通过为布尔值；通过时类型和原因均为空字符串；不通过时类型为' + REVIEW_TYPES.join('、') + '之一，原因非空并按“审核分类”写清具体依据及处理方向。',
  };
  return {
    route: { ...route, promptModel: { ...route.promptModel, review: { ...stage,
      system: { ...stage.system, 规则: { ...stage.system.规则, 审核分类: rule } },
    } } },
    contract: { ...contract, output },
  };
}

export function validateReviewIssues(node, value, input) {
  if (typeof value.类型 !== 'string' || (value.是否通过 ? value.类型 !== '' : !REVIEW_TYPES.includes(value.类型)))
    invalid('响应.类型', '通过时为空字符串；拒绝时为上游资料问题、模型问题、规则问题或其他');
}
