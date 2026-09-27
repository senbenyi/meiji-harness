import {readFile,writeFile} from 'node:fs/promises';
import {modelStore} from '../../server/data/models.js';
import {normalizeModels} from '../../models/router.js';
import {uploadGatewayFile} from '../../server/generate/gateway.js';
import {savePicture} from '../../server/data/pictures.js';
const dir=new URL('./',import.meta.url),home=process.cwd()+'/.dsh';
const route=normalizeModels(await modelStore(home).read()).video;
const prompts=JSON.parse(await readFile(new URL('prompts.json',dir),'utf8'));
const manifest=JSON.parse(await readFile(new URL('uploads.json',dir),'utf8').catch(()=> '[]'));
for(const item of prompts){
 if(manifest.some(x=>x.id===item.id))continue;
 const bytes=await readFile(new URL(`images/${item.id}.png`,dir));
 const uploaded=await uploadGatewayFile({baseUrl:route.baseUrl,apiKey:route.apiKey,bytes,filename:item.id+'.png',mime:'image/png'});
 const reference=await savePicture(home,bytes,'image/png','scenes',item.name,{source:'generated',projectId:'7a8b0266-69c2-4122-9ec8-eeb7d285a0c9',episodeId:'15442eeb-3592-4cab-a4f5-9ff424465b89',itemId:item.id,imageUrl:uploaded.url,prompt:item.prompt});
 const response=await fetch(uploaded.url,{headers:{Authorization:`Bearer ${route.apiKey}`},signal:AbortSignal.timeout(30000)});
 await response.body?.cancel();
 manifest.push({id:item.id,name:item.name,...reference,verificationStatus:response.status});
 await writeFile(new URL('uploads.json',dir),JSON.stringify(manifest,null,2));
 console.log(item.id,response.status);
}
