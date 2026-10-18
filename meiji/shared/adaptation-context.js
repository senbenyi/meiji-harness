import { scriptText } from './script-text.js';

// 正文从改编小段派生，规划文本独立保存在 episode.plot。
export function adaptedStory(episode) {
  return episode.story_outline.segments.map(segment => segment.body).join('\n\n');
}

// 任务输入和依赖指纹使用同一份全集及前集上下文。
export function adaptationContext(project, episode) {
  const episodes = [...project.episodes].sort((a, b) => a.sequence - b.sequence);
  const index = episodes.findIndex(item => item.id === episode.id), previous = episodes[index - 1];
  return {
    script: scriptText(project.script.body),
    episodes: episodes.map(item => ({ sequence: item.sequence, plot: item.plot, duration_seconds: item.duration_seconds })),
    previous: previous ? {
      sequence: previous.sequence,
      plan: previous.plot,
      // 无有效改编时只提供前集规划，不以被拒绝的候选作为既成剧情。
      story: previous.story_outline.node_state.status === 'generated' ? adaptedStory(previous) : '',
    } : null,
  };
}
