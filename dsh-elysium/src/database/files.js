// 职责：作为源码唯一文件系统入口，统一执行文件、目录、句柄与流操作。
import { constants, createWriteStream as createNodeWriteStream } from 'node:fs'
import {
  chmodSync as chmodPathSync,
  existsSync as pathExistsSync,
  mkdirSync as makeDirectorySync,
  readFileSync as readPathSync,
  readdirSync as readDirectorySync,
  renameSync as renamePathSync,
  statSync as statPathSync,
  writeFileSync as writePathSync,
} from 'node:fs'
import {
  access as accessPath,
  chmod as chmodPath,
  link as linkPath,
  mkdir as makeDirectory,
  open as openPath,
  readFile as readPath,
  readdir as readDirectory,
  realpath as resolveRealPath,
  rename as renamePath,
  rm as removePath,
  rmdir as removeDirectory,
  stat as statPath,
  unlink as unlinkPath,
  writeFile as writePath,
} from 'node:fs/promises'

export { constants }
export const access = (...args) => accessPath(...args)
export const chmod = (...args) => chmodPath(...args)
export const chmodSync = (...args) => chmodPathSync(...args)
export const existsSync = (...args) => pathExistsSync(...args)
export const link = (...args) => linkPath(...args)
export const mkdir = (...args) => makeDirectory(...args)
export const mkdirSync = (...args) => makeDirectorySync(...args)
export const open = (...args) => openPath(...args)
export const readFile = (...args) => readPath(...args)
export const readFileSync = (...args) => readPathSync(...args)
export const readdir = (...args) => readDirectory(...args)
export const readdirSync = (...args) => readDirectorySync(...args)
export const realpath = (...args) => resolveRealPath(...args)
export const rename = (...args) => renamePath(...args)
export const renameSync = (...args) => renamePathSync(...args)
export const rm = (...args) => removePath(...args)
export const rmdir = (...args) => removeDirectory(...args)
export const stat = (...args) => statPath(...args)
export const statSync = (...args) => statPathSync(...args)
export const unlink = (...args) => unlinkPath(...args)
export const writeFile = (...args) => writePath(...args)
export const writeFileSync = (...args) => writePathSync(...args)
export const createWriteStream = (...args) => createNodeWriteStream(...args)

export const closeFile = handle => handle.close()
export const readOpenedFile = (handle, ...args) => handle.readFile(...args)
export const writeOpenedFile = (handle, ...args) => handle.writeFile(...args)
export const statOpenedFile = (handle, ...args) => handle.stat(...args)
export const createReadStream = (handle, options) => handle.createReadStream(options)

export const managedFile = handle => Object.freeze({
  close: (...args) => closeFile(handle, ...args),
  createReadStream: options => createReadStream(handle, options),
  readFile: (...args) => readOpenedFile(handle, ...args),
  stat: (...args) => statOpenedFile(handle, ...args),
  writeFile: (...args) => writeOpenedFile(handle, ...args),
})
