/**
 * 把 llm-ai-model/contracts/media-gate-contract.json 同步为 src/domain 下的内联模块。
 *
 * 契约的定义源在模型仓（责任矩阵：单产物技术真实性归模型能力层）。这里内联而不是
 * 读文件，是因为 package.json 的 files 不含 contracts/，插件安装后读不到外部 JSON。
 */
import { createHash } from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const source = path.resolve(root, '../../llm-ai-model/contracts/media-gate-contract.json')
const destination = path.join(root, 'src/domain/media-gate-contract.js')

export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

export function contractHash(contract) {
  return createHash('sha256').update(canonical(contract)).digest('hex')
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (!fs.existsSync(source)) {
    console.error(`找不到契约定义源：${source}\n本脚本需要与 llm-ai-model 并列签出。`)
    process.exit(1)
  }
  const contract = JSON.parse(fs.readFileSync(source, 'utf8'))
  const hash = contractHash(contract)
  const body = `// 本文件由 scripts/sync-media-gate-contract.mjs 生成，请勿手改。
// 定义源：llm-ai-model/contracts/media-gate-contract.json
//
// 阈值变更等于全部历史 receipt 失效：receipt.contractVersion 低于 CONTRACT.contractVersion
// 的产物不得复用，必须重判。

export const CONTRACT = ${JSON.stringify(contract, null, 2)}

/** 规范化 JSON 的 sha256，用于检测与定义源的漂移。 */
export const CONTRACT_HASH = ${JSON.stringify(hash)}
`
  fs.writeFileSync(destination, body)
  console.log(`已同步契约 ${contract.contractVersion}（${contract.rules.length} 条规则）-> ${path.relative(root, destination)}`)
  console.log(`hash ${hash}`)
}
