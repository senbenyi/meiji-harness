import { nodeAction } from './ai-routes.js';
import { nodeRoutes } from './nodes/index.js';
import { BUSINESS_DEFINITIONS } from '../../shared/node-definitions.js';

function text(value) {
  if (typeof value === 'string') return value;
  if (!value) return '';
  return Object.entries(value).map(([key, child]) => `${key}：\n${typeof child === 'object' ? text(child) : child}`).join('\n\n');
}

// 只读投影当前规则，不渲染项目资料，不构造或发送模型请求。
export function nodeRules(business) {
  const route = Object.hasOwn(nodeRoutes, business) && nodeRoutes[business];
  const definition = BUSINESS_DEFINITIONS[business];
  if (!route || !definition || definition.retired)
    throw Object.assign(new Error('AI 节点不存在'), { status: 404 });
  const action = name => {
    const resolved = route.actions[name] ? nodeAction(business, name) : null;
    const stage = resolved?.route.promptModel?.[name];
    const output = resolved?.contract.output;
    return stage ? [text(stage.system), stage.user?.任务 ? `任务：\n${stage.user.任务}` : '', output ? `输出要求：\n${output.requirements}` : ''].filter(Boolean).join('\n\n') : '';
  };
  const program = definition.programReview ? '本节点另有程序审核，按节点结构、时长或引用约束判定。' : '';
  return {
    business, label: definition.label,
    generate: action('generate') || (business === 'video'
      ? '使用已审核的分镜提示词三个段落原文生成本镜视频。文生直接提交；首尾帧以前镜尾帧为首帧；多模态使用本镜角色与服装参考图。按本镜时长与项目画幅提交，不再调用文本模型改写提示词。'
      : '本节点没有生成规则。'),
    revise: action('regenerate') || (business === 'video' ? '按本次修改意见修订视频请求，保留已审核三段原文及对应类型的参考素材。' : ''),
    review: [definition.aiReview ? action('review') : '本节点没有 AI 审核。', program].filter(Boolean).join('\n\n'),
  };
}
