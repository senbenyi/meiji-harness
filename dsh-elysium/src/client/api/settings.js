// 职责：通过媒体 URL 构建器调用已认证设置端点。
load('elysium/settings-api', (require, exports) => {
  const { mediaUrl } = require('elysium/media-api')
  async function settingsRequest(action, body, signal) {
    const response = await fetch(mediaUrl(action, null, null, {}, 'settingsBase'), { credentials: 'same-origin', cache: 'no-store', signal,
      ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) })
    const value = await response.json()
    if (!response.ok) throw Object.assign(new Error(value.error || '设置操作失败'), { status: response.status })
    return value
  }
  exports.settingsRequest = settingsRequest
})
