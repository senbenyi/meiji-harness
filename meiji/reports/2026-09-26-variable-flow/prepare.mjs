import {readFile,writeFile,copyFile} from 'node:fs/promises';
const dir=new URL('./',import.meta.url);
const source=JSON.parse(await readFile(new URL('source-project.json',dir),'utf8'));
const prompts=JSON.parse(await readFile(new URL('image-prompts.json',dir),'utf8'));
const files=['b9327bf0-ddd9-4108-b028-b952919c885c','8c8bb7c0-affc-44cb-98ee-a974edd94572','75bc4530-dec4-42f4-81ea-26cce757d0ca','12e8fa97-c59c-481f-8bad-6f8010c4eb45','95434bfb-d6a8-47fc-b7b2-eef733df5d96'];
const spaces=['完整塔楼与南入口，四周留白，前景道路与远处楼群形成纵深。','南入口接北向走廊，北端转角通楼梯；主通道宽4米深20米。','折返梯上下平台与防火门连通，时间省略后可复用不同楼层的同类布局。','西南出口距南缘约3米，北侧机组距南缘约15米，东西约24米；沿南缘横移4米后可向南退2米，不需穿越整个平台。','中央无遮挡冲锋地，宽约200米深约300米，北山脊、东西土垒完整，南北角色起始相距约100米。'];
const scenes=[];
for(let i=0;i<5;i++){
 await copyFile('/Users/tom/.codex/generated_images/01a0c922-2252-7850-884b-9c705b68e9cc/exec-'+files[i]+'.png',new URL('images/'+prompts[i].id+'.png',dir));
 scenes.push({id:prompts[i].id,type:'scene',name:prompts[i].name,landmark:spaces[i],space:spaces[i],light:i===4?'烈日':'白昼自然光，室内顶灯补光',look:prompts[i].prompt});
}
await writeFile(new URL('cards.json',dir),JSON.stringify({characters:source.episodes[0].characters,scenes:{items:scenes}},null,2));
await copyFile(new URL('../2026-09-26-gpt-flow/upload.mjs',dir),new URL('upload.mjs',dir));
