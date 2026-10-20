import { invalid } from '../../shared/task_contract.js';
import storyboard from './nodes/storyboard.js';
import { parseSections } from '../prompts/parse-sections.js';
import { videoPayload } from './llm-server/params.js';

const referenceSections = ['subject_definitions', 'summary', 'retention_analysis', 'detailed_description', 'overall_soundscape', 'non_diegetic_music'];

function shotMentions(text) {
  const found = [...String(text).matchAll(/\[Shot \d+\]/g)].map(match => match[0]);
  return [...new Set(found)].join(', ') || '[Shot 1]';
}

function tidyClauses(text) {
  return String(text || '').replace(/[。\s]*；[。\s]*/g, '；').replace(/。{2,}/g, '。').replace(/^[；。\s]+|[；。\s]+$/g, '').trim();
}

function withShot(text) {
  const body = String(text).trim();
  return /\[Shot \d+\]/.test(body) ? body : `[Shot 1] ${body}`;
}

function referenceEntries(bindings, description) {
  const shots = shotMentions(description).replaceAll(', ', '、');
  return bindings.map((row, index) => {
    const picture = `<Picture ${index + 1}>`, subject = `<Subject ${index + 1}>`;
    if (row?.kind === 'continuity') {
      if (typeof row.name !== 'string' || !row.name.trim()) invalid('输入.referenceBindings','衔接尾帧需标明来源镜头');
      return {
        definition: `${subject} 对应 ${picture}，是上一镜 ${row.name} 的尾帧，只提供本镜开场衔接的人物位置、朝向、姿态、持物与动作进度。人物身份和服装以对应人物图为准，固定场景布局以场景图为准，当前可见范围和机位以本镜已审核分镜为准。`,
        retention: `${subject}（仅本镜开场衔接）：参考 ${picture} 的结束状态，随后按本镜分镜推进动作和摄影。`,
      };
    }
    if (row?.kind === 'scene') {
      if (typeof row.name !== 'string' || !row.name.trim() || typeof row.description !== 'string' || typeof row.state !== 'string') invalid('输入.referenceBindings', '场景参考需含名称、固定设定与镜头状态');
      const space = tidyClauses(row.description);
      const preserved = space ? `保留空间布局、地标、材质与色彩：${space}。` : '保留空间布局、地标、材质与色彩。';
      return {
        definition: `${subject} 是 ${picture} 中的场景${JSON.stringify(row.name)}。${preserved}本镜状态：${row.state || '场景基础状态'}。光照和天气跟随本镜状态与动作；机位变化时固定空间保持一致。此图只提供空间。人物、开场画面和结尾画面以已审核镜头描述为准。`,
        retention: `${subject}（出现在 ${shots}）：fully_preserved - 保留 ${picture} 的空间布局、地标、材质和色彩。光照和天气跟随本镜状态。`,
      };
    }
    if (!row || ['name', 'speaker_tag', 'costume'].some(key => typeof row[key] !== 'string') || !row.name.trim()) invalid('输入.referenceBindings', '需包含人物姓名、说话人标记和服装说明');
    const speaker = row.speaker_tag ? row.speaker_tag : '';
    return {
      definition: `${subject} 是 ${picture} 中的${JSON.stringify(row.name)}${speaker}，服装为${JSON.stringify(row.costume || '本镜已固定的服装')}。此图只提供身份、面容、体型和本镜服装。`,
      retention: `${subject}（出现在 ${shots}）：fully_preserved - 保留 ${picture} 中的身份、面容、体型和服装。此图不提供背景或开场画面。`,
    };
  });
}

function labelize(text, bindings) {
  const pairs = bindings.map((row, index) => ({ name: row?.kind === 'continuity' ? '' : String(row?.name || '').trim(), label: `<Subject ${index + 1}>` }))
    .filter(pair => pair.name).sort((a, b) => b.name.length - a.name.length);
  return String(text).split(/(<d>[\s\S]*?<\/d>)/g).map(part => {
    if (part.startsWith('<d>')) return part;
    return pairs.reduce((out, pair) => out.split(pair.name).join(pair.label), part);
  }).join('');
}

function referencePrompt(bindings, parts) {
  const timeline = withShot(labelize(parts.integrated_multimodal_description.trim(), bindings));
  const entries = referenceEntries(bindings, timeline);
  const labels = entries.map((_, index) => `<Subject ${index + 1}>`);
  const continuity=bindings.findIndex(row=>row?.kind==='continuity');
  const opening=continuity<0 ? '参考图不是开场画面或结尾画面。' : `人物及场景图提供身份、服装与固定空间。本镜首帧衔接参考 <Picture ${continuity+1}>，随后按本镜分镜推进，不把尾帧中的机位锁定到全镜。`;
  const joined = labels.length === 1 ? labels[0] : `${labels.slice(0, -1).join('、')}和${labels.at(-1)}`;
  return [
    `subject_definitions:\n${entries.map(entry => entry.definition).join('\n')}`,
    `summary:\n[reference generation] 目标视频以 ${joined} 作为参考。${opening}动作、时间线和对白以已审核镜头描述为准。`,
    `retention_analysis:\n${entries.map(entry => entry.retention).join('\n')}`,
    `detailed_description:\n${timeline}`,
    `overall_soundscape:\n${parts.overall_soundscape.trim()}`,
    `non_diegetic_music:\n${parts.non_diegetic_music.trim()}`,
  ].join('\n\n');
}

