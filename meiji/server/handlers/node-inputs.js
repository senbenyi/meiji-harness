import { shotTextInputs, characterTextCatalog } from '../../shared/shot-text-inputs.js';
import { nodeOf, locateTarget } from '../../shared/task_contract.js';
import { shotCharacterContext } from '../../shared/node-dependencies.js';
import { aiProjection } from './content.js';
import { scriptParagraphs, paragraphNumber } from './script-split.js';
import { nodeAction } from '../http/ai-routes.js';
import { reviewType } from '../../shared/task-plan.js';

function shotTable(value) {
  const fields = ['title', 'id', 'duration_seconds', 'shot_scale', 'hook', 'body', 'continuity_transition', 'reference_anchor', 'audio_arrangement', 'on_screen_characters', 'background_characters'];
  return { shots: (value?.shots || []).map(shot => Object.fromEntries(fields.map(key => [key, structuredClone(shot[key])]))) };
}

function candidate(business, value) {
  if (['project-summary', 'episode-summary', 'script-review'].includes(business)) return typeof value === 'string' ? value : value?.body || '';
  if (business === 'project-characters') {
    const fields = ['name', 'gender', 'era', 'position', 'age_range', 'body_type', 'hairstyle', 'signature_props', 'immutable_traits'];
    return { characters: (value?.changes || value?.characters || []).map(character => ({
      ...Object.fromEntries(fields.map(key => [key, character[key]])),
      costumes: character.costumes.map(costume => Object.fromEntries(['name', 'color', 'material', 'props'].map(key => [key, costume[key]]))),
    })) };
  }
  if (business === 'shots') return shotTable(value);
  return aiProjection(value || {});
}

function contiguousSplit(project) {
  let start = 0;
  return {
    剧集: [...project.episodes].sort((a, b) => a.sequence - b.sequence).map(episode => {
      const count = scriptParagraphs(episode.plot).length;
      const row = { 序号: episode.sequence, 起始段落: paragraphNumber(start), 结束段落: paragraphNumber(Math.max(start, start + count - 1)), 预估时长秒: episode.duration_seconds };
      start += count;
      return row;
    }),
    排除段落: [],
  };
}

// 上一版剧情是原文段落去掉排除项后的拼接。对回完整剧本时，范围内部未写入的编号也记为排除段落。
function previousSplit(project) {
  const paragraphs = scriptParagraphs(project.script.body);
  const episodes = [...project.episodes].sort((a, b) => a.sequence - b.sequence);
  if (!episodes.length) return { 剧集: [], 排除段落: [] };
  let cursor = 0;
  const rows = [];
  const excluded = [];
  for (const episode of episodes) {
    const piece = scriptParagraphs(episode.plot);
    if (!piece.length) return contiguousSplit(project);
    const consumed = [];
    let pieceAt = 0;
    for (let i = cursor; i < paragraphs.length && pieceAt < piece.length; i++)
      if (paragraphs[i] === piece[pieceAt]) { consumed.push(i); pieceAt++; }
    if (pieceAt !== piece.length) return contiguousSplit(project);
    const start = consumed[0];
    const end = consumed[consumed.length - 1];
    while (cursor < start) excluded.push(paragraphNumber(cursor++));
    for (let at = start; at <= end; at++)
      if (!consumed.includes(at)) excluded.push(paragraphNumber(at));
    rows.push({ 序号: episode.sequence, 起始段落: paragraphNumber(start), 结束段落: paragraphNumber(end), 预估时长秒: episode.duration_seconds });
    cursor = end + 1;
  }
  while (cursor < paragraphs.length) excluded.push(paragraphNumber(cursor++));
  return { 剧集: rows, 排除段落: excluded };
}

