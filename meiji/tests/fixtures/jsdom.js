// jsdom 来自 Harness 的依赖：与 configure-harness.sh 一致，优先 HARNESS_DIR，否则使用仓库同级的 deepseek-harness。
import { resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const harness = process.env.HARNESS_DIR || fileURLToPath(new URL('../../../../deepseek-harness', import.meta.url))
export const { JSDOM } = await import(pathToFileURL(resolve(harness, 'node_modules/jsdom/lib/api.js')).href)
