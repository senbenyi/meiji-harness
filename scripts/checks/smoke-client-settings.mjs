/**
 * scripts/checks/smoke-client-settings.mjs — P3/P4 客户端冒烟测试（不启浏览器）。
 *
 * 用轻量 React 垫片 + 宿主 ModuleLoader 仿真加载 lib/client.js，然后：
 *  1) 真跑一遍「ComfyUI 设置页」渲染，断言只保留用户需要的显示位置与连接配置；
 *  2) 断言工具条命令行拼装：档位三档 → tier= + 尺寸随档位（fast 832 / 其余 1344）；
 *  3) 断言 tierPick 的取值与后端解析同源（配置选择 > 注册表首选）。
 *
 * 用法：node scripts/checks/smoke-client-settings.mjs
 */

// 测试隔离：不读本机 ~/.dsh 里的真实配置（里面可能有用户自建策略/档位选择，
// 会把「未指定档位」「档位列表」等断言前提改掉）。纯逻辑测试一律跑在空配置上。
process.env.DSH_SVS_CONFIG = process.env.DSH_SVS_CONFIG || '/nonexistent/svs-smoke-config.json'

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { _internals } from '../../lib/index.js'
import { React as shimReact, renderStable, findAll, textOf, resetHooks } from '../lib/react-shim.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..', '..')

