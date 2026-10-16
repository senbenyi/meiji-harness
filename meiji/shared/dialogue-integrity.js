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
  const lines = (storyboard.storyboard || []).flatMap(beat => beat.dialogue).filter(line => line.dialogue_text);
  if (!lines.length) return;
  const expected = lines.map(line => line.dialogue_text).join('');
  const fragments = [...text.matchAll(/<d>([\s\S]*?)<\/d>/g)].map(match => match[1]);
  try {
    if (fragments.join('') !== expected) mismatch(expected, fragments.join(''), '最终提示词<d>对白序列');
    const { boundaries, speakerChanges } = promptDialogueBoundaries(lines);
    let offset = 0;
    for (const [index, fragment] of fragments.entries()) {
      const start = offset;
      offset += fragment.length;
      if (speakerChanges.some(at => at > start && at < offset)) invalid('对白完整性', `第${index + 1}个<d>合并了不同说话人或心声/实际发声通道；每个人物及心声与实际发声必须分别标记。`);
      if (!fragment.trim() || !boundaries.has(offset)) {
        invalid('对白完整性', `第${index + 1}个<d>在第${offset}个字符处拆开了一句台词，附近原话=${JSON.stringify(expected.slice(Math.max(0, offset - 15), offset + 15))}。一句台词必须完整放在同一个<d>中，不能拆成多个片段；同一人物连续说多句台词时，可以全部放在一个<d>中，也可以在完整句子之间分开。请合并同句片段，停顿与动作写在标签外，不改原文字词和标点，不补写下一镜。`);
      }
    }
  } catch (error) { error.validationKind = 'dialogue-preservation'; throw error; }
}

function promptDialogueBoundaries(lines) {
  // 先跨节拍恢复同一人的连续发言；dialogue_text 的字段边界不是句子边界。
  const runs = [];
  for (const line of lines) {
    // 画内/画外转换不意味着换人或一句话结束。
    const speaker = JSON.stringify([line.speaker_id || line.speaker_name || '', line.mode === '心声' ? '心声' : '实际发声']);
    if (runs.at(-1)?.speaker === speaker) runs.at(-1).text += line.dialogue_text;
    else runs.push({ speaker, text: line.dialogue_text });
  }
  const boundaries = new Set(), speakerChanges = [], segmenter = new Intl.Segmenter('zh', { granularity: 'sentence' });
  let offset = 0;
  for (const run of runs) {
    for (const { segment, index } of segmenter.segment(run.text)) {
      const trimmed = segment.trimEnd();
      // 句末标点连同闭引号保留；逗号、省略号、破折号不能单独证明完整句。
      // ICU 会将部分英文称谓缩写识别为句尾，这里保守地不允许从这些点断开。
      if (/[。！？.!?][。！？.!?"”’」』）)]*$/u.test(trimmed)
          && !/(?:\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|vs|etc)|\b[A-Za-z]|(?:\b[A-Za-z]\.)+[A-Za-z])\.["”’」』）)]*$/iu.test(trimmed)) {
        boundaries.add(offset + index + trimmed.length);
        boundaries.add(offset + index + segment.length);
      }
    }
    offset += run.text.length;
    // 换人或本镜末尾的原始片段可完整保留，不强行补句号或越镜续写。
    boundaries.add(offset);
    if (run !== runs.at(-1)) speakerChanges.push(offset);
  }
  return { boundaries, speakerChanges };
}
