// 职责：通过媒体 URL 构建器调用已认证服务器设置端点。
load('elysium/server-api', (require, exports) => {
  const { mediaUrl } = require('elysium/media-api')
  async function serverRequest(action, body, signal) {
    const response = await fetch(mediaUrl(action, null, null, {}, 'serverBase'), { credentials: 'same-origin', cache: 'no-store', signal,
      ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) })
    const value = await response.json()
    if (!response.ok) throw new Error(value.error || '服务器操作失败')
    return value
  }
  exports.serverRequest = serverRequest
})
