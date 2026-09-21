// 职责：给 ComfyUI 视频执行图增加供页面播放的轻量 MP4。
export function addVideoPreview(graph, outputNode, jobId, size) {
  const output = graph[outputNode]
  const prototype = size && Object.values(graph).find(node => node.class_type === 'ImageScale')
  graph.elysium_preview_resize = size ? { class_type: 'ImageScale', inputs: {
    image: output.inputs.images, upscale_method: 'area', width: Math.max(2, Math.floor(size.width / 2)),
    height: Math.max(2, Math.floor(size.height / 2)), crop: 'center' }, _meta: prototype._meta }
    : { class_type: 'ImageScaleBy', inputs: { image: output.inputs.images, upscale_method: 'area', scale_by: 0.5 } }
  graph.elysium_preview_video = { class_type: output.class_type, inputs: {
    ...output.inputs, images: ['elysium_preview_resize', 0],
    filename_prefix: `elysium/${jobId}/preview`,
    ...('quality' in output.inputs ? { quality: 35, audio_bitrate: '64k' } : { crf: 35 }), save_output: true },
  ...(output._meta ? { _meta: output._meta } : {}) }
  return 'elysium_preview_video'
}
