import { splitBudget } from "../prompts/duration-policy.js";
import { scriptText } from "../../shared/script-text.js";
import { invalid } from "../../shared/task_contract.js";

// 编号是完整句/完整发言的候选切点，不是强制分集；字符与空白全部保留。
export function scriptParagraphs(text) {
  text = scriptText(text);
  const paragraphs = [], quotes = [];
  const pairs = { '“': '”', '「': '」', '『': '』' };
  let pending = '';
  for (const line of String(text).split(/(?<=\n)/)) {
    // 剧本格式的一整行发言保留完整，不从发言内部断句。
    const speech = /^[^：:“”「」『』\n]{1,20}[:：]/u.test(line.trim()) && !/[“「『"]/u.test(line);
    for (let at = 0; at < line.length; at++) {
      const ch = line[at];
      pending += ch;
      let closed = false;
      if (ch === quotes.at(-1)) { quotes.pop(); closed = true; }
      else if (pairs[ch]) quotes.push(pairs[ch]);
      else if (ch === '"') quotes.push('"');
      const end = !quotes.length && ((!speech && (/[。！？!?；;]/u.test(ch) || closed)) || ch === '\n');
      if (end) {
        if (pending.trim()) paragraphs.push(pending);
        else if (paragraphs.length) paragraphs[paragraphs.length - 1] += pending;
        else continue;
        pending = '';
      }
    }
  }
  if (pending) {
    if (!pending.trim() && paragraphs.length) paragraphs[paragraphs.length - 1] += pending;
    else paragraphs.push(pending);
  }
  return paragraphs;
}
export const paragraphNumber = (index) =>
  `P${String(index + 1).padStart(3, "0")}`;

// 发给 AI 的编号剧本是完整原文，只用于定位切点，不判断、不删除内容。
export function numberedScript(text) {
  return scriptParagraphs(text)
    .map((p, i) => `${paragraphNumber(i)} ${p.trim()}`)
    .join("\n");
}

function exclusionSet(raw, index) {
  const list = raw.排除段落 ?? [];
  if (!Array.isArray(list)) invalid("拆分剧集.排除段落", "需为数组");
  const excluded = new Set();
  for (const id of list) {
    const at = index.get(id);
    if (at === undefined) invalid("拆分剧集.排除段落", `${id} 不存在`);
    if (excluded.has(at)) invalid("拆分剧集.排除段落", `${id} 重复`);
    excluded.add(at);
  }
  return excluded;
}

// 校验 AI 返回的起止段落并按段落原文拼出各集剧情。排除段落由模型指定，程序不判断内容。
export function buildSplit(text, raw, referenceDuration) {
  const paragraphs = scriptParagraphs(text);
  if (!paragraphs.length) invalid("拆分剧集", "剧本为空");
  const index = new Map(paragraphs.map((_, i) => [paragraphNumber(i), i]));
  const excluded = exclusionSet(raw, index);
  const rows = raw.剧集;
  if (!Array.isArray(rows) || !rows.length) invalid("拆分剧集", "没有返回剧集");
  const skip = (from) => {
    let at = from;
    while (excluded.has(at)) at++;
    return at;
  };
  let next = skip(0);
  const coverageErrors = [];
  const capacityErrors = [];
  const budget = referenceDuration === undefined ? null : splitBudget(referenceDuration);
  const episodes = rows.map((row, i) => {
    if (row.序号 !== i + 1) invalid("拆分剧集.序号", "需从1连续递增");
    const start = index.get(row.起始段落),
      end = index.get(row.结束段落);
    if (start === undefined || end === undefined)
      invalid(`第${row.序号}集`, "段落编号不存在");
    if (start !== next) {
      const expected = next < paragraphs.length ? paragraphNumber(next) : '剧本已结束，不应再有剧集';
      coverageErrors.push(`第${row.序号}集：${start > next ? `段落有遗漏（${paragraphNumber(next)}—${paragraphNumber(start - 1)}）` : '段落重叠或倒序'}；起始段落应为${expected}，实际为${row.起始段落}`);
    }
    if (end < start) invalid(`第${row.序号}集`, "结束段落早于起始段落");
    if (!Number.isInteger(row.预估时长秒) || row.预估时长秒 < 1)
      invalid(`第${row.序号}集.预估时长秒`, "需为正整数");
    const units = paragraphs.slice(start, end + 1).filter((_, offset) => !excluded.has(start + offset));
    if (budget && row.预估时长秒 > budget.max_seconds)
      capacityErrors.push(`第${row.序号}集（${row.起始段落}—${row.结束段落}）预估${row.预估时长秒}秒，超过参考${budget.target_seconds}秒的容量上限${budget.max_seconds}秒；请在范围内完整句/发言结束处提前切集并增加集数，重新估时；同一情景允许跨集。所有集（含末集和单个编号单位）均须满足上下限；若无法合法重切，说明不可行原因及需调整的参考时长或原剧本。不得仅调小预估数字、删减剧情或加速对白。`);
    if (budget && row.预估时长秒 < budget.min_seconds)
      capacityErrors.push(`第${row.序号}集（${row.起始段落}—${row.结束段落}）预估${row.预估时长秒}秒，低于参考${budget.target_seconds}秒的容量下限${budget.min_seconds}秒；请按原文顺序接续后续剧情，或回溯相邻集重新分配段落、合并并重切，按对白、剧情和动作重新估时，所有集均须在${budget.min_seconds}—${budget.max_seconds}秒内，末集不例外。同一情景允许跨集，短情景可衔接下一情景；不得只调大数字、拆开完整发言、补写剧情或空等填充。若无法合法重切，说明不可行原因及需调整的参考时长或原剧本。`);
    next = skip(end + 1);
    const plot = units.join("");
    if (!plot.trim()) coverageErrors.push(`第${row.序号}集：没有可写入的剧情`);
    return { sequence: row.序号, duration_seconds: row.预估时长秒, plot };
  });
  if (next !== paragraphs.length)
    coverageErrors.push(`最后一集未到剧本结尾：遗漏${paragraphNumber(next)}—${paragraphNumber(paragraphs.length - 1)}；结束段落应为${paragraphNumber(paragraphs.length - 1)}`);
  if (capacityErrors.length) coverageErrors.push(...capacityErrors);
  if (coverageErrors.length) invalid("拆分剧集", coverageErrors.join('\n'));
  const kept = paragraphs.filter((_, at) => !excluded.has(at)).join("");
  if (episodes.map((e) => e.plot).join("") !== kept)
    invalid("拆分剧集", "拼接结果与归入剧集的段落不一致");
  return { episodes };
}

// 最近一次未通过的拆分任务的候选：未结束组内的任务在工作快照，已结束的经 snapshot.history 查数据库。
export function rejectedSplitCandidate(snapshot, task) {
  const live = (snapshot.tasks || [])
    .filter((row) => row.id !== task.id && row.business_type === "script-split" && row.target_id === task.target_id && row.task_status === "rejected")
    .sort((a, b) => b.queue_order - a.queue_order)[0];
  const stored = snapshot.history?.latestTask("script-split", task.target_id, task.id, "rejected") || null;
  const previous = !live ? stored : !stored || live.queue_order >= stored.queue_order ? live : stored;
  const steps = previous ? (snapshot.steps || []).filter((row) => row.task_id === previous.id) : [];
  const result = (steps.length ? steps : previous ? snapshot.history?.stepsOf(previous.id) || [] : [])
    .filter((row) => ["generate", "revise"].includes(row.kind) && row.step_status === "done")
    .sort((a, b) => b.seq - a.seq)[0]?.result;
  if (!result || !Array.isArray(result.剧集)) invalid("人工放行", "没有可收下的切分候选");
  return result;
}
