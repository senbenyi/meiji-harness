import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { clientSource } from './client-source.mjs'

rmSync('lib', { recursive: true, force: true })
mkdirSync('lib', { recursive: true })
cpSync('src', 'lib', { recursive: true })
writeFileSync('lib/client.js', clientSource())
console.log('built lib/ from src/')
