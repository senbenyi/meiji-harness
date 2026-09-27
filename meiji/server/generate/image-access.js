export async function readGatewayImage({ imageUrl, baseUrl, apiKey, fetchImpl = fetch }) {
  const base = new URL(baseUrl)
  let url
  try { url = new URL(imageUrl) } catch { throw Object.assign(new Error('人物图片 URL 无效'), { status: 400 }) }
  const prefix = base.pathname.replace(/\/$/, '') + '/files/'
  if (url.origin !== base.origin || url.username || url.password || url.search || url.hash || !url.pathname.startsWith(prefix) || !/^file_[A-Za-z0-9_-]+\/content$/.test(url.pathname.slice(prefix.length))) {
    throw Object.assign(new Error('图片 URL 不属于当前配置的网关文件接口'), { status: 400 })
  }
  let response
  try {
    response = await fetchImpl(url, { headers: { Authorization: `Bearer ${apiKey}` }, redirect: 'error', signal: AbortSignal.timeout(30000) })
  } catch { throw Object.assign(new Error('图片访问失败：网关连接失败、超时或发生重定向'), { status: 502 }) }
  if (!response.ok) {
    await response.body?.cancel()
    const message = response.status === 404 ? '图片不存在、已删除，或当前密钥与上传时不一致' : response.status === 401 || response.status === 403 ? '图片访问鉴权失败，请检查网关密钥' : `图片访问失败（HTTP ${response.status}）`
    throw Object.assign(new Error(message), { status: 502 })
  }
  const mime = (response.headers.get('content-type') || '').split(';')[0].trim()
  if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(mime)) {
    await response.body?.cancel()
    throw Object.assign(new Error('图片 URL 未返回支持的图片格式'), { status: 502 })
  }
  const chunks = []
  let size = 0
  for await (const chunk of response.body) {
    size += chunk.length
    if (size > 12 * 1024 * 1024) throw Object.assign(new Error('图片超过 12 MB，无法预览'), { status: 413 })
    chunks.push(chunk)
  }
  if (!size) throw Object.assign(new Error('图片 URL 返回空文件'), { status: 502 })
  return { bytes: Buffer.concat(chunks), mime }
}
