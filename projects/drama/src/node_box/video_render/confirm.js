export async function confirm(p){if((!p.clip_arrangement.clips.length||p.clip_arrangement.clips.some(c=>p.videos.filter(v=>v.clip_id===c.id&&v.status==='approved').length!==1)))throw new TypeError('每个分片需要选用一个视频')
}
