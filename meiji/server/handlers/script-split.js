import { invalid } from "../../shared/task-contract.js";

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

// 发给 AI 的编号剧本：每段一行，只用于定位切点，不作为写回内容。
export function numberedScript(text) {
  return scriptParagraphs(text)
    .map((p, i) => `${paragraphNumber(i)} ${p.trim()}`)
    .join("\n");
}

// 校验 AI 返回的起止段落并按段落原文拼出各集剧情；不改动任何文字。
export function buildSplit(text, raw) {
  const paragraphs = scriptParagraphs(text);
  if (!paragraphs.length) invalid("拆分剧集", "剧本为空");
  const index = new Map(paragraphs.map((_, i) => [paragraphNumber(i), i]));
  const rows = raw.剧集;
  if (!rows.length) invalid("拆分剧集", "没有返回剧集");
  let next = 0;
  const episodes = rows.map((row, i) => {
    if (row.序号 !== i + 1) invalid("拆分剧集.序号", "需从1连续递增");
    const start = index.get(row.起始段落),
      end = index.get(row.结束段落);
    if (start === undefined || end === undefined)
      invalid(`第${row.序号}集`, "段落编号不存在");
    if (start !== next)
      invalid(
        `第${row.序号}集`,
        start > next ? "段落有遗漏" : "段落重叠或倒序",
      );
    if (end < start) invalid(`第${row.序号}集`, "结束段落早于起始段落");
    if (!Number.isInteger(row.预估时长秒) || row.预估时长秒 < 1)
      invalid(`第${row.序号}集.预估时长秒`, "需为正整数");
    next = end + 1;
    return {
      序号: row.序号,
      时长秒: row.预估时长秒,
      剧情: paragraphs.slice(start, end + 1).join(""),
    };
  });
  if (next !== paragraphs.length) invalid("拆分剧集", "最后一集未到剧本结尾");
  if (episodes.map((e) => e.剧情).join("") !== String(text))
    invalid("拆分剧集", "拼接结果与原剧本不一致");
  return { 剧集: episodes };
}
