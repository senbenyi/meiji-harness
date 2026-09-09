import { requiredConfig } from '../config.js'

export function mediaReference(value, extensions) {
  let url
  try { url = new URL(value) } catch { throw new Error('素材必须为 ComfyUI HTTP(S) view 地址') }
  const bases = ['MINIMAX_H3_COMFYUI_URL', 'MINIMAX_H3_COMFYUI_PUBLIC_URL'].map(key => new URL(requiredConfig(key, 'url').replace(/\/?$/, '/')))
  if (url.username || url.password || url.hash || !bases.some(base => url.origin === base.origin && url.pathname === new URL('view', base).pathname)) throw new Error('素材必须属于已配置的 ComfyUI HTTP view 接口')
  const filename = url.searchParams.get('filename'), subfolder = url.searchParams.get('subfolder') || '', type = url.searchParams.get('type') || 'output'
  if (!filename || /[/\\]/.test(filename) || !['input', 'output'].includes(type) || [filename, ...subfolder.split('/')].some(part => part === '..' || part === '.') || subfolder.startsWith('/') || /[\\\x00-\x1f]/.test(filename + subfolder)) throw new Error('无效 ComfyUI 素材标识')
  if (extensions && !extensions.some(suffix => filename.toLowerCase().endsWith(suffix))) throw new Error('素材类型不匹配')
  const internal = new URL('view', bases[0])
  internal.search = new URLSearchParams({ filename, subfolder, type }).toString()
  return { name: `${subfolder ? subfolder + '/' : ''}${filename} [${type}]`, url: internal.href }
}
