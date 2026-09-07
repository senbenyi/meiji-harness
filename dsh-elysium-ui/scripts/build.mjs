import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { clientSource } from './client-source.mjs'

rmSync('lib', { recursive: true, force: true })
mkdirSync('lib')
cpSync('src', 'lib', { recursive: true })
writeFileSync('lib/client.js', clientSource())
