import { invalid } from './task_contract.js';

// 仅抽取有成对引号的明确原话；不从叙述中推断台词，不据字数推时长。
export function quotedSpeech(text) {
  const pairs = { '“': '”', '「': '」', '『': '』', '"': '"' }, rows = [];
  let start = -1, stack = [];
  for (let at = 0; at < String(text).length; at++) {
    const ch = text[at];
    if (!stack.length && pairs[ch]) { start = at; stack.push(pairs[ch]); }
    else if (stack.length) {
      if (ch === stack.at(-1)) stack.pop();
      else if (pairs[ch]) stack.push(pairs[ch]);
      if (!stack.length) rows.push({ text: text.slice(start + 1, at), start, end: at + 1 });
    }
  }
  return rows;
}
function mismatch(expected, actual, label) {
  let at = 0;
  while (at < expected.length && expected[at] === actual[at]) at++;
  invalid('对白完整性', `${label}在第${at + 1}个字符处不同；原话片段=${JSON.stringify(expected.slice(Math.max(0, at - 10), at + 25))}，候选片段=${JSON.stringify(actual.slice(Math.max(0, at - 10), at + 25))}。逐字保留标点、顺序及说话内容，不删句、不重复播放；可跨节拍分配，不改语速凑时长。`);
}
export function assertShotDialogue(shot, node) {
  const source = shot.audio_arrangement.dialogue, quotes = quotedSpeech(source).filter(q => q.text);
  if (!quotes.length) return;
  const actual = node.storyboard.flatMap(beat => beat.dialogue).map(line => line.dialogue_text).join('');
  let cursor = 0;
  for (const quote of quotes) {
    const at = actual.indexOf(quote.text, cursor);
    if (at < 0) mismatch(quote.text, actual.slice(cursor), '明确原对白缺失、改写或顺序不符，');
    cursor = at + quote.text.length;
  }
  // 只有全部对白来源可确定、且无另行旁白时，才比较整个发声序列，防止误判未知旁白。
  let previous = 0;
  const labelsOnly = quotes.every(q => {
    const prefix = source.slice(previous, q.start); previous = q.end;
    return /^\s*[,，;；]?\s*(?:[^：:“”「」『』\n]{1,24}[:：]\s*)?$/u.test(prefix);
  }) && /^[\s。.!！?？,，;；]*$/u.test(source.slice(previous));
  if (labelsOnly && !shot.audio_arrangement.narration.trim()) {
    const expected = quotes.map(q => q.text).join('');
    if (actual !== expected) mismatch(expected, actual, '完整发声序列');
  }
}
export function assertPromptDialogue(storyboard, text) {
  // 节拍已有结构化原话，最终提示词应保留原话（可以把相邻节拍碎片合成同一引号）。
  const dialogue = (storyboard.storyboard || []).flatMap(beat => beat.dialogue).map(line => line.dialogue_text).filter(Boolean);
  for (const original of new Set(dialogue)) if (!text.includes(original)) {
    const error = Object.assign(new Error(`对白完整性：分镜提示词缺少原话 ${JSON.stringify(original)}；保留原标点，不改写或概括台词。`), {
      code: 'INVALID_CONTRACT', status: 422, validationKind: 'dialogue-preservation',
    });
    throw error;
  }
}
