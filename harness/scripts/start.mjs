#!/usr/bin/env node

import { homedir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

// 本机启动入口；服务器模型服务由独立脚本人工管理。
const dshHome = join(homedir(), '.dsh')
execFileSync('dsh', ['web'], {
  env: { ...process.env, DSH_AGENTS_HOME: join(dshHome, 'agents'), DSH_HOME: dshHome },
  stdio: 'inherit',
})
