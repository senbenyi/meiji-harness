// 独立进程在真实 SQLite 已保存 running/queued 后等待父测试 SIGKILL。
import { ModelRepository } from '../../server/data/model-repository.js';
import { TaskService } from '../../server/flow/tasks/task-service.js';
import { commitContent } from '../../server/handlers/content.js';
const [root,id,kind]=process.argv.slice(2);
const repo=new ModelRepository(root),model=await repo.open(id);
const service=new TaskService({repository:repo,commitOutput:commitContent,execute:async()=>{
 process.send({event:'running'});await new Promise(()=>{});
}});
setInterval(()=>{},1000);
await service.command({type:kind==='costume-image'?'submit-costumes':'submit',project_id:id,request_id:'crash-start',target_id:kind==='costume-image'?model.read().project.character_library.characters[0].id:id,...(kind==='costume-image'?{}:{business_type:kind}),action:kind==='costume-image'?'generate':'regenerate'});
