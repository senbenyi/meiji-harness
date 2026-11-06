import {element,backHeader} from './panel-dom.js';

let sequence=0;
export function createRulesDetail({title,load,onBack}){
 const root=element('section','','production-rules-detail'),id=`production-rules-${++sequence}`;
 let alive=true,ticket=0,bases=null,error='',pending=true,selected=0;
 const definitions=[['generate','生成规则'],['review','审核规则'],['revise','修订规则'],['output_format','输出格式']];
 backHeader(root,title,'返回制作步骤',onBack);
 const tabs=element('nav','','library-tabs'),panel=element('section','','production-rules-panel');
 tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','规则分类');
 panel.id=id+'-panel';panel.setAttribute('role','tabpanel');panel.tabIndex=0;
 const buttons=definitions.map(([key,label],index)=>{
  const button=element('button',label);button.type='button';button.id=id+'-'+key;
  button.setAttribute('role','tab');button.setAttribute('aria-controls',panel.id);
  button.onclick=()=>{selected=index;paint()};
  button.onkeydown=event=>{
   if(event.altKey||event.ctrlKey||event.metaKey||!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
   event.preventDefault();selected=event.key==='Home'?0:event.key==='End'?buttons.length-1:(selected+(event.key==='ArrowRight'?1:-1)+buttons.length)%buttons.length;
   paint();buttons[selected].focus();
  };
  tabs.append(button);return button;
 });
 root.append(tabs,panel);
 function paint(){
  if(!alive)return;
  buttons.forEach((button,index)=>{button.setAttribute('aria-selected',String(index===selected));button.tabIndex=index===selected?0:-1});
  panel.setAttribute('aria-labelledby',buttons[selected].id);panel.setAttribute('aria-busy',String(pending));panel.replaceChildren();
  if(pending){const status=element('p','正在加载完整规则…','meta');status.setAttribute('role','status');panel.append(status);return}
  if(error){const failure=element('p',error,'error'),retry=element('button','重试');failure.setAttribute('role','alert');retry.type='button';retry.onclick=read;panel.append(failure,retry);return}
  const value=bases[definitions[selected][0]];
  if(value===undefined||value===null||value===''){panel.append(element('p','此项暂无规则。','meta'));return}
  const content=element('pre',typeof value==='string'?value:JSON.stringify(value,null,2),'production-rules-content');panel.append(content);
 }
 async function read(){
  const current=++ticket;pending=true;error='';paint();
  try{
   const result=await load();
   if(!alive||ticket!==current)return;
   if(!result?.bases||typeof result.bases!=='object'||Array.isArray(result.bases))throw new Error('未能读取完整规则，请重试。');
   bases=result.bases;
  }catch(cause){if(!alive||ticket!==current)return;error=cause.message||'规则加载失败，请重试。'}
  finally{if(alive&&ticket===current){pending=false;paint()}}
 }
 void read();
 return {element:root,dispose(){alive=false;ticket++}};
}
