#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'

const args = process.argv.slice(2)
const profile = args.find((arg) => !arg.startsWith('--')) || 'web'
const json = args.includes('--json')
const dshHome = process.env.DSH_HOME || join(process.env.HOME || '', '.dsh')
const profileRoot = join(dshHome, 'profiles', profile)
const profilePackage = join(profileRoot, 'package.json')

if (!existsSync(profilePackage)) {
  console.error(`Harness profile not found: ${profileRoot}`)
  process.exit(1)
}

const result = spawnSync('dsh', ['--profile', profile, '--dump-config'], {
  encoding: 'utf8',
  maxBuffer: 32 * 1024 * 1024,
})

if (result.status !== 0) {
  console.error(result.stderr || result.stdout || `dsh exited with ${result.status}`)
  process.exit(result.status || 1)
}

function cleanScalar(value) {
  const trimmed = value.trim()
  if ((trimmed.startsWith("'") && trimmed.endsWith("'")) ||
      (trimmed.startsWith('"') && trimmed.endsWith('"'))) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

function parseEntries(text) {
  const lines = text.split(/\r?\n/)
  const entries = []

  for (let index = 0; index < lines.length; index += 1) {
    const idMatch = lines[index].match(/^(\s*)- id:\s*(.+?)\s*$/)
    if (!idMatch) continue

    const indent = idMatch[1].length
    const entry = { id: cleanScalar(idMatch[2]), name: null, disabled: null }

    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const line = lines[cursor]
      const nextEntry = line.match(/^(\s*)- id:\s*/)
      if (nextEntry && nextEntry[1].length <= indent) break
      const property = line.match(/^(\s+)(name|disabled):\s*(.+?)\s*$/)
      if (!property || property[1].length <= indent) continue
      if (property[2] === 'name' && entry.name === null) entry.name = cleanScalar(property[3])
      if (property[2] === 'disabled' && entry.disabled === null) entry.disabled = cleanScalar(property[3])
    }

    if (entry.name?.startsWith('@deepseek-ai/')) entries.push(entry)
  }

  return entries
}

const profileRequire = createRequire(profilePackage)
const pnpmRootResult = spawnSync('pnpm', ['root', '-g'], { encoding: 'utf8' })
const pnpmStore = pnpmRootResult.status === 0
  ? join(dirname(pnpmRootResult.stdout.trim()), '.pnpm')
  : null

function canonicalPackageName(specifier) {
  if (!specifier.startsWith('@')) return specifier.split('/')[0]
  return specifier.split('/').slice(0, 2).join('/')
}

function readInstalledPackage(name) {
  const packageName = canonicalPackageName(name)
  const found = []

  try {
    const packagePath = profileRequire.resolve(`${packageName}/package.json`)
    const realPath = realpathSync(packagePath)
    const pkg = JSON.parse(readFileSync(realPath, 'utf8'))
    found.push({
      version: pkg.version || null,
      description: pkg.description || '',
      path: dirname(realPath),
    })
  } catch {}

  if (pnpmStore && existsSync(pnpmStore)) {
    const encoded = packageName.replace('/', '+') + '@'
    for (const entry of readdirSync(pnpmStore)) {
      if (!entry.startsWith(encoded)) continue
      const packagePath = join(pnpmStore, entry, 'node_modules', ...packageName.split('/'), 'package.json')
      if (!existsSync(packagePath)) continue
      const pkg = JSON.parse(readFileSync(packagePath, 'utf8'))
      found.push({
        version: pkg.version || null,
        description: pkg.description || '',
        path: dirname(packagePath),
      })
    }
  }

  if (found.length === 0) return null
  const unique = new Map(found.map((item) => [`${item.version}\0${item.path}`, item]))
  const items = [...unique.values()]
  return {
    packageName,
    versions: [...new Set(items.map((item) => item.version).filter(Boolean))].sort(),
    description: items.find((item) => item.description)?.description || '',
    paths: items.map((item) => item.path),
  }
}

function classifyDisabled(value) {
  if (value === null || value === 'false') return 'enabled'
  if (value === 'true') return 'disabled'
  return 'conditional'
}

const entries = parseEntries(result.stdout)
const byPackage = new Map()

for (const entry of entries) {
  const current = byPackage.get(entry.name) || {
    name: entry.name,
    installed: readInstalledPackage(entry.name),
    entries: [],
  }
  current.entries.push({
    id: entry.id,
    state: classifyDisabled(entry.disabled),
    disabledExpression: entry.disabled,
  })
  byPackage.set(entry.name, current)
}

const packages = [...byPackage.values()].sort((a, b) => a.name.localeCompare(b.name))
const missing = packages.filter((pkg) => pkg.installed === null)
const summary = {
  profile,
  profileRoot,
  composedOfficialPackages: packages.length,
  resolvedInstalled: packages.length - missing.length,
  unresolved: missing.length,
  packages,
}

if (json) {
  console.log(JSON.stringify(summary, null, 2))
  process.exitCode = missing.length ? 2 : 0
} else {
  console.log(`# Harness official plugin audit: ${profile}`)
  console.log('')
  console.log(`- Composed official packages: ${summary.composedOfficialPackages}`)
  console.log(`- Resolved from this profile: ${summary.resolvedInstalled}`)
  console.log(`- Unresolved packages: ${summary.unresolved}`)
  console.log('')
  console.log('| Package | Version | Config states | Entry ids |')
  console.log('| --- | --- | --- | --- |')
  for (const pkg of packages) {
    const states = [...new Set(pkg.entries.map((entry) => entry.state))].join(', ')
    const ids = [...new Set(pkg.entries.map((entry) => entry.id))].join(', ')
  console.log(`| \`${pkg.name}\` | ${pkg.installed?.versions.join(', ') || '**missing**'} | ${states} | ${ids} |`)
  }

  process.exitCode = missing.length ? 2 : 0
}
