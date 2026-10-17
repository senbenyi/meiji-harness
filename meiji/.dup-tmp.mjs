import fs from 'node:fs';
const dir='server/prompts/models/';
for (const f of fs.readdirSync(dir)) {
  const m=(await import(process.cwd()+'/'+dir+f)).default;
  const acts=Object.keys(m);
  const strs={};
  const walk=(o,p,a)=>{ if(typeof o==='string'){ if(o.length>80) (strs[o]??=[]).push(a+':'+p);} else if(o&&typeof o==='object') for(const k in o) walk(o[k],p+'.'+k,a); };
  for(const a of acts) walk(m[a],'',a);
  let dupBytes=0, total=0; const d=[];
  for(const [s,locs] of Object.entries(strs)){ total+=s.length*locs.length; if(locs.length>1){dupBytes+=s.length*(locs.length-1); d.push(`${locs.length}x ${s.length}ch ${locs.join(' | ')}`);} }
  console.log(`## ${f} actions=[${acts}] 长串总字符=${total} 重复字符=${dupBytes}`);
  d.forEach(x=>console.log('   ',x));
}
