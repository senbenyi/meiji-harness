import { confirmPanel, element, tabs } from './panel-dom.js'
import { request, assetUrl } from './panel-api.js'
import { guidanceTypes } from '../shared/guidance-categories.js'

export const categories = [['characters', '人物'], ['scenes', '场景'], ['props', '道具'], ['audio', '声音'], ['video', '视频'], ['guidance', '指导提示词'], ['scripts', '剧本']]
const accepts = { characters: '.png,.jpg,.jpeg,.webp,.gif', scenes: '.png,.jpg,.jpeg,.webp,.gif', props: '.png,.jpg,.jpeg,.webp,.gif', audio: '.mp3,.wav,.m4a,.ogg,.flac', video: '.mp4,.webm,.mov', guidance: '.txt,.md,.markdown', scripts: '.txt,.text' }

function dramaLibrary(onProject) {
  const view = element('section'), list = element('div')
  let projects = [], status = 'in-progress'
  const render = () => {
    list.replaceChildren()
    for (const project of projects.filter(item => item.lifecycle === status)) {
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
  const limit = element('small', '单文件 ≤ 512 MB')
  const toolbar = element('div', '', 'asset-toolbar'); toolbar.append(importButton, limit)
  const typeLabel = element('label', '指导分类'), typeInput = document.createElement('select')
  typeInput.setAttribute('aria-label', '指导素材分类')
  for (const [value, label] of guidanceTypes) { const option = element('option', label); option.value = value; typeInput.append(option) }
  typeLabel.append(typeInput); typeLabel.hidden = true
  typeInput.onchange = () => load()
  const categoryTabs = tabs('素材分类', categories, category, selected => { category = selected; load() })
  const help = element('p', '', 'notice')
  view.append(categoryTabs, typeLabel, toolbar, input, help, status, list)
  importButton.onclick = () => { input.accept = accepts[category]; input.click() }
  async function load() {
    const ticket = ++loading, selected = category, guidanceType = typeInput.value
    typeLabel.hidden = selected !== 'guidance'
    limit.textContent = selected === 'scripts' ? '单文件 ≤ 1 MB / 200000 字符' : selected === 'guidance' ? '单文件 ≤ 128 KB / 20000 字' : '单文件 ≤ 512 MB'
    help.textContent = selected === 'scripts' ? '支持 UTF-8 TXT/TEXT 剧本。创建项目时可选使用；项目摘要在制作时按需生成。' : selected === 'guidance' ? '按所选分类导入 UTF-8 TXT/Markdown 提示词，保存在本地；在各阶段「补充 skill」中选择使用。' : selected === 'audio' ? '支持 MP3、WAV、M4A、OGG、FLAC' : selected === 'video' ? '支持 MP4、WebM、MOV；能否播放取决于编码格式' : '支持 PNG、JPG、WebP、GIF 图片'
    list.replaceChildren(element('p', '正在读取素材…', 'meta'))
    try {
      const { assets } = await request('assets?' + new URLSearchParams({ category: selected }))
      if (ticket !== loading) return
      list.replaceChildren()
      const visible = selected === 'guidance' ? assets.filter(asset => asset.guidanceType === guidanceType) : assets
      if (!visible.length) list.append(element('div', '暂无素材，点击「导入素材」添加', 'empty'))
      for (const asset of visible) {
        const card = element('article', '', 'asset-card'), url = assetUrl(asset)
        let media
        if (selected === 'scripts') {
          media = element('details', '', 'guidance-preview')
          const text = element('pre', '', 'guidance-text')
          media.append(element('summary', '查看剧本'), text)
          media.ontoggle = async () => {
            if (!media.open || text.dataset.loaded) return
            try { const response = await fetch(url); if (!response.ok) throw new Error('读取剧本失败'); text.textContent = await response.text(); text.dataset.loaded = '1' }
            catch (error) { text.textContent = error.message }
          }
        } else if (selected === 'guidance') {
          media = element('details', '', 'guidance-preview')
          media.append(element('summary', '预览提示词'), element('pre', asset.content, 'guidance-text'))
        } else {
          media = document.createElement(asset.mime.startsWith('image/') ? 'img' : asset.mime.startsWith('audio/') ? 'audio' : 'video')
          media.src = url
          if (media.tagName === 'IMG') { media.alt = asset.originalName; media.loading = 'lazy' }
          else { media.controls = true; media.preload = 'metadata' }
        }
        const download = element('a', '下载原文件'); download.href = url + '&download=1'; download.download = asset.originalName
        const remove = element('button', '删除', 'danger'); remove.type = 'button'
        remove.setAttribute('aria-label', `删除素材 ${asset.originalName}`)
        remove.onclick = async () => {
          if (remove.disabled) return
          remove.disabled = true
          if (!await confirmPanel(`确定从素材库移除「${asset.originalName}」？项目已有引用和原文件会保留。`)) { remove.disabled = false; return }
          status.textContent = ''
          try {
            await actions.deleteLibrary(asset)
            status.textContent = `已从素材库移除「${asset.originalName}」，项目已有引用保留。`
            if (selected === category && (selected !== 'guidance' || guidanceType === typeInput.value)) await load()
          } catch (error) { status.textContent = error.message; remove.disabled = false }
        }
        const buttons = element('div', '', 'asset-actions'); buttons.append(download, remove)
        card.append(media, element('strong', asset.originalName), element('p', `${(asset.size / 1024 / 1024).toFixed(2)} MB · ${new Date(asset.createdAt).toLocaleDateString('zh-CN')}`, 'meta'), buttons)
        list.append(card)
      }
    } catch (error) { if (ticket === loading) list.replaceChildren(element('p', error.message, 'error')) }
  }
  input.onchange = async () => {
    if (uploading || !input.files.length) return
    const files = [...input.files], target = category, guidanceType = typeInput.value
    uploading = true; importButton.disabled = true; typeInput.disabled = true
    for (const button of categoryTabs.children) button.disabled = true
    let success = 0
    const failures = []
    for (const [index, file] of files.entries()) {
      status.textContent = `正在导入 ${index + 1}/${files.length}：${file.name}`
      try {
        if (file.size > 512 * 1024 * 1024) throw new Error('文件超过 512 MB')
        if (target === 'guidance' && file.size > 128 * 1024) throw new Error('指导素材超过 128 KB')
        if (target === 'scripts' && file.size > 1024 * 1024) throw new Error('剧本超过 1 MB')
        await actions.importLibrary(target, file, target === 'guidance' ? guidanceType : undefined)
        success++
      } catch (error) { failures.push(`${file.name}：${error.message}`) }
    }
    status.textContent = `已导入 ${success}/${files.length} 个素材${failures.length ? '；' + failures.join('；') : ''}`
    input.value = ''; uploading = false; importButton.disabled = false; typeInput.disabled = false
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
