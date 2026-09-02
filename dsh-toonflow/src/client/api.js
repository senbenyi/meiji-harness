const API = '/toonflow/api'

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
    return `/toonflow/file?project=${encodeURIComponent(projectId)}&path=${encodeURIComponent(filePath)}`
  }

  return { fetchJson, mediaUrl }
}
