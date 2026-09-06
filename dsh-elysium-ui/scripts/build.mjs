import { cpSync, mkdirSync, rmSync } from 'node:fs'

rmSync('lib', { recursive: true, force: true })
mkdirSync('lib')
cpSync('src', 'lib', { recursive: true })
