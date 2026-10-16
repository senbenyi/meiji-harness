import { resolveShotPatch } from '../shot-patch.js';
import { shotsBudget } from '../../prompts/duration-policy.js';
import promptModel, { shotJsonRules } from '../../prompts/models/shots.js';
import { invalid } from '../../../shared/task_contract.js';
import { commonValues } from '../../prompts/inputs.js';

const output0 = {
  "type": "JSON",
  "structure": {
    "shots": [
      {
        "title": "镜头标题",
        "id": "",
        "duration_seconds": 12,
        "shot_scale": "景别",
        "hook": "视觉笑点",
        "body": "镜头事件正文，明确出镜人物、表演及已知服装",
        "on_screen_characters": [{ "character_id": "", "costume_id": "" }],
        "background_characters": "不具名群演及其可见行为；无则为空",
        "continuity_transition": "连续性衔接内容",
        "reference_anchor": {
          "fixed_landmark": "固定地标",
          "character_positions": "人物位置",
          "departed_characters": "离场角色",
          "lighting": "光位"
        },
        "audio_arrangement": {
          "narration": "旁白安排",
          "dialogue": "对白安排",
          "sound_effects": "音效安排"
        }
      }
    ]
  },
  "requirements": "1. 只返回上述JSON结构；字段只能为 title、id、duration_seconds、shot_scale、hook、body、continuity_transition、reference_anchor、audio_arrangement、on_screen_characters、background_characters 及其规定子字段。\n2. shots 必须为非空数组。每镜及两个嵌套对象的所有规定字段必须齐全；duration_seconds 为整数；on_screen_characters 为数组，每项仅含character_id、costume_id两个字符串；其余叶字段均为字符串。id为旧镜头ID或新增时的空字符串，禁止返回number、sequence或小段编号等额外字段。\n3. duration_seconds 为4至15秒整数；全表合计与故事小段合计取整相差不超过30秒即可通过，该范围只是通过条件。修订意见涉及时长时先核对最新候选；纯数值分配错误只修正必要时长，真实节奏冲突才联动正文；已合规且正常可执行的段保留，不强制同时重写正文和时间。\n4. 钩子使用规则规定的枚举；无旁白、对白或音效时对应值为空字符串。\n5. 只返回完整镜头表，不附解释或Markdown代码围栏。\n6. " + shotJsonRules
};

const output1 = {
  "type": "JSON",
  "structure": {
    "是否通过": true,
    "原因": ""
  },
  "requirements": "1. 仅返回符合上述结构的JSON，不附解释、修订正文或Markdown代码围栏。\n2. “是否通过”为 true 或 false。为 true 时“原因”为空字符串，为 false 时逐项指出小段序号、镜头数组位置或id、原文依据、实际差异及最小修正方向，不输出修订镜头表。"
};

export default {
  promptModel,
  compose(input) {
    return {
      ...commonValues(input),
      时长规划: shotsBudget(input.segments),
      本集故事小段: input.segments,
      本集时长秒: input.duration,
      本集角色资料: input.characters,
    };
  },
  normalizeResult(value, input, action) { return resolveShotPatch(value, input, output0.structure.shots[0], action); },
  validateResult(value, input, action) {
    if (action === 'review') return;
    for (const shot of value.shots) {
      const seen = new Set();
      for (const row of shot.on_screen_characters) {
        const person = input.characters.find(person => person.id === row.character_id);
        if (!person || seen.has(row.character_id)) invalid('响应.on_screen_characters', '未知或重复人物ID');
        seen.add(row.character_id);
        if (person.costumes.length ? !person.costumes.some(costume => costume.id === row.costume_id) : row.costume_id !== '')
          invalid('响应.costume_id', '服装需属于本人物；有服装目录时必须指定一套');
      }
    }
  },
  actions: {
    generate: {
      input: {"language":"string","requirements":"string","segments":"array","duration":"number","characters":"array"},
      output: output0,
    },
    regenerate: {
      input: {"language":"string","requirements":"string","segments":"array","duration":"number","characters":"array","opinion":"string","content":"object"},
      output: { ...output0,
        patchStructure: { mode: 'patch', shots: [{ id: '完整基稿中的镜头ID', changes: { body: '只返回需要修改字段的新值' } }] },
        requirements: '本修订动作优先使用另列局部修订结构；以下原镜头表规则仅约束mode=replace全表中的镜头对象。局部patch允许shots为空，changes只包含所改字段。\n' + output0.requirements.replace('只返回完整镜头表', '增删、拆并或重排时用mode=replace并返回完整镜头表') + '\n局部修订优先返回mode=patch及shots[{id,changes}]，changes只含需要修改的字段；未返回镜头和字段由程序保留。嵌套字段修改时返回该嵌套对象完整值。不能修改ID；新增、删除、拆并、重排必须显式mode=replace并返回完整表。问题已解决可返回空patch。',
      },
    },
    review: {
      input: {"language":"string","requirements":"string","segments":"array","characters":"array","duration":"number","opinion":"string","content":"object"},
      output: output1,
    },
  },
};
