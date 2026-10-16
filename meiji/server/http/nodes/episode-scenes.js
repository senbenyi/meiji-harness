import promptModel from '../../prompts/models/episode-scenes.js';
import { commonValues } from '../../prompts/inputs.js';
import { invalid } from '../../../shared/task_contract.js';
const output = { type: 'JSON', structure: { scenes: [{ id: '', name: '地点名称', description: '空间身份与风格', layout: '固定布局和地标', materials: '材质与色彩', lighting: '基础光源' }] }, requirements: '只返回上述JSON。新增场景id为空，已有场景原样复用id。只提取反复出现、重要或用户明确要求固定的地点；一次性不重要地点不收录，没有符合条件的地点返回scenes:[]。按实际地点去重，不按镜头、机位、昼夜或天气增加条目。不得返回图片地址或节点状态。' };
const input = { language:'string', requirements:'string', segments:'array', scenes:'array', script:'string' };
export default { promptModel,
  compose: value => ({ ...commonValues(value), 故事大纲:value.segments, 已有场景:value.scenes, 剧情上下文:value.script }),
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
