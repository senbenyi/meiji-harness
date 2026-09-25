import { element, tabs } from './dom.js'
import { request, assetUrl } from './api.js'

export const categories = [['characters', '人物'], ['scenes', '场景'], ['props', '道具'], ['audio', '声音'], ['video', '视频']]
const accepts = { characters: '.png,.jpg,.jpeg,.webp,.gif', scenes: '.png,.jpg,.jpeg,.webp,.gif', props: '.png,.jpg,.jpeg,.webp,.gif', audio: '.mp3,.wav,.m4a,.ogg,.flac', video: '.mp4,.webm,.mov' }

function dramaLibrary(onProject) {
  const view = element('section'), list = element('div')
  let projects = [], status = 'in-progress'
  const render = () => {
    list.replaceChildren()
    for (const project of projects.filter(item => item.status === status)) {
      const card = element('button', '', 'card')
      card.append(element('strong', project.title), element('span', `${(project.episodes || []).length} 集 · ${project.aspectRatio || '1344x768'} · ${new Date(project.createdAt).toLocaleDateString('zh-CN')}`, 'meta'))
      card.onclick = () => onProject(project); list.append(card)
    }
    if (!list.children.length) list.append(element('p', status === 'completed' ? '暂无已完成短剧' : '暂无进行中短剧', 'empty'))
  }
  view.append(tabs('短剧状态', [['in-progress', '进行中'], ['completed', '已完成']], status, selected => { status = selected; render() }), list)
  list.append(element('p', '正在读取短剧…'))
  request('projects').then(data => { projects = data.projects; render() }).catch(error => list.replaceChildren(element('p', error.message, 'error')))
  return view
}

function assetLibrary(actions) {
  const view = element('section'), list = element('div'), status = element('div', '', 'status')
  status.setAttribute('role', 'status')
  let category = 'characters', loading = 0, uploading = false
  const input = document.createElement('input'); input.type = 'file'; input.multiple = true; input.hidden = true
  input.setAttribute('aria-label', '选择导入素材')
  const importButton = element('button', '导入素材', 'primary')
  const toolbar = element('div', '', 'asset-toolbar'); toolbar.append(importButton, element('small', '单文件 ≤ 512 MB'))
  const categoryTabs = tabs('素材分类', categories, category, selected => { category = selected; load() })
  const help = element('p', '', 'notice')
  view.append(categoryTabs, toolbar, input, help, status, list)
  importButton.onclick = () => { input.accept = accepts[category]; input.click() }
  async function load() {
    const ticket = ++loading, selected = category
    help.textContent = selected === 'audio' ? '支持 MP3、WAV、M4A、OGG、FLAC' : selected === 'video' ? '支持 MP4、WebM、MOV；能否播放取决于编码格式' : '支持 PNG、JPG、WebP、GIF 图片'
    list.replaceChildren(element('p', '正在读取素材…', 'meta'))
    try {
      const { assets } = await request('assets?' + new URLSearchParams({ category: selected }))
      if (ticket !== loading) return
      list.replaceChildren()
      if (!assets.length) list.append(element('div', '暂无素材，点击「导入素材」添加', 'empty'))
      for (const asset of assets) {
        const card = element('article', '', 'asset-card'), url = assetUrl(asset)
        const media = document.createElement(asset.mime.startsWith('image/') ? 'img' : asset.mime.startsWith('audio/') ? 'audio' : 'video')
        media.src = url
        if (media.tagName === 'IMG') { media.alt = asset.originalName; media.loading = 'lazy' }
        else { media.controls = true; media.preload = 'metadata' }
        const download = element('a', '下载原文件'); download.href = url + '&download=1'; download.download = asset.originalName
        card.append(media, element('strong', asset.originalName), element('p', `${(asset.size / 1024 / 1024).toFixed(2)} MB · ${new Date(asset.createdAt).toLocaleDateString('zh-CN')}`, 'meta'), download)
        list.append(card)
      }
    } catch (error) { if (ticket === loading) list.replaceChildren(element('p', error.message, 'error')) }
  }
  input.onchange = async () => {
    if (uploading || !input.files.length) return
    const files = [...input.files], target = category
    uploading = true; importButton.disabled = true
    for (const button of categoryTabs.children) button.disabled = true
    let success = 0
    const failures = []
    for (const [index, file] of files.entries()) {
      status.textContent = `正在导入 ${index + 1}/${files.length}：${file.name}`
      try {
        if (file.size > 512 * 1024 * 1024) throw new Error('文件超过 512 MB')
        await actions.importLibrary(target, file)
        success++
      } catch (error) { failures.push(`${file.name}：${error.message}`) }
    }
    status.textContent = `已送入会话 ${success}/${files.length} 个素材${failures.length ? '；' + failures.join('；') : ''}`
    input.value = ''; uploading = false; importButton.disabled = false
    for (const button of categoryTabs.children) button.disabled = false
    await load()
  }
  load()
  return view
}

export function renderLibrary(onProject, actions) {
  const view = element('section', '', 'library-view'), content = element('div')
  const dramas = dramaLibrary(onProject), assets = assetLibrary(actions); assets.hidden = true
  content.append(dramas, assets)
  view.append(tabs('片库类型', [['dramas', '短剧'], ['assets', '素材']], 'dramas', selected => {
    dramas.hidden = selected !== 'dramas'; assets.hidden = selected !== 'assets'
  }), content)
  return view
}
