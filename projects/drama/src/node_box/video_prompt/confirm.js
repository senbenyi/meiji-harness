export async function confirm(p){if((!p.clip_arrangement.clips.length||p.clip_arrangement.clips.some(c=>!p.video_prompt.items.some(i=>i.clip_id===c.id))))throw new TypeError('分片提示词不完整')
}
