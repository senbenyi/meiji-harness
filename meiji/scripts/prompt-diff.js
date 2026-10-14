// 用真实节点路由契约和夹具核对各动作的实际模型输入。
import { nodeRoutes, composeNodePrompt } from '../server/http/ai-routes.js';
import { taskNodeInput } from '../server/handlers/node-inputs.js';
import { snapshotFixture, taskFixture } from '../tests/fixtures/project.js';

const business = process.argv[2] || 'project-summary';
const snapshot = snapshotFixture(), project = snapshot.project;
const id = ['project-summary', 'project-characters', 'script-split'].includes(business)
  ? project.id : ['seconds', 'storyboard'].includes(business)
    ? project.episodes[0].shot_list.shots[0].id : project.episodes[0].id;
const task = taskFixture(project, business, id);
for (const action of Object.keys(nodeRoutes[business].actions)) {
  const input = taskNodeInput(snapshot, task, null, action);
  const prompt = composeNodePrompt(business, action, input, process.argv[3] || 'qwen3.5:27b');
  process.stdout.write(JSON.stringify({ business, action, input, messages: prompt.messages }, null, 2) + '\n');
}
