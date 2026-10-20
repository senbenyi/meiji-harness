import promptModel from '../../../shared/prompt-models/episode-scenes.js';
import { commonValues } from '../../prompts/inputs.js';
import { invalid } from '../../../shared/task_contract.js';
const output = { type: 'JSON', structure: { scenes: [{ id: '', name: '地点名称', description: '空间身份与风格', layout: '固定布局和地标', materials: '材质与色彩', lighting: '基础光源' }] }, requirements: '只返回上述JSON。新增场景id为空并填写完整资料；已有场景保留id，资料按本次已有场景维护范围处理。只提取反复出现、重要或用户明确要求固定的地点；一次性不重要地点不收录，没有符合条件的地点返回scenes:[]。按实际地点去重，不按镜头、机位、昼夜或天气增加条目。不得返回图片地址或节点状态。' };
const input = { language:'string', requirements:'string', segments:'array', scenes:'array', script:'string', updateExisting:['boolean','undefined'] };
export default { promptModel,
  compose: value => ({ ...commonValues(value), 分集改编:value.segments, 已有场景:value.scenes, 剧情上下文:value.script,
    已有场景维护范围: value.updateExisting
      ? '本次为原结果修订：允许按本次修改意见纠正已有场景资料，保留其ID；未涉及场景原样保留。只修正真实冲突并补足必要环境，不删除其他剧集场景。'
      : '本次已有场景只原样复用ID、名称及资料，不改写；只为新地点补全设定。需要纠正旧资料时使用原结果修订或人工编辑。' }),
  validateResult(value, input, action) {
    if (action === 'review') return;
    const ids = new Set(), names = new Set();
    for (const scene of value.scenes) {
      if (!scene.name.trim() || names.has(scene.name.trim()) || (scene.id && (ids.has(scene.id) || !input.scenes.some(item => item.id === scene.id)))) invalid('场景', '重复地点或无效场景ID，请合并并复用已有ID');
      names.add(scene.name.trim()); if (scene.id) ids.add(scene.id);
    }
  },
  actions: { generate:{input,output}, regenerate:{input:{...input,opinion:'string',content:'object'},output}, review:{input:{...input,opinion:'string',content:'object'},output:{type:'JSON',structure:{是否通过:true,原因:''},requirements:'只返回审核结果，通过原因为空，拒绝给具体地点及最小修复方向。'}} },
};
