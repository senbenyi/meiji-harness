import {searchMemory} from '../memory/service.js'
import {readFile} from 'node:fs/promises'
import {join} from 'node:path'
const json=(res,status,value)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(value))}
async function body(req,limit=1024*1024){let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>limit)throw new TypeError('请求过大');chunks.push(chunk)}return JSON.parse(Buffer.concat(chunks).toString())}
export function createProductionRoutes(projects){
  return async(req,res,url)=>{
    if(!url.pathname.startsWith('/api/drama/production')&&!url.pathname.startsWith('/api/drama/images'))return false
    const service=projects.production;if(!service)return false
    const sessionId=url.searchParams.get('session_id')
    if(req.method==='GET'&&url.pathname==='/api/drama/images'){json(res,200,service.images.list({offset:Number(url.searchParams.get('offset')||0),limit:Number(url.searchParams.get('limit')||40)}));return true}
    const image=url.pathname.match(/^\/api\/drama\/images\/(img_[a-f0-9-]{36})$/i)
    if(req.method==='GET'&&image){const bytes=await service.images.read(image[1]);res.writeHead(200,{'content-type':'image/png','cache-control':'private, max-age=31536000, immutable'});res.end(bytes);return true}
    if(!sessionId)throw new TypeError('需要短剧会话')
    if(url.pathname==='/api/drama/production-memory-maintenance'){const context={sessionId,projectId:url.searchParams.get('project_id')||undefined,source:'ui'},id=url.searchParams.get('id');if(req.method==='GET'){json(res,200,id?await service.memoryMaintenance.status(id,context,url.searchParams.get('file')||undefined,{start:Number(url.searchParams.get('start')||0)}):await service.memoryMaintenance.history(context,url.searchParams.get('scope')||'project'));return true}if(req.method!=='POST'||req.headers['x-drama-request']!=='1'){json(res,403,{message:'缺少面板请求标识'});return true}const input=await body(req,24*1024*1024);json(res,202,input.cancel?await service.memoryMaintenance.cancel(input.cancel,context):await service.memoryMaintenance.run(input,context));return true}
    if(url.pathname==='/api/drama/production-memory'){
      const context={sessionId,projectId:url.searchParams.get('project_id')||undefined,source:'ui'},scope=url.searchParams.get('scope')||'project'
      if(req.method==='GET'){const options={query:url.searchParams.get('query')||'',id:url.searchParams.get('id')||undefined,history:url.searchParams.get('history')==='1',include_archived:url.searchParams.get('include_archived')==='1',summary:url.searchParams.get('summary')==='1',stage:url.searchParams.get('stage')||undefined,offset:Number(url.searchParams.get('offset')||0),limit:Number(url.searchParams.get('limit')||20)};json(res,200,scope==='effective'?searchMemory(await projects.memories.capture(context,options.stage||'project'),options):await projects.memories.read(scope,options,context));return true}
      if(req.method!=='POST'){json(res,405,{message:'不支持的记忆请求'});return true}
      if(req.headers['x-drama-request']!=='1'){json(res,403,{message:'缺少面板请求标识'});return true}
      json(res,200,await projects.memories.change(scope,await body(req,32768),context));return true
    }
    const project=await projects.context(sessionId,url.searchParams.get('project_id')||undefined)
    if(req.method==='GET'&&url.pathname==='/api/drama/production-rules'){json(res,200,await service.rules(project,url.searchParams.get('stage')));return true}
    if(req.method==='GET'&&url.pathname==='/api/drama/production-file'){
      const ref=url.searchParams.get('ref');let bytes
      if(/^requests\/[a-f0-9-]{36}\.txt$/i.test(ref||'')){const detail=projects.records.tasks.detail(projects.records.scope,url.searchParams.get('group_id'));if(!detail||!detail.tasks.some(t=>t.metadata.project_id===project.basic_info.id&&t.metadata.input_ref===ref))throw new TypeError('输入文件不属于本任务');bytes=await readFile(join(projects.root,ref))}else bytes=await projects.documents.readArtifact(project.basic_info.id,ref)
      const mime=ref.endsWith('.mp4')?'video/mp4':ref.endsWith('.wav')?'audio/wav':ref.endsWith('.mp3')?'audio/mpeg':ref.endsWith('.png')?'image/png':ref.endsWith('.jpg')?'image/jpeg':ref.endsWith('.webp')?'image/webp':null
      if(!mime&&url.searchParams.get('download')!=='1'){const text=bytes.toString(),start=Number(url.searchParams.get('start')||0),end=Number(url.searchParams.get('end')||start+16000);if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end<=start||end-start>16000)throw new TypeError('文件分页最多16000字符');json(res,200,{body:text.slice(start,end),characters:text.length,start,end:Math.min(end,text.length),truncated:end<text.length});return true}
      const headers={'content-type':mime||'text/plain; charset=utf-8','cache-control':'private, no-store','accept-ranges':'bytes'}
      if(url.searchParams.get('download')==='1')headers['content-disposition']=`attachment; filename="${ref.split('/').at(-1)}"`
      if(req.headers.range){const match=req.headers.range.match(/^bytes=(\d+)-(\d*)$/);if(!match){res.writeHead(416,{'content-range':`bytes */${bytes.length}`});res.end();return true}const start=Number(match[1]),end=Math.min(match[2]?Number(match[2]):bytes.length-1,bytes.length-1);if(start>=bytes.length||end<start){res.writeHead(416,{'content-range':`bytes */${bytes.length}`});res.end();return true}res.writeHead(206,{...headers,'content-length':end-start+1,'content-range':`bytes ${start}-${end}/${bytes.length}`});res.end(bytes.subarray(start,end+1));return true}
      res.writeHead(200,{...headers,'content-length':bytes.length});res.end(bytes);return true
    }
    if(req.method!=='POST'){json(res,405,{message:'不支持的制作请求'});return true}
    if(req.headers['x-drama-request']!=='1'){json(res,403,{message:'缺少面板请求标识'});return true}
    const cancel=url.pathname.match(/^\/api\/drama\/production-tasks\/([^/]+)\/cancel$/)
    if(cancel){json(res,200,await service.cancel(decodeURIComponent(cancel[1]),{sessionId,projectId:project.basic_info.id}));return true}
    const run=url.pathname.match(/^\/api\/drama\/production\/([a-z_]+)$/)
    if(run){const {request_id,project_id,...input}=await body(req);json(res,202,await service.run(run[1],input,{sessionId,projectId:project_id||project.basic_info.id,requestId:request_id,source:'ui'}));return true}
    json(res,404,{message:'制作端点不存在'});return true
  }
}
