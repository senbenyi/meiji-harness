#!/usr/bin/env node

// 职责：为固定服务器的直连别名安装现有公钥，并更新本机 SSH 连接参数（中转别名不经此脚本修改）。
import { execFileSync } from 'node:child_process'
import { constants } from 'node:fs'
import { access, chmod, copyFile, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const identities = {
  'veo-comfyui-direct': 'id_ed25519_veo_comfyui',
  'veo-qwen38-direct': 'id_ed25519_veo_qwen38',
}

export function parseSshCommand(command) {
  const match = /^ssh\s+-p\s+(\d+)\s+([A-Za-z0-9._-]+)@([A-Za-z0-9.-]+)\s*$/.exec(command)
  if (!match) throw new Error("SSH 命令格式必须为：ssh -p <端口> <用户>@<主机>")
  const port = Number(match[1])
  if (port < 1 || port > 65535) throw new Error('SSH 端口必须为 1–65535')
  return { port: String(port), user: match[2], hostname: match[3] }
}

export function updateHostBlock(config, alias, { hostname, port, user }) {
  const lines = config.split('\n')
  const start = lines.findIndex(line => new RegExp(`^\\s*Host\\s+${alias}\\s*$`).test(line))
  if (start === -1) throw new Error(`~/.ssh/config 中缺少独立的 Host ${alias} 配置`)
  let end = lines.findIndex((line, index) => index > start && /^\s*(?:Host|Match)\s+/i.test(line))
  if (end === -1) end = lines.length

  const values = { hostname, port, user }
  for (const [name, value] of Object.entries(values)) {
    const index = lines.findIndex((line, lineIndex) => lineIndex > start && lineIndex < end && new RegExp(`^\\s*${name}\\s+`, 'i').test(line))
    if (index === -1) {
      lines.splice(end, 0, `    ${name === 'hostname' ? 'HostName' : name[0].toUpperCase() + name.slice(1)} ${value}`)
      end++
    } else {
      const indent = /^\s*/.exec(lines[index])[0]
      const field = name === 'hostname' ? 'HostName' : name[0].toUpperCase() + name.slice(1)
      lines[index] = `${indent}${field} ${value}`
    }
  }
  return lines.join('\n')
}

async function main() {
  const [alias, command, ...extra] = process.argv.slice(2)
  if (!identities[alias] || !command || extra.length) {
    throw new Error("用法：node init/ssh.mjs <veo-comfyui-direct|veo-qwen38-direct> 'ssh -p <端口> <用户>@<主机>'")
  }

  const endpoint = parseSshCommand(command)
  const sshDirectory = join(homedir(), '.ssh')
  const configFile = join(sshDirectory, 'config')
  const privateKey = join(sshDirectory, identities[alias])
  const publicKey = `${privateKey}.pub`
  await Promise.all([
    access(configFile, constants.R_OK | constants.W_OK),
    access(privateKey, constants.R_OK),
    access(publicKey, constants.R_OK),
  ])

  console.log(`正在把现有公钥 ${publicKey} 安装到 ${endpoint.user}@${endpoint.hostname}:${endpoint.port}`)
  execFileSync('ssh-copy-id', ['-i', publicKey, '-p', endpoint.port, `${endpoint.user}@${endpoint.hostname}`], { stdio: 'inherit' })

  const currentConfig = await readFile(configFile, 'utf8')
  const nextConfig = updateHostBlock(currentConfig, alias, endpoint)
  const backupFile = `${configFile}.bak`
  const temporaryFile = `${configFile}.tmp-${process.pid}`
  await copyFile(configFile, backupFile)
  await writeFile(temporaryFile, nextConfig, { mode: 0o600 })
  await rename(temporaryFile, configFile)
  await chmod(configFile, 0o600)

  console.log(`已更新 ${alias}，原配置备份：${backupFile}`)
  execFileSync('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', alias, 'true'], { stdio: 'inherit' })
  console.log(`SSH 验证通过：ssh ${alias}`)
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  await main()
}
