import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

/** 本插件自带 skill 的安装标记文件（存在 = 该目录由本插件安装过）。 */
export const STUDIO_SKILL_MARK = '.dsh-studio-manifest'
/** 刷新策略开关：off=完全不刷新（只做首次安装与冲突提示）；force=连用户改过的副本也覆盖。 */
const SKILL_REFRESH = String(process.env.DSH_SVS_SKILL_REFRESH || '').toLowerCase()

let cachedPluginVersion = null
/** 读本插件版本（package.json），用于写入 skill 安装标记的版本戳。 */
export function readPluginVersion(packageRoot) {
  if (cachedPluginVersion) return cachedPluginVersion
  try {
    cachedPluginVersion = JSON.parse(readFileSync(resolve(packageRoot, 'package.json'), 'utf8')).version || '0.0.0'
  } catch { cachedPluginVersion = '0.0.0' }
  return cachedPluginVersion
}

/** 解析安装标记（`key: value` 纯文本；`#` 开头为注释）。 */
export function readSkillStamp(dir) {
  const file = join(dir, STUDIO_SKILL_MARK)
  if (!existsSync(file)) return null
  const out = {}
  try {
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      const t = line.trim()
      if (!t || t.startsWith('#')) continue
      const i = t.indexOf(':')
      if (i > 0) out[t.slice(0, i).trim()] = t.slice(i + 1).trim()
    }
  } catch { return null }
  return out
}

/** 写安装标记（含版本戳与内容哈希）。 */
function writeSkillStamp(dir, { name, pluginVersion, contentHash }) {
  const body = [
    '# dsh-short-video-studio 安装标记',
    '# 本目录由插件安装逻辑复制：内容未被修改时会随插件升级自动刷新；',
    '# 一旦内容哈希与记录不符（= 用户改过），插件不再覆盖，只在日志里提示。',
    `name: ${name}`,
    'source: bundled',
    `pluginVersion: ${pluginVersion}`,
    `contentHash: ${contentHash}`,
    `installedAt: ${new Date().toISOString()}`,
    '',
  ].join('\n')
  writeFileSync(join(dir, STUDIO_SKILL_MARK), body, 'utf8')
}

/**
 * skill 目录内容哈希（sha256，跳过安装标记本身）：
 * 只按"排序后的相对路径 + 内容"计算，所以与 mtime / 复制方式无关，可跨机器比对。
 */
export function hashSkillDir(dir) {
  const files = []
  const walk = (d, rel) => {
    for (const e of readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (rel === '' && e.name === STUDIO_SKILL_MARK) continue
      if (e.name === '.DS_Store') continue
      const r = rel ? rel + '/' + e.name : e.name
      if (e.isDirectory()) walk(join(d, e.name), r)
      else if (e.isFile()) files.push(r)
    }
  }
  walk(dir, '')
  const h = createHash('sha256')
  for (const r of files.sort()) {
    h.update(r)
    h.update('\0')
    h.update(readFileSync(join(dir, ...r.split('/'))))
    h.update('\0')
  }
  return 'sha256:' + h.digest('hex')
}

/**
 * 同步自带 skill（版本戳刷新）——本插件 skill 分发的唯一实现，可注入路径以便测试。
 *
 * 策略（目标目录存在的四种情形）：
 *  1. 带标记 + 内容哈希与记录一致（用户没改过）
 *     → 与源不同就**刷新**（删掉重拷 + 更新版本戳）；相同就只更新版本戳（静默）。
 *  2. 带标记 + 内容哈希与记录不符（用户改过）→ **不覆盖**，记入 keptUserEdited 并提示取新版的方法；
 *     `DSH_SVS_SKILL_REFRESH=force` 时才强制覆盖。
 *  3. 带标记但没有内容哈希（旧版安装）→ 内容与源一致就只补戳（stamped）；不一致则按用户改过处理。
 *  4. 不带标记 → 视为用户自建同名 skill，**不覆盖**，记入 conflicts 并给合并指引。
 * `DSH_SVS_SKILL_REFRESH=off` 时只做首次安装 + 冲突提示，完全不碰已有目录。
 */