let pass = 0
let fail = 0
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`) }
}
const eq = (name, got, want) => ok(name, got === want, `期望 ${want}，实际 ${got}`)

// 渲染垫片与预览工具共用（scripts/lib/react-shim.mjs）
const React = shimReact
// --- 加载客户端模块 ----------------------------------------------------------
let mod = null
global.window = { __ModuleLoader__: { load: (m) => { mod = m } } }
await import('../../lib/client.js')
ok('client.js 通过 ModuleLoader 注册', Boolean(mod && mod.factory))
const moduleExports = mod.factory((name) => {
  if (name === 'react') return React
  return {} // 其它宿主注入（slots 等）在本测试里不需要
})
ok('暴露 apply/inject', typeof moduleExports.apply === 'function' && Array.isArray(moduleExports.inject))

// --- 捕获设置页组件 ----------------------------------------------------------
let settingsComponent = null
const cfgFixture = {
  baseUrl: 'http://localhost:8188', apiKey: '', pollMs: 2000, timeoutMs: 900000,
  models: {}, assetOverrides: {},
  preferred: { 'video.reference2video': ['elysium-minimax-h3-ref2v'] },
  tiers: { 'video.reference2video': { quality: 'elysium-minimax-h3-ref2v-quality' } },
}
// cfg 显式传空对象：**不使用本机真实配置**。否则用户/开发机在里面存过的策略与档位选择
// 会改变档位列表（availableTiers 收敛）与选中态，测试前提随之漂移。
const apiPayload = await _internals.describeWorkflowsApi(_internals.getRegistry(), { probe: false, cfg: {} })
global.fetch = async (url) => {
  const u = String(url)
  const body = u.includes('/api/config') ? { ok: true, config: cfgFixture } : apiPayload
  return { json: async () => body, ok: true }
}
moduleExports.apply({
  slots: {
    inject: (name, fn) => { if (name === 'settings.section') fn() },
    register: (def, Component) => { if (def.name === 'settings.section') settingsComponent = Component },
  },
  effect: () => {},
  log: () => {}, warn: () => {}, error: () => {},
})
ok('设置页注册了 ComfyUI 段', typeof settingsComponent === 'function')

console.log('\n[1] 设置页渲染（精简用户配置）')
{
  let tree
  let err = null
  resetHooks()
  try { tree = await renderStable(settingsComponent, {}) } catch (e) { err = e }
  ok('渲染不抛异常', !err, err && err.stack && err.stack.split('\n').slice(0, 3).join(' | '))
  const text = textOf(tree)
  ok('保留创作显示位置', text.includes('创作显示位置'))
  ok('保留 ComfyUI 地址', text.includes('ComfyUI 地址'))
  ok('保留可选 API Key', text.includes('API Key（可留空）'))
  ok('保留保存和刷新入口', text.includes('保存') && text.includes('刷新页面'))
  ok('不显示工作流维护功能', !['工作流注册表', '资产覆盖', '导入工作流', '编辑档位'].some((label) => text.includes(label)))
  ok('不显示内部参数名', !['baseUrl', 'canvasHome', 'pollMs', 'timeoutMs'].some((label) => text.includes(label)))
  const inputs = findAll(tree, (n) => n.type === 'input')
  ok('连接配置只有地址和 API Key 两个输入框', inputs.length === 2, `实际 ${inputs.length} 个`)
}

console.log('\n[2] 工具条命令行拼装（tier= 与尺寸随档位）')
{
  const T = moduleExports.__test
  ok('__test 暴露工具条函数', Boolean(T && T.svsVideoHeader && T.tierPick))
  const base = { pipeline: 'r2v', ratio: '16:9', seconds: 124, refs: [{ nodeId: 'n1' }], first: null, last: null }
  // 长边由清单提供（调用方传入）：命令行不再按档位名硬编码尺寸
  const hf = T.svsVideoHeader({ ...base, videoTier: 'fast' }, { longSide: 832 })
  const hb = T.svsVideoHeader({ ...base, videoTier: 'balanced' }, { longSide: 1344 })
  const hq = T.svsVideoHeader({ ...base, videoTier: 'quality' }, { longSide: 1344 })
  ok('fast 档命令行（长边来自清单）', hf.includes('tier=fast') && hf.includes('size=832x480'), hf)
  ok('balanced 档命令行', hb.includes('tier=balanced') && hb.includes('size=1344x768'), hb)
  ok('quality 档命令行', hq.includes('tier=quality') && hq.includes('size=1344x768'), hq)
  ok('未传长边 → 兜底 1344（不按档位名猜）', T.svsVideoHeader({ ...base, videoTier: 'fast' }).includes('size=1344x768'))
  ok('档位未知 → 不拼 tier=（交给服务端按清单解析）', !T.svsVideoHeader({ ...base, videoTier: '' }).includes('tier='))
  ok('带 refs 节点', hf.includes('refs=n1'), hf)
  const hi2v = T.svsVideoHeader({ pipeline: 'i2v', videoTier: 'quality', ratio: '9:16', seconds: 124, first: { nodeId: 'f1' }, last: null }, { longSide: 1344 })
  ok('i2v 命令行（首帧 + 竖版）', hi2v.includes('tier=quality') && hi2v.includes('size=768x1344') && hi2v.includes('first=f1'), hi2v)
  ok('9:16 尺寸推导与后端一致', T.svsDims('9:16', 1344).width === 768 && T.svsDims('9:16', 1344).height === 1344)

  // UI 不得预设档位：列表/默认值都来自矩阵（能力有几个档由注册表决定）
  const r2vTiers = T.tiersOf(apiPayload, 'video.reference2video')
  const i2vTiers = T.tiersOf(apiPayload, 'video.image2video')
  ok('r2v 档位列表来自矩阵', r2vTiers.length > 0 && r2vTiers.includes('fast'), r2vTiers.join(','))
  ok('i2v 档位列表来自矩阵（已补齐 balanced）', i2vTiers.join(',') === 'fast,balanced,quality', i2vTiers.join(','))
  ok('默认档位 = 列表首个（非写死）', T.GEN_DEFAULT.videoTier === '' && T.GEN_DEFAULT.imageTier === '')
  const i2iTiers = T.tiersOf(apiPayload, 'image.image2image')
  ok('图片 i2i 档位来自矩阵', i2iTiers.join(',') === 'fast,balanced,quality', i2iTiers.join(','))
  // 图片已并入 tier 体系（一档一清单）：t2i 的档位列表来自矩阵，长边来自该档清单
  const t2iTiers = T.tiersOf(apiPayload, 'image.text2image')
  ok('图片 t2i 档位列表来自矩阵', t2iTiers.length > 0 && t2iTiers.includes('fast'), t2iTiers.join(','))
  const t2iQ = T.tierPick(apiPayload, 'image.text2image', 'quality')
  ok('t2i quality 档长边读清单', t2iQ && t2iQ.longSide === 2048, String(t2iQ && t2iQ.longSide))
}

console.log('\n[3] tierPick 与后端解析同源')
{
  const T = moduleExports.__test
  const refCap = 'video.reference2video'
  // 不依赖本机配置是否已选过策略：有 selection 就必须用它，没有才回退注册表首选
  const refCap0 = apiPayload.capabilities.find((c) => c.capability === refCap)
  const selQuality = (refCap0.selection || {}).quality
  const pickDefault = T.tierPick(apiPayload, refCap, 'quality')
  eq('有配置选择 → 用配置', pickDefault.id, selQuality || 'elysium-minimax-h3-ref2v-quality')
  // 注入选择（= 设置页选了「有加速」策略或逐档改选）
  const withSel = JSON.parse(JSON.stringify(apiPayload))
  const withSelCap = withSel.capabilities.find((c) => c.capability === refCap)
  withSelCap.selection = { quality: 'elysium-minimax-h3-ref2v-quality' }
  // 后端的 effective 是「选择 + 家族序」算出来的；这里只改 selection，所以把它清掉以测**回退链**
  delete withSelCap.effective
  eq('配置选择生效（quality → Elysium 实现）', T.tierPick(withSel, refCap, 'quality').id, 'elysium-minimax-h3-ref2v-quality')
  // 无选择时才回退到注册表首选（同档第一个候选）
  const noSel = JSON.parse(JSON.stringify(apiPayload))
  const capNoSel = noSel.capabilities.find((c) => c.capability === refCap)
  capNoSel.selection = {}
  eq('无配置选择 → 注册表首选（标准实现）', T.tierPick(noSel, refCap, 'quality').id, capNoSel.groups[0].tiers.quality[0].id)
  eq('读到该档长边（来自清单）', pickDefault.longSide, 1344)
  const fast = T.tierPick(apiPayload, refCap, 'fast')
  eq('fast 档长边（来自清单）', fast.longSide, 832)
  ok('未实测耗时保持未知', !fast.estSeconds, String(fast.estSeconds))
  eq('i2v balanced 档来自清单', T.tierPick(apiPayload, 'video.image2video', 'balanced').id, 'elysium-minimax-h3-i2v-balanced')
  eq('未分档能力 → null', T.tierPick(apiPayload, 'image.from_video', 'quality'), null)
}

console.log('\n[4] 布局回归断言（控件必须可收缩）')
{
  let tree
  resetHooks()
  tree = await renderStable(settingsComponent, {})
  const ctrls = findAll(tree, (n) => (n.type === 'input' || n.type === 'select' || n.type === 'textarea')
    && n.props.style && !['radio', 'checkbox'].includes(n.props.type))
  const bad = ctrls.filter((n) => {
    const st = n.props.style
    return st.width !== '100%' || !st.boxSizing || st.minWidth !== 0
  })
  ok(`输入/下拉控件均可收缩（width:100% + box-sizing + minWidth:0，共 ${ctrls.length} 个）`, bad.length === 0,
    `不合规 ${bad.length} 个：` + bad.slice(0, 3).map((n) => n.props.type || n.type).join(','))
  const grids = findAll(tree, (n) => n.props.style && n.props.style.gridTemplateColumns)
  const badGrid = grids.filter((n) => /1fr/.test(n.props.style.gridTemplateColumns) && !/minmax\(0,\s*1fr\)|auto-fit/.test(n.props.style.gridTemplateColumns))
  ok('栅格列只使用 minmax(0,1fr)/auto-fit（1fr 会被内容撑破）', badGrid.length === 0,
    badGrid.slice(0, 2).map((n) => n.props.style.gridTemplateColumns).join(' / '))
}

console.log('\n[5] 主题适配断言（防硬编码颜色：深色主题下白底浅字＝内容看不见）')
{
  resetHooks()
  const tree = await renderStable(settingsComponent, {})
  const fields = findAll(tree, (n) => ['input', 'select', 'textarea', 'button'].includes(n.type) && n.props.style)
  const literals = []
  for (const n of fields) {
    for (const k of ['color', 'background', 'backgroundColor', 'border', 'borderColor']) {
      const v = n.props.style[k]
      if (typeof v === 'string' && !v.includes('var(--dsw-') && /#|rgb|white|black/i.test(v)) {
        literals.push(`${n.type}.${k}=${v}`)
      }
    }
  }
  ok(`控件颜色全部走宿主主题变量（检查 ${fields.length} 个控件）`, literals.length === 0,
    `硬编码 ${literals.length} 处：` + literals.slice(0, 3).join(', '))
  // 文本/标签同样不能硬编码（否则深色主题下标签几乎不可见）
  const textNodes = findAll(tree, (n) => ['span', 'p', 'div', 'strong', 'label'].includes(n.type) && n.props.style && n.props.style.color)
  const badText = textNodes.filter((n) => !String(n.props.style.color).includes('var(--dsw-'))
  ok(`文本颜色全部走宿主主题变量（检查 ${textNodes.length} 处显式 color）`, badText.length === 0,
    badText.slice(0, 3).map((n) => n.props.style.color).join(', '))
}


process.exitCode = fail ? 1 : 0
