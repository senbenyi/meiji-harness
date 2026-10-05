export async function request(path, options) {
  const response = await fetch('/plugins/meiji/' + path, options)
  const value = await response.json()
  if (!response.ok) throw Object.assign(new Error(value.error || '请求失败'), { status: response.status, ...value })
  return value
}
export const jsonBody = value => ({ headers: { 'Content-Type': 'application/json', 'X-Meiji-Request': '1' }, body: JSON.stringify(value) })
export const assetUrl = asset => '/plugins/meiji/asset-file?' + new URLSearchParams({ category: asset.category, id: asset.id })
