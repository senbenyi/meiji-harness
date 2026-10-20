import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'

const writes = new Map()

function invalid(path, message) {
  throw Object.assign(new TypeError(`${path}：${message}`), { code: 'INVALID_PROJECT', path })
}

export function assertProject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    invalid('project', '需为普通对象')
  }
  return value
}

export function parseProject(text) {
  try {
    const value = JSON.parse(text)
    return assertProject(value)
  } catch (error) {
    if (error.code === 'INVALID_PROJECT') throw error
    invalid('file', '需为JSON对象')
  }
}

/** 保存当前项目数据，并把 update 限定为写入本地 JSON。 */
export class ProjectModel {
  #file
  #project

  constructor(file, project) {
    if (typeof file !== 'string' || !file.trim()) invalid('file', '需为文件路径')
    this.#file = resolve(file)
    this.#project = structuredClone(assertProject(project))
  }

  get file() {
    return this.#file
  }

  read() {
    return structuredClone(this.#project)
  }

  replace(project) {
    this.#project = structuredClone(assertProject(project))
  }

  async update() {
    const file = this.#file
    const body = `${JSON.stringify(this.#project, null, 2)}\n`
    const pending = writes.get(file) || Promise.resolve()
    const operation = pending.catch(() => {}).then(async () => {
      await mkdir(dirname(file), { recursive: true })
      const temporary = `${file}.${randomUUID()}.tmp`
      try {
        await writeFile(temporary, body, { mode: 0o600, flag: 'wx' })
        await rename(temporary, file)
        await chmod(file, 0o600)
      } finally {
        await rm(temporary, { force: true })
      }
    })
    writes.set(file, operation)
    const release = () => { if (writes.get(file) === operation) writes.delete(file) }
    operation.then(release, release)
    return operation
  }
}

export async function readProjectFile(file) {
  if (typeof file !== 'string' || !file.trim()) invalid('file', '需为文件路径')
  const path = resolve(file)
  try {
    return { file: path, project: parseProject(await readFile(path, 'utf8')) }
  } catch (error) {
    if (error.code === 'ENOENT') invalid('file', '项目文件不存在')
    throw error
  }
}
