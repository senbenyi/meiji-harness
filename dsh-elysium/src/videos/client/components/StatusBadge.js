const STATUS_MAP = {
  draft: { label: '草稿', cls: 'tf-badge-draft' },
  prompt_ready: { label: '就绪', cls: 'tf-badge-ready' },
  image_queued: { label: '首帧生成中…', cls: 'tf-badge-queued' },
  image_ready: { label: '首帧完成', cls: 'tf-badge-done' },
  video_queued: { label: '视频生成中…', cls: 'tf-badge-queued' },
  video_ready: { label: '完成', cls: 'tf-badge-done' },
  failed: { label: '失败', cls: 'tf-badge-failed' },
}

export function StatusBadge(h, { status }) {
  const value = STATUS_MAP[status] || STATUS_MAP.draft
  return h('span', { className: `tf-badge ${value.cls}` }, value.label)
}
