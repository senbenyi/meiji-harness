import { createHash } from 'node:crypto'
import { createReadStream, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
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
  return process.env.HARNESS_PROXY_AUTH_DISABLED === '1' || request.headers.authorization === expected
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

const deliveryRoot = process.env.HARNESS_DELIVERY_ROOT || '/workspace/harness/deliverables/third-cup'
const deliveries = {
  '/third-cup/film.mp4': { file: '第三杯咖啡-六分钟预览.mp4', type: 'video/mp4' },
  '/third-cup/subtitles.srt': { file: 'subtitles.srt', type: 'application/x-subrip; charset=utf-8' },
}

const server = createServer((request, response) => {
  if (!authorized(request)) return reject(response)
  const delivery = deliveries[request.url?.split('?')[0]]
  if (delivery) {
    if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405, { Allow: 'GET, HEAD' }); return response.end() }
    const path = join(deliveryRoot, delivery.file)
    let size
    try { size = statSync(path).size } catch { response.writeHead(404); return response.end('Delivery not found\n') }
    response.writeHead(200, { 'Content-Type': delivery.type, 'Content-Length': size,
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(delivery.file)}`, 'X-Content-Type-Options': 'nosniff' })
    if (request.method === 'HEAD') return response.end()
    const stream = createReadStream(path)
    stream.on('error', () => response.destroy())
    response.on('close', () => stream.destroy())
    return stream.pipe(response)
  }
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
