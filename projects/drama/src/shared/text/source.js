import {randomUUID} from 'node:crypto'
export const PAGE_CHARS=12000
function nextBoundary(text,start,limit){
  let end=Math.min(text.length,start+limit)
  if(end<text.length){const newline=text.lastIndexOf('\n',end-1);if(newline>start+limit-1500)end=newline+1;else{const tail=text.slice(Math.max(start,end-1500),end),matches=[...tail.matchAll(/[。！？.!?][”’」』]?/g)];if(matches.length)end=Math.max(start,end-1500)+matches.at(-1).index+matches.at(-1)[0].length}if(/[\uD800-\uDBFF]/.test(text[end-1])&&/[\uDC00-\uDFFF]/.test(text[end]))end--}
  return end
}
export function sourceChapters(text,previous=[]){
  if(typeof text!=='string'||!text.trim())throw new TypeError('原稿不能为空')
  const headings=[...text.matchAll(/(?:^|\n)([^\S\r\n]*(?:(?:第[零〇一二两三四五六七八九十百千万0-9]+[章节回幕卷部场集])|(?:chapter\s+\d+)|(?:序章|序言|楔子|尾声|终章))[^\r\n]{0,90})/gim)].map(m=>({start:m.index+(m[0].startsWith('\n')?1:0),title:m[1].trim()}))
  if(!headings.length||headings[0].start!==0)headings.unshift({start:0,title:headings.length?'卷首正文':'原稿（未标章节）'})
  const chapters=[],used=new Set()
  for(const [index,heading]of headings.entries()){
    const end=headings[index+1]?.start??text.length,chapterText=text.slice(heading.start,end);let start=0,part=0
    while(start<chapterText.length){const stop=nextBoundary(chapterText,start,PAGE_CHARS),body=chapterText.slice(start,stop),title=chapterText.length>PAGE_CHARS?`${heading.title} · 第${++part}段`:heading.title
      const old=previous.find(p=>!used.has(p.id)&&p.sequence===chapters.length+1&&p.body===body)||previous.find(p=>!used.has(p.id)&&p.title===title&&p.body===body);if(old)used.add(old.id)
      chapters.push({id:old?.id||`chapter_${randomUUID()}`,sequence:chapters.length+1,title:old?.title||title,body,summary:''});start=stop
    }
  }
  assertSourceText(text,chapters);return chapters
}
export function chapterRanges(chapters,sourceId){let start=0;return [...chapters].sort((a,b)=>a.sequence-b.sequence).map(chapter=>{const range={chapter_id:chapter.id,source_revision_id:sourceId,start,end:start+chapter.body.length};start=range.end;return range})}
export function sourcePages(text,chapters,sourceId){
  assertSourceText(text,chapters);const pages=[]
  for(const span of chapterRanges(chapters,sourceId)){const chapter=chapters.find(c=>c.id===span.chapter_id);for(let start=span.start;start<span.end;){const localStart=start-span.start,end=span.start+nextBoundary(chapter.body,localStart,PAGE_CHARS);pages.push({id:`page_${randomUUID()}`,chapter_id:chapter.id,title:chapter.title,start,end,source_revision_id:sourceId});start=end}}
  return pages
}
export function assertSourceText(text,chapters){let offset=0;for(const [index,chapter]of chapters.entries()){if(chapter.sequence!==index+1||typeof chapter.body!=='string'||!chapter.body.length||text.slice(offset,offset+chapter.body.length)!==chapter.body)throw new TypeError('分段正文必须按顺序完整保留原稿，不得遗漏、重复或改写');offset+=chapter.body.length}if(offset!==text.length)throw new TypeError('分段正文尚未完整覆盖原稿');return true}
export function readChapterText(chapters,start,end){if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end<=start||end-start>16000)throw new TypeError('读取范围无效，单次最多16000字符');let offset=0,body='';for(const chapter of chapters){const next=offset+chapter.body.length;if(next>start&&offset<end)body+=chapter.body.slice(Math.max(0,start-offset),Math.min(chapter.body.length,end-offset));offset=next;if(offset>=end)break}return body}
export function assertCoverage(length,ranges){let next=0;for(const span of [...ranges].sort((a,b)=>a.start-b.start)){if(span.start!==next||span.end<=span.start||span.end>length)throw new TypeError('原稿覆盖存在遗漏或重叠');next=span.end}if(next!==length)throw new TypeError('原稿尚未完整覆盖');return true}
export const upsert=(rows,items)=>{const result=rows.map(row=>({...row}));for(const item of items){const index=result.findIndex(row=>row.id===item.id);if(index<0)result.push(item);else result[index]=item}return result}
