import {readFile,writeFile} from 'node:fs/promises';
import {modelStore} from '../../server/data/models.js';
import {normalizeModels} from '../../models/router.js';
import {uploadGatewayFile} from '../../server/generate/gateway.js';
import {savePicture} from '../../server/data/pictures.js';
const dir=new URL('./',import.meta.url), home=process.cwd()+'/.dsh';
const route=normalizeModels(await modelStore(home).read()).video;
const cards=JSON.parse(await readFile(new URL('cards.json',dir),'utf8'));
for(const category of ['characters','scenes'])for(const item of cards[category].items){
 if(item.imageUrl)continue;
 const bytes=await readFile(new URL(`images/${item.id}.png`,dir));
 const uploaded=await uploadGatewayFile({baseUrl:route.baseUrl,apiKey:route.apiKey,bytes,filename:item.id+'.png',mime:'image/png'});
 Object.assign(item,await savePicture(home,bytes,'image/png',category,item.name,{source:'generated',projectId:'7a8b0266-69c2-4122-9ec8-eeb7d285a0c9',episodeId:'15442eeb-3592-4cab-a4f5-9ff424465b89',itemId:item.id,imageUrl:uploaded.url,prompt:'GPT imagegen；完整提示词见本轮 image-prompts.json'}));
 const response=await fetch(uploaded.url,{headers:{Authorization:`Bearer ${route.apiKey}`},signal:AbortSignal.timeout(30000)});
 item.uploadVerification={status:response.status,contentType:response.headers.get('content-type')};await response.body?.cancel();
 await writeFile(new URL('cards.json',dir),JSON.stringify(cards,null,2));
 console.log(item.id, 'uploaded', response.status);
}
