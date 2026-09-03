const API = '/elysium/api'

export function createApi(fetchImpl = fetch) {
  async function fetchJson(route, body = {}) {
    const response = await fetchImpl(API + route, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok || data.ok === false) {
      const error = new Error(data.error || `HTTP ${response.status}`)
      error.code = data.code
      error.status = response.status
      throw error
    }
    return data
  }

  function mediaUrl(projectId, filePath) {
    if (!projectId || !filePath) return null
    return `/elysium/file?project=${encodeURIComponent(projectId)}&path=${encodeURIComponent(filePath)}`
  }

  async function uploadImage({ projectId, scope, entityId, file }) {
    const query = new URLSearchParams({ projectId, scope, entityId, filename: file.name })
    const response = await fetchImpl(`/elysium/import-image?${query}`, {
      method: 'POST',
      headers: { 'content-type': file.type || 'application/octet-stream' },
      body: file,
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok || data.ok === false) {
      const error = new Error(data.error || `HTTP ${response.status}`)
      error.code = data.code
      error.status = response.status
      throw error
    }
    return data
  }

  return { fetchJson, uploadImage, mediaUrl }
}
