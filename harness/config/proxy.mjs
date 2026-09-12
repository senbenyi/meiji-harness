import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import httpProxy from 'http-proxy'

const username = 'harness'
const password = readFileSync(process.env.HARNESS_PROXY_PASSWORD_FILE, 'utf8').trim()
const harnessToken = readFileSync(process.env.HARNESS_TOKEN_FILE, 'utf8').trim()
const publicHost = process.env.HARNESS_PUBLIC_HOST
const expected = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`
const harnessCookie = `dsh-auth-${createHash('sha256').update(publicHost).digest('base64url')}`
const proxy = httpProxy.createProxyServer({ target: process.env.HARNESS_TARGET, ws: true, xfwd: true })

function authorized(request) {
  return request.headers.authorization === expected
}

function hasHarnessCookie(request) {
  return (request.headers.cookie ?? '')
    .split(';')
    .some((cookie) => cookie.trim().startsWith(`${harnessCookie}=`))
}

function prepareRequest(request) {
  request.headers.host = publicHost
  if (request.url === '/' && !hasHarnessCookie(request)) {
    request.url = `/?token=${encodeURIComponent(harnessToken)}`
  }
}

function reject(response) {
  response.writeHead(401, { 'WWW-Authenticate': 'Basic realm="DeepSeek Harness"' })
  response.end('Authentication required\n')
}

proxy.on('error', (_error, _request, response) => {
  if (response.writeHead) {
    response.writeHead(502)
    response.end('Harness unavailable\n')
  } else {
    response.destroy()
  }
})

const server = createServer((request, response) => {
  if (!authorized(request)) return reject(response)
  prepareRequest(request)
  proxy.web(request, response)
})

server.on('upgrade', (request, socket, head) => {
  if (!authorized(request)) {
    socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n')
    return
  }
  prepareRequest(request)
  proxy.ws(request, socket, head)
})

server.listen(Number(process.env.HARNESS_PUBLIC_PORT), '0.0.0.0')
