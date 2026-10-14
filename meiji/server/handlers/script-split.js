import { invalid } from "../../shared/task_contract.js";

// 剧本按行切成段落：空行并入上一段，保证所有段落按顺序拼接后与原文逐字一致。
export function scriptParagraphs(text) {
  const paragraphs = [];
  for (const line of String(text).split(/(?<=\n)/)) {
    if (!line) continue;
    const last = paragraphs.length - 1;
    if (last >= 0 && (!line.trim() || !paragraphs[last].trim()))
      paragraphs[last] += line;
    else paragraphs.push(line);
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
export function buildSplit(text, raw) {
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
    next = skip(end + 1);
    const plot = paragraphs.slice(start, end + 1).filter((_, offset) => !excluded.has(start + offset)).join("");
    if (!plot.trim()) coverageErrors.push(`第${row.序号}集：没有可写入的剧情`);
    return { sequence: row.序号, duration_seconds: row.预估时长秒, plot };
  });
  if (next !== paragraphs.length)
    coverageErrors.push(`最后一集未到剧本结尾：遗漏${paragraphNumber(next)}—${paragraphNumber(paragraphs.length - 1)}；结束段落应为${paragraphNumber(paragraphs.length - 1)}`);
  if (coverageErrors.length) invalid("拆分剧集", coverageErrors.join('\n'));
  const kept = paragraphs.filter((_, at) => !excluded.has(at)).join("");
  if (episodes.map((e) => e.plot).join("") !== kept)
    invalid("拆分剧集", "拼接结果与归入剧集的段落不一致");
  return { episodes };
}
