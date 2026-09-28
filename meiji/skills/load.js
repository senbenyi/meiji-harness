import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * 命名：
 * - 通用：skill-{分类拼音}-{功能}-{generate|review}.md
 * - 镜头：skill-jingtou-{子tab拼音}-{功能}-{generate|review}.md
 * 运行时 name 与文件名去掉 .md 后完全一致。
 */
const files = {
  'skill-gailan-episode-generate': { file: 'skill-gailan-episode-generate.md', category: 'gailan', feature: 'episode', mode: 'generate' },

  'skill-juqing-outline-generate': { file: 'skill-juqing-outline-generate.md', category: 'juqing', feature: 'outline', mode: 'generate' },

  'skill-juese-character-image-generate': { file: 'skill-juese-character-image-generate.md', category: 'juese', feature: 'character-image', mode: 'generate' },
  'skill-juese-scene-image-generate': { file: 'skill-juese-scene-image-generate.md', category: 'juese', feature: 'scene-image', mode: 'generate' },
  'skill-juese-part-image-generate': { file: 'skill-juese-part-image-generate.md', category: 'juese', feature: 'part-image', mode: 'generate' },
  'skill-juese-image-review': { file: 'skill-juese-image-review.md', category: 'juese', feature: 'image', mode: 'review' },

  'skill-jingtou-jingtoubiao-table-generate': { file: 'skill-jingtou-jingtoubiao-table-generate.md', category: 'jingtou', pane: 'jingtoubiao', feature: 'table', mode: 'generate' },
  'skill-jingtou-jingtoubiao-shot-review': { file: 'skill-jingtou-jingtoubiao-shot-review.md', category: 'jingtou', pane: 'jingtoubiao', feature: 'shot', mode: 'review' },
  'skill-jingtou-meimiao-seconds-generate': { file: 'skill-jingtou-meimiao-seconds-generate.md', category: 'jingtou', pane: 'meimiao', feature: 'seconds', mode: 'generate' },
  'skill-jingtou-wenben-storyboard-generate': { file: 'skill-jingtou-wenben-storyboard-generate.md', category: 'jingtou', pane: 'wenben', feature: 'storyboard', mode: 'generate' },
  'skill-jingtou-qianbi-pencil-generate': { file: 'skill-jingtou-qianbi-pencil-generate.md', category: 'jingtou', pane: 'qianbi', feature: 'pencil', mode: 'generate' },

  'skill-chengpian-video-generate': { file: 'skill-chengpian-video-generate.md', category: 'chengpian', feature: 'video', mode: 'generate' },

  'skill-gongyong-content-review': { file: 'skill-gongyong-content-review.md', category: 'gongyong', feature: 'content', mode: 'review' },
  'skill-gongyong-language-generate': { file: 'skill-gongyong-language-generate.md', category: 'gongyong', feature: 'language', mode: 'generate' },
  'skill-gongyong-panel-generate': { file: 'skill-gongyong-panel-generate.md', category: 'gongyong', feature: 'panel', mode: 'generate' },
}

const root = dirname(fileURLToPath(import.meta.url))

const officialSections = {
  'skill-jingtou-jingtoubiao-table-generate': ['## STEP 5：', '## STEP 6：'],
  'skill-jingtou-jingtoubiao-shot-review': ['## STEP 5：', '## STEP 6：'],
  'skill-jingtou-meimiao-seconds-generate': ['## STEP 5：', '## STEP 6：'],
  'skill-jingtou-wenben-storyboard-generate': ['### 默认路径：', '### 按镜抽取'],
  'skill-jingtou-qianbi-pencil-generate': ['### Opt-in 路径：', '### 分镜批准'],
}

function officialReference(name) {
  const referenceRoot = join(root, 'references/minimax-h3')
  const parts = []
  const section = officialSections[name]
  if (section) {
    const source = readFileSync(join(referenceRoot, 'animation.md'), 'utf8')
    const start = source.indexOf(section[0])
    const end = source.indexOf(section[1], start)
    if (start < 0 || end < 0) throw new Error('Missing official section for ' + name)
    parts.push(source.slice(start, end).trim().replace('**单镜角色数**：任何镜头不超过 3 个重要角色（定义为有画面动作或对白的角色）。', '**同框角色数（Meiji 调整）**：同一画面同时最多 3 个重要角色，群演不计入；单镜可通过运镜、出入画或构图变化先后展示更多角色，整镜角色名单不得截断。'))
  }
  if (name === 'skill-jingtou-wenben-storyboard-generate' || name === 'skill-chengpian-video-generate') {
    for (const file of ['prompt.md', 'base-en.txt', 'ref-en.txt']) {
      parts.push(readFileSync(join(referenceRoot, file), 'utf8').trim())
    }
  }
  return parts.length ? '\n\n## 官方参考（Meiji 适配版）\n\n以下为已注入的官方参考，语言要求已按项目设置适配，无需再次读取文件。Meiji 的输出协议（镜头阶段自由文本）、语言规则和分阶段操作以上文为准；文本分镜及最终视频 prompt 的描述跟随项目 outputLanguage 配置，以下参考中的英文写作要求和英文示例不决定输出语言，协议标题与引用标签仍保持原样；本次不执行其他阶段或画布工具调用。\n\n' + parts.join('\n\n') : ''
}

function filePattern(entry) {
  return entry.pane
    ? `skill-${entry.category}-${entry.pane}-${entry.feature}-${entry.mode}.md`
    : `skill-${entry.category}-${entry.feature}-${entry.mode}.md`
}

export function loadSkill(expectedName) {
  const entry = files[expectedName]
  if (!entry) throw new Error('unknown skill: ' + expectedName)
  const expectedFile = filePattern(entry)
  if (entry.file !== expectedFile) throw new Error(`${expectedName} file should be ${expectedFile}`)
  const absolute = join(root, entry.file)
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(readFileSync(absolute, 'utf8'))
  if (!match) throw new Error(entry.file + ' is missing frontmatter')
  const name = /^name:\s*(.+)$/m.exec(match[1])?.[1].trim()
  const description = /^description:\s*(.+)$/m.exec(match[1])?.[1].trim()
  if (name !== expectedName || !description) throw new Error(entry.file + ' frontmatter is invalid')
  return {
    name,
    description,
    category: entry.category,
    pane: entry.pane || null,
    feature: entry.feature,
    mode: entry.mode,
    source: 'runtime',
    content: match[2].trim() + officialReference(expectedName),
    path: absolute,
    // 内容已注入；不要再让模型按相对路径去 skills/ 下拼文件名
    resourceBase: { kind: 'opaque', description: `Meiji skill ${expectedName}（正文已注入会话，勿再打开本地 md）` },
  }
}

export function allSkills() {
  return Object.keys(files).map(loadSkill)
}

export function skillFilesOnDisk() {
  return readdirSync(root)
    .filter(name => name.startsWith('skill-') && name.endsWith('.md'))
    .sort()
}

export function registeredSkillFiles() {
  return Object.values(files).map(entry => entry.file).sort()
}

/** 面板提示用绝对路径，避免相对 skills/ 被二次拼接 */
export function skillFilePath(expectedName) {
  return loadSkill(expectedName).path
}

export function knownSkillNames() {
  return Object.keys(files)
}
