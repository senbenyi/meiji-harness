import { locateTarget } from '../../shared/task_contract.js';
import { taskFixture } from './project.js';
import { createTaskGroupModel } from '../../shared/models/task_group_model.js';
import { enqueueNode } from '../../shared/node-state.js';
import { newStep, stepKinds, reviewTypes } from '../../shared/task-plan.js';

// 构造进程退出前已落盘、尚未启动的任务，用于恢复/迁移测试。
export async function seedQueuedTasks(model, specs) {
  await model.update(crypto.randomUUID(), {}, s => {
    for (const [business, target] of specs) {
      const task = taskFixture(s.project, business, target, {
        episode_id: locateTarget(s.project,business,target).episode?.id || null,
        queue_order: s.tasks.length + 1,
      });
      const group = createTaskGroupModel({ project_id: s.project.basic_info.id, episode_id: task.episode_id,
        group_type: 'single', source: 'panel', action: task.action });
      task.group_id = group.id; task.group_seq = 1;
      enqueueNode(s.project, task);
      s.groups.push(group); s.tasks.push(task);
      const reviewers = reviewTypes(task);
      s.steps.push(...stepKinds(task).map((kind,i) => newStep(task,i+1,kind,0,kind === 'review' ? reviewers.shift() : null)));
    }
  });
}
