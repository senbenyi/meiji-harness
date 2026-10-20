import { expireDownstream } from '../../shared/node-dependencies.js';

// v13 不从旧节拍猜测完整镜末状态。保留正文与历史，要求重新生成交接资料。
export function migrateSecondsContinuity(snapshot) {
  const reason = '每秒分镜新增跨镜交接资料，请按镜头顺序重新生成';
  const shots = snapshot.project.episodes.flatMap(episode => episode.shot_list.shots);
  for (const shot of shots) Object.assign(shot.seconds_storyboard, {
    end_state: '', pending_actions: '', pending_dialogue: '', continuing_audio: '',
  });
  for (const shot of shots) {
    const node = shot.seconds_storyboard;
    if (!node.storyboard.length) continue;
    if (node.node_state.status === 'generated') Object.assign(node.node_state, { status: 'expired', reason, fail_message: '' });
    for (const task of snapshot.tasks) {
      if (task.task_status === 'queued' && task.business_type === 'seconds' && task.target_id === shot.id && task.previous_node_state?.status === 'generated')
        Object.assign(task.previous_node_state, { status: 'expired', reason, fail_message: '' });
    }
    expireDownstream(snapshot, 'seconds', shot.id, reason, { compareHash: false });
  }
}