// 各节点独立提取执行时资料；不向节点接口传入 project/snapshot。
const inputs = {
  'script-review': ({ project }) => ({ script: project.script.body }),
  'project-summary': ({ project }) => ({ script: project.script.body }),
  'project-characters': ({ project }) => ({ script: project.script.body, characters: characterTextCatalog(project) }),
  'script-split': ({ project }) => ({ script: project.script.body, duration: project.reference_episode_duration_seconds }),
  'episode-summary': ({ episode }) => ({ plot: episode.plot }),
  outline: ({ episode }) => ({ plot: episode.plot, duration: episode.duration_seconds, requirements: episode.episode_requirements || '' }),
  shots: ({ project, episode }) => ({ segments: episode.story_outline.segments, duration: episode.duration_seconds,
    characters: shotCharacterContext(project) }),
  seconds: ({ project, episode, object }) => shotTextInputs(project, episode, object, 'seconds'),
  storyboard: ({ project, episode, object }) => shotTextInputs(project, episode, object, 'storyboard'),
};

export function taskNodeInput(snapshot, task, draft, action, step = {}, language = "zh-CN") {
  const project = snapshot.project, business = task.business_type;
  const target = locateTarget(project, business, task.target_id);
  const value = { language, requirements: project.creative_direction || '',
    ...inputs[business]({ project, ...target }) };
  if (action === 'generate' && business === 'script-split') value.opinion = task.opinion || '';
  else if (action === 'generate' && task.opinion?.trim())
    value.requirements = [value.requirements, task.opinion.trim()].filter(Boolean).join('\n');
  if (action !== 'generate') {
    const steps = snapshot.steps || [];
    const rejectedReviews = steps.filter(row => row.task_id === task.id && row.kind === 'review' && row.step_status === 'rejected' && row.seq < (step.seq ?? Infinity)).sort((a, b) => b.seq - a.seq);
    const lastReview = rejectedReviews[0];
    // 程序拒绝会跳过本轮AI审核，不能因此丢失上一轮尚未复审的业务意见。
    const priorAiReview = step.kind === 'revise' && lastReview?.name && reviewType(lastReview) === 'program'
      ? rejectedReviews.find(row => row.name && reviewType(row) === 'ai') : null;
    const priorOpinion = priorAiReview && `此前AI审核意见（对照最新候选核查，已解决项不重复修改；同时满足本轮程序审核）：\n${priorAiReview.result?.原因 || priorAiReview.error_reason}`;
    value.opinion = [...new Set([step.kind === 'revise' ? lastReview?.result?.原因 || lastReview?.error_reason : '', priorOpinion, task.opinion].filter(Boolean).flatMap(value => value.split('\n')).map(value => value.trim()).filter(Boolean))].join('\n');
    const source = action === 'review' ? draft : draft || nodeOf(project, business, task.target_id);
    value.content = candidate(business, source);
    if (business === 'script-split') {
      const previous = (snapshot.tasks || []).filter(row => row.id !== task.id && row.business_type === business).sort((a, b) => b.queue_order - a.queue_order)[0];
      const rejected = previous?.task_status === 'rejected' && steps.filter(row => row.task_id === previous.id && ['generate', 'revise'].includes(row.kind) && row.step_status === 'done').sort((a, b) => b.seq - a.seq)[0]?.result;
      value.content = draft || (task.opinion && rejected) || previousSplit(project);
    }
  }
  // 剧本审核没有待审候选时审核当前剧本。
  if (business === 'script-review' && action === 'review' && !value.content) value.content = project.script.body;
  if (action === 'regenerate' && step.kind === 'revise') {
    const previous = (snapshot.steps || []).filter(row => row.task_id === task.id
      && ['generate', 'revise'].includes(row.kind) && row.step_status === 'done'
      && row.seq < step.seq).sort((a, b) => b.seq - a.seq)[0];
    if (previous) value.content = structuredClone(previous.result);
  }
  const { contract } = nodeAction(business, action);
  return Object.fromEntries(Object.keys(contract.input).map(key => [key, value[key]]));
}
