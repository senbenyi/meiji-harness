import { cpSync, mkdirSync, rmSync } from 'node:fs'

rmSync('lib', { recursive: true, force: true })
mkdirSync('lib', { recursive: true })
cpSync('src', 'lib', { recursive: true })
console.log('built lib/ from src/')
