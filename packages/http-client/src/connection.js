export function gatewayBaseUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw Object.assign(new Error('网关地址无效'), { status: 400 }); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw Object.assign(new Error('网关地址无效'), { status: 400 });
  }
  return url.href.replace(/\/$/, '');
}
