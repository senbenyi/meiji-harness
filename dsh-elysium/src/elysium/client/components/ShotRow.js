export function ShotRow(h, {
  shot, projectId, mediaUrl, characterNames, sceneName, statusBadge, action, onDetails,
}) {
  return h('div', { key: shot.id, className: 'tf-shot' },
    h('div', { className: 'tf-shot-head' },
      h('span', { className: 'tf-shot-num' }, `#${shot.order}`),
      h('span', { className: 'tf-shot-desc' }, shot.description),
    ),
    h('div', { className: 'tf-shot-media' },
      shot.imagePath
        ? h('img', { className: 'tf-shot-img', src: mediaUrl(projectId, shot.imagePath), alt: '首帧' })
        : h('div', { className: 'tf-shot-img' }, '📷'),
      shot.videoPath
        ? h('video', { className: 'tf-shot-img', src: mediaUrl(projectId, shot.videoPath), controls: true })
        : h('div', { className: 'tf-shot-img' }, shot.status === 'image_ready' ? '待生成' : ''),
    ),
    h('div', { className: 'tf-shot-footer' },
      h('span', { className: 'tf-shot-chars' }, `${characterNames} · ${sceneName || ''}`),
      statusBadge,
      action,
      h('button', { className: 'tf-back', onClick: onDetails, style: { fontSize: 11 } }, '详情 →'),
    ),
    shot.lastError ? h('div', { className: 'tf-shot-error' }, `错误: ${shot.lastError}`) : null,
  )
}
