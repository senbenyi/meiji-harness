// 用新契约夹具核对实际 YAML 请求；不加载旧 Model、skill 或执行器。
import { loadTemplate,renderTemplate } from '../server/prompts/yaml-prompts.js'
import { promptValues } from '../server/handlers/text-handler.js'
import { snapshotFixture,taskFixture } from '../tests/fixtures/project.js'
const business=process.argv[2]||'project-summary',snapshot=snapshotFixture(),p=snapshot.project,id=['project-summary','project-characters','script'].includes(business)?p.id:['seconds','storyboard'].includes(business)?p.剧集[0].镜头表.镜头[0].id:p.剧集[0].id
const task=taskFixture(p,business,id)
for(const kind of ['generate','regenerate','review']){const template=await loadTemplate(`${business}-${kind}`),prompt=renderTemplate(template,promptValues(snapshot,task,null,kind==='review'?'review':'generate'));process.stdout.write(JSON.stringify({business,kind,system:prompt.system,user:prompt.user},null,2)+'\n')}
