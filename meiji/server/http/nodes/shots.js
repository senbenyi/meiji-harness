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
        "scene_id": "", "scene_state": "本镜昼夜、天气及有依据的变化；无则为空", "scene_transition": "切换机位",
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
  "requirements": "1. 只返回上述JSON结构；字段只能为 title、id、scene_id、scene_state、scene_transition、duration_seconds、shot_scale、hook、body、continuity_transition、reference_anchor、audio_arrangement、on_screen_characters、background_characters 及其规定子字段。\n2. shots 必须为非空数组。每镜及两个嵌套对象的所有规定字段必须齐全；duration_seconds 为整数；on_screen_characters 为数组，每项仅含character_id、costume_id两个字符串；其余叶字段均为字符串。id为旧镜头ID或新增时的空字符串，禁止返回number、sequence或小段编号等额外字段。\n3. duration_seconds 为4至15秒整数；全表合计须同时符合故事小段合计取整±30秒和固定本集参考±30秒，以时长规划min_seconds/max_seconds交集为准；该范围只是通过条件，不逐层加时。修订意见涉及时长时先核对最新候选；纯数值分配错误只修正必要时长，真实节奏冲突才联动正文；已合规且正常可执行的段保留，不强制同时重写正文和时间。\n4. 钩子使用规则规定的枚举；无旁白、对白或音效时对应值为空字符串。\n5. 只返回完整镜头表，不附解释或Markdown代码围栏。\n6. scene_id只绑定本集场景目录；一次性不重要地点为空，不为绑定强建场景。scene_state仅描述本镜昼夜、天气等状态。scene_transition为连续接拍、切换机位或换场，跨地点不能连续接拍。\n7. " + shotJsonRules
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
  validateInput(input) {
    if (!input.segments.length || input.segments.some(part => !Number.isFinite(part?.duration_seconds) || part.duration_seconds <= 0))
      invalid('上游分集改编', '需要非空小段及有限正数预算');
    const total = input.segments.reduce((sum, part) => sum + part.duration_seconds, 0);
    if (Math.abs(total - input.duration) > 30)
      invalid('上游分集改编', `小段合计 ${total} 秒不在固定本集参考 ${input.duration} 秒±30秒内；请先修正大纲或人工调整本集参考时长，不继续让镜头表反复修订`);
  },
  compose(input) {
    return {
      ...commonValues(input),
      时长规划: shotsBudget(input.segments, input.duration),
      本集故事小段: input.segments,
      本集时长秒: input.duration,
      本集角色资料: input.characters,
      本集场景资料: input.scenes || [],
    };
  },
  normalizeResult(value, input, action) {
    const result = resolveShotPatch(value, input, output0.structure.shots[0], action);
    if (action !== 'review' && !input.scenes?.length && Array.isArray(result?.shots))
      for (const row of result.shots) { row.scene_id ??= ''; row.scene_state ??= ''; row.scene_transition ??= '切换机位'; }
    return result;
  },
  validateResult(value, input, action) {
    if (action === 'review') return;
    const issues = [];
    for (const [shotIndex, shot] of value.shots.entries()) {
      if (shot.on_screen_characters.length > 3)
        issues.push(`响应.shots[${shotIndex}].on_screen_characters（第${shotIndex + 1}镜 ${shot.title}）：实际出镜重要人物 ${shot.on_screen_characters.length} 人，单镜最多3人；请在同一小段内拆分镜头或调整真实可见范围，并同步正文、绑定、衔接和人物位置。不得仅删绑定却保留出镜动作，不删除原事件或原对白；不具名群演不计入。`);
      if (!['连续接拍','切换机位','换场'].includes(shot.scene_transition)) invalid('响应.scene_transition','需为连续接拍、切换机位或换场');
      if (shot.scene_id && !(input.scenes || []).some(scene => scene.id === shot.scene_id)) invalid('响应.scene_id','需引用本集已提取场景；一次性不重要地点为空');
      const seen = new Set();
      for (const [personIndex, row] of shot.on_screen_characters.entries()) {
        const person = input.characters.find(person => person.id === row.character_id);
        const at = `响应.shots[${shotIndex}].on_screen_characters[${personIndex}]（第${shotIndex + 1}镜 ${shot.title}）`;
        if (!person || seen.has(row.character_id)) {
          issues.push(`${at}：未知或重复人物ID ${row.character_id}；按本镜人物从目录原样复制完整ID，不拼接其他ID的尾段。同一人物只列一次。`);
          seen.add(row.character_id);
          continue;
        }
        seen.add(row.character_id);
        if (person.costumes.length ? !person.costumes.some(costume => costume.id === row.costume_id) : row.costume_id !== '')
          issues.push(`${at}.costume_id：服装需属于本人物${person.name}；错误值${row.costume_id}。有服装目录时必须指定一套，原样复制对应完整ID：${person.costumes.map(item => `${item.name}=${item.id}`).join('；') || '无服装目录，costume_id为空字符串'}；不修改剧情或换成其他人物。`);
      }
    }
    if (issues.length) {
      issues.push(`人物目录（姓名=完整character_id）：${input.characters.map(item => `${item.name}=${item.id}`).join('；')}`);
      if (Array.isArray(input.segments) && Number.isFinite(input.duration)) {
        const budget = shotsBudget(input.segments, input.duration), total = value.shots.reduce((sum, shot) => sum + shot.duration_seconds, 0);
        if (total < budget.min_seconds || total > budget.max_seconds || value.shots.some(shot => shot.duration_seconds < 4 || shot.duration_seconds > 15))
          issues.push(`同时核对时长：候选合计${total}秒，允许${budget.min_seconds}–${budget.max_seconds}秒，每镜4–15秒；引用错误不能遮蔽时长问题，须在同次修订处理。按真实剧情/对白补足镜头覆盖，不空等、不删原话。新增、拆并或重排用mode=replace返回完整表。`);
      }
      invalid('镜头表引用', issues.join('\n'));
    }
  },
  actions: {
    generate: {
      input: {"language":"string","requirements":"string","segments":"array","duration":"number","characters":"array","scenes":["array","undefined"]},
      output: output0,
    },
    regenerate: {
      input: {"language":"string","requirements":"string","segments":"array","duration":"number","characters":"array","scenes":["array","undefined"],"opinion":"string","content":"object"},
      output: { ...output0,
        patchStructure: { mode: 'patch', shots: [{ id: '已有镜头的非空完整ID', changes: { body: '只返回需要修改字段的新值' } }, { candidate_index: 0, title: 'id为空时从完整基稿原样复制本镜标题', changes: { body: '只返回需要修改字段的新值' } }] },
        requirements: '局部修订的两种定位形式互斥：已有非空唯一ID用id；id为空的新候选用candidate_index（完整基稿从0开始的数组位置）与原title共同定位，不含id。程序同时核对位置、标题及空ID状态。优先只返回出错镜头的changes，其他镜头和字段由程序保留，不要为修改一处重写全表。不能以空ID做patch、编造ID；定位用title须原样复制。以下原镜头表规则仅约束mode=replace全表中的镜头对象。局部patch允许shots为空，changes只包含所改字段。\n' + output0.requirements.replace('只返回完整镜头表', '增删、拆并或重排时用mode=replace并返回完整镜头表') + '\n局部修订返回mode=patch，逐项选择{id,changes}或{candidate_index,title,changes}；changes只含需要修改的字段；未返回镜头和字段由程序保留。嵌套字段修改时返回该嵌套对象完整值。不能修改ID；新增、删除、拆并、重排必须显式mode=replace并返回完整表。问题已解决可返回空patch。',
      },
    },
    review: {
      input: {"language":"string","requirements":"string","segments":"array","characters":"array","scenes":["array","undefined"],"duration":"number","opinion":"string","content":"object"},
      output: output1,
    },
  },
};
