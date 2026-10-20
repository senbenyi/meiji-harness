

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
export const SUPPORTED_ASPECT_RATIOS = Object.freeze(['21:9', '16:9', '4:3', '1:1', '3:4', '9:16']);

export function videoSizeOf(value = '9:16') {
  const sizes = { '21:9':'1344x576', '16:9':'1024x576', '4:3':'1024x768', '1:1':'768x768', '3:4':'768x1024', '9:16':'576x1024' };
  if (!sizes[value]) throw Object.assign(new Error('视频画幅需为 ' + SUPPORTED_ASPECT_RATIOS.join('、')), {status:400});
  return sizes[value];
}

