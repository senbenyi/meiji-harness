import promptModel from '../../prompts/models/shot-characters.js';
import { commonValues } from '../../prompts/inputs.js';
import { invalid, assertRecord } from '../../../shared/task_contract.js';
import { validateShape } from '../validate-shape.js';

const input = { language: 'string', rules: 'array', requirements: 'string', shot: 'object', characters: 'array', previous: ['object', 'string'] };
const output = { type: 'JSON', structure: { on_screen_characters: [{ character_number: '', costume_number: '' }] },
  requirements: '只返回本镜实际出镜的人物及服装编号。编号来自输入目录；未出镜、仅声音或仅提及的人物排除。确认无人时返回空数组。人物无服装目录时 costume_number 为空字符串，有服装目录时必须确定一套已有服装；不得用空值代替未确定。' };
const review = { type: 'JSON', structure: { 是否通过: true, 原因: '' }, requirements: '通过时原因为空字符串，不通过时写明具体问题。' };

function validateBindings(value, input) {
  validateShape(value, output.structure);
  const seen = new Set();
  for (const row of value.on_screen_characters) {
    const person = input.characters.find(item => item.number === row.character_number);
    if (!person || seen.has(row.character_number)) invalid('响应.on_screen_characters', '未知或重复人物编号');
    seen.add(row.character_number);
    if (person.costumes.length ? !person.costumes.some(item => item.number === row.costume_number) : row.costume_number !== '')
      invalid('响应.costume_number', '服装需属于该人物；仅无服装目录时允许为空');
  }
}

export default {
  promptModel,
  compose(input) {
    return { ...commonValues(input), 本镜内容: input.shot, 角色服装目录: input.characters, 前镜穿着依据: input.previous };
  },
  validateInput(value) {
    const seen = new Set();
    for (const person of value.characters) {
      assertRecord(person, '输入.characters[]');
      if (typeof person.number !== 'string' || !person.number.trim() || seen.has(person.number) || typeof person.name !== 'string' || !person.name.trim() || !Array.isArray(person.costumes)) invalid('输入.characters', '需为编号唯一且含姓名及服装目录的人物');
      seen.add(person.number);
      const costumes = new Set();
      for (const costume of person.costumes) {
        assertRecord(costume, '输入.costumes[]');
        if (typeof costume.number !== 'string' || !costume.number.trim() || costumes.has(costume.number) || typeof costume.name !== 'string') invalid('输入.costumes', '服装需有唯一编号及名称');
        costumes.add(costume.number);
      }
    }
    // 候选可以含识别错误，交由审核/修订；这里只检验它的结构。
    if (value.content !== undefined) validateShape(value.content, output.structure, '输入.content');
  },
  validateResult(value, input, action) { if (action !== 'review') validateBindings(value, input); },
  actions: {
    generate: { input, output },
    regenerate: { input: { ...input, content: 'object', opinion: 'string' }, output },
    review: { input: { ...input, content: 'object', opinion: 'string' }, output: review },
  },
};
