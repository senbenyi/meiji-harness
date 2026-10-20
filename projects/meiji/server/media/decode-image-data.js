

const dataUri = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=\s]+)$/

export function decodeImageData(data, mime) {
  const text = String(data || '').trim()
  const match = dataUri.exec(text)
  if (match) return { mime: match[1], bytes: Buffer.from(match[2].replace(/\s+/g, ''), 'base64') }
  const kind = stillMime(mime)
  if (!kind || !text) throw Object.assign(new Error('请上传 PNG、JPG 或 WebP 的 base64'), { status: 400 })
  return { mime: kind, bytes: Buffer.from(text.replace(/\s+/g, ''), 'base64') }
}

function stillMime(mime) {
  if (mime === 'image/jpg') return 'image/jpeg'
  return mime === 'image/png' || mime === 'image/jpeg' || mime === 'image/webp' ? mime : ''
}