function approvedTextMatches(packed, parts, keys, bindings) {
  try {
    const sections = parseSections(packed, referenceSections);
    const approved = parts.integrated_multimodal_description.trim();
    const expected = withShot(Array.isArray(bindings) ? labelize(approved, bindings) : approved);
    return sections.detailed_description === expected
      && sections.overall_soundscape === parts.overall_soundscape.trim()
      && sections.non_diegetic_music === parts.non_diegetic_music.trim();
  } catch { /* 已保存的旧编排仍是三段标题。 */ }
  try {
    const legacy = parseSections(packed, keys);
    return keys.every(key => legacy[key] === parts[key].trim());
  } catch {
    return false;
  }
}

// 原始audio可能包含比画面拍更短的发声区间，按原文传递而不将拍长当作对白时长。
function speechTimingText(rows) {
  if (rows === undefined) return '';
  if (!Array.isArray(rows)) invalid('输入.speechTiming','需为数组');
  for (const row of rows) {
    if (!row || typeof row.time_range !== 'string' || typeof row.audio !== 'string' ||
        !Array.isArray(row.speakers) || row.speakers.some(name=>typeof name !== 'string'))
      invalid('输入.speechTiming','需含画面节拍范围、声音安排与说话人列表');
  }
  if (!rows.length) return '';
  return '对白时序依据：仅约束下文已有对白，不新增或重说台词。画面节拍范围不是整段发声时长；具体发声起止沿用声音安排，未明确的秒数不推算。\n' +
    rows.map((row,index)=>`${index+1}. 画面节拍范围：${row.time_range}；发声者：${row.speakers.join('、')}；声音安排：${row.audio}`).join('\n');
}

// 程序编排：只使用已审核三段，不调用文本模型，不推断业务类型。
export function videoRequest(input, action = 'generate') {
  const keys = storyboard.actions.generate.output.sections;
  const parts = typeof input.textPrompt === 'string' ? parseSections(input.textPrompt, keys) : input.textPrompt;
  if (!parts || Object.keys(parts).length !== keys.length || keys.some(key => typeof parts[key] !== 'string' || !parts[key].trim()))
    invalid('输入.textPrompt', '需包含三个非空段落');
  const modes = { '文生': 'text', '首尾帧': 'first_frame', '多模态': 'reference' };
  if (!Object.hasOwn(modes, input.type)) invalid('输入.type', '需为文生、首尾帧或多模态');
  let body = typeof input.textPrompt === 'string' ? input.textPrompt : keys.map(key => `${key}:\n${parts[key]}`).join('\n\n');
  if (input.packedPrompt !== undefined) {
    if (input.type === '文生' || typeof input.packedPrompt !== 'string' || !input.packedPrompt.trim()) invalid('输入.packedPrompt', '仅素材模式可使用非空已保存编排正文');
    if (!approvedTextMatches(input.packedPrompt, parts, keys, input.referenceBindings)) invalid('输入.packedPrompt', '已保存编排中的三段正文与当前已审核文本不一致，请重新编排；不能改写对白或时间线');
    body = input.packedPrompt;
  } else if (input.type === '首尾帧') {
    body = '首帧为上一镜的尾帧，用作本镜0秒的开场画面。随后动作、运镜与声音按下文已审核分镜推进，本镜结尾画面落在分镜的最后一拍。\n\n' + body;
  }
  if (input.referenceBindings !== undefined) {
    if (input.type !== '多模态' || !Array.isArray(input.referenceBindings) || input.referenceBindings.length !== input.referenceImages?.length)
      invalid('输入.referenceBindings', '需按多模态参考图顺序一图一项');
    if (input.packedPrompt === undefined) body = referencePrompt(input.referenceBindings, parts);
  }
  const timing = speechTimingText(input.speechTiming);
  if (timing) body = `${timing}\n\n${body}`;
  if (action === 'regenerate') {
    if (typeof input.opinion !== 'string' || !input.opinion.trim()) invalid('输入.opinion', '修订意见不能为空');
    body += `\n\nRevision instructions:\n${input.opinion}`;
  }
  const request = { mode: modes[input.type], duration: input.duration, aspectRatio: input.aspectRatio, prompt: body,
    ...(input.firstFrame !== undefined ? { inputReference: input.firstFrame } : {}),
    ...(input.lastFrame !== undefined ? { lastFrame: input.lastFrame } : {}),
    ...(input.referenceImages !== undefined ? { referenceImages: [...input.referenceImages] } : {}) };
  try { videoPayload({ model: 'MiniMax-H3', ...request }); }
  catch (error) { invalid('视频请求', error.message); }
  return request;
}