export function syncBundledSkills({ srcRoot, dstRoot, pluginVersion, log = () => {}, refresh = SKILL_REFRESH } = {}) {
  const report = { installed: [], refreshed: [], adopted: [], stamped: [], upToDate: [], keptUserEdited: [], conflicts: [], errors: [] }
  if (!existsSync(srcRoot)) return report
  mkdirSync(dstRoot, { recursive: true })
  for (const entry of readdirSync(srcRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const srcDir = join(srcRoot, entry.name)
    const target = join(dstRoot, entry.name)
    const srcHasMark = existsSync(join(srcDir, STUDIO_SKILL_MARK))
    try {
      const srcHash = hashSkillDir(srcDir)
      if (!existsSync(target)) {
        cpSync(srcDir, target, { recursive: true })
        writeSkillStamp(target, { name: entry.name, pluginVersion, contentHash: srcHash })
        report.installed.push(entry.name)
        continue
      }
      const stamp = readSkillStamp(target)
      if (!stamp) {
        // 目标没有安装标记。两种情况要分开：
        //  - 内容与源逐字节一致 → 无法区分「插件早期装的（当时没落戳）」和「全新安装」，
        //    收编：补写版本戳（只写标记文件，绝不碰 skill 内容），从此纳入刷新管理；
        //  - 内容与源不同 → 视为用户/第三方同名 skill，不覆盖，仅记冲突（源带标记时才提示）。
        const curHash = hashSkillDir(target)
        if (srcHasMark && curHash === srcHash) {
          writeSkillStamp(target, { name: entry.name, pluginVersion, contentHash: srcHash })
          report.adopted.push(entry.name)
          continue
        }
        if (srcHasMark) report.conflicts.push(entry.name)
        continue
      }
      if (refresh === 'off') { report.upToDate.push(entry.name); continue }
      const curHash = hashSkillDir(target)
      const userEdited = stamp.contentHash ? curHash !== stamp.contentHash : null // null = 旧版无戳，未知
      if (userEdited === true && refresh !== 'force') {
        report.keptUserEdited.push(entry.name)
        continue
      }
      if (userEdited === null && curHash !== srcHash) {
        // 旧版安装且内容与源不一致：无法判断是用户改的还是插件改的 → 保守不覆盖
        report.keptUserEdited.push(entry.name)
        continue
      }
      if (curHash !== srcHash) {
        rmSync(target, { recursive: true, force: true })
        cpSync(srcDir, target, { recursive: true })
        writeSkillStamp(target, { name: entry.name, pluginVersion, contentHash: srcHash })
        report.refreshed.push(entry.name)
        continue
      }
      // 内容一致：只在版本戳落后（或旧版无戳）时补戳
      if (stamp.contentHash !== srcHash || stamp.pluginVersion !== pluginVersion) {
        writeSkillStamp(target, { name: entry.name, pluginVersion, contentHash: srcHash })
        report.stamped.push(entry.name)
      } else {
        report.upToDate.push(entry.name)
      }
    } catch (error) {
      report.errors.push(`${entry.name}: ${error?.message || String(error)}`)
    }
  }
  return report
}

/** 安装/刷新自带 skills 到 ~/.dsh/skills（启动时调用；只报告发生了变化的部分，避免刷屏）。 */
export function installBundledSkills(packageRoot) {
  try {
    const report = syncBundledSkills({
      srcRoot: resolve(packageRoot, 'skills'),
      dstRoot: join(homedir(), '.dsh', 'skills'),
      pluginVersion: readPluginVersion(packageRoot),
      log: (m) => console.warn(m),
    })
    if (report.installed.length) console.warn(`[dsh-short-video-studio] 已安装自带 skill：${report.installed.join(', ')}`)
    if (report.refreshed.length) console.warn(`[dsh-short-video-studio] 已刷新自带 skill（插件 v${readPluginVersion(packageRoot)}）：${report.refreshed.join(', ')}`)
    if (report.adopted.length) console.warn(`[dsh-short-video-studio] 已纳入刷新管理（补写版本戳）：${report.adopted.join(', ')}`)
    for (const name of report.keptUserEdited) {
      console.warn(
        `[dsh-short-video-studio] 自带 skill "${name}" 的内容与安装记录不符（你改过），本次未覆盖。` +
        `要取插件新版：删除 ~/.dsh/skills/${name} 后重启（或手动合并）；` +
        `要强制覆盖：设 DSH_SVS_SKILL_REFRESH=force 重启。`
      )
    }
    for (const name of report.conflicts) {
      console.warn(
        `[dsh-short-video-studio] 检测到同名 skill "${name}" 已存在于 ~/.dsh/skills/（非本插件安装），未覆盖。` +
        `如需本插件适配版，请删除 ~/.dsh/skills/${name} 后重装插件，或手动合并所需文件。`
      )
    }
    for (const e of report.errors) console.warn('[dsh-short-video-studio] skill 同步失败：' + e)
  } catch (error) {
    console.warn('[dsh-short-video-studio] install skills failed:', error?.message || String(error))
  }
}

