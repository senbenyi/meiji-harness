// 职责：集中定义 Elysium 五类数据目录，业务模块不得自行拼接一级目录。
import { join } from 'node:path'
import { homedir } from 'node:os'
import { requiredConfig } from '../utils/validation.js'

export const defaultElysiumHome = () => join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'storages', 'elysium')
export const storageRoot = () => requiredConfig('ELYSIUM_STATE_ROOT')
export const poolsRoot = (root = storageRoot()) => join(root, 'pools')
export const skillsRoot = (root = storageRoot()) => join(poolsRoot(root), 'skills')
export const projectsRoot = (root = storageRoot()) => join(root, 'projects')
export const runtimeRoot = (root = storageRoot()) => join(root, 'runtime')
export const uploadsRoot = (root = storageRoot()) => join(root, 'uploads')
export const tasksRoot = (root = storageRoot()) => join(projectsRoot(root), 'tasks')
export const jobsRoot = (root = storageRoot()) => join(projectsRoot(root), 'jobs')
export const driverFile = (root = storageRoot()) => join(runtimeRoot(root), 'driver.json')
