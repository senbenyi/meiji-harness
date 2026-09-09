import { createServer } from 'node:http'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

// Protocol fixture, not a substitute for a real ComfyUI graph execution test.
export async function mockComfy(directory) {
  const history = {}, prompts = []
  const controls = { audioTail: 0, corruptShot: false }
  const schemas = JSON.parse(await readFile(new URL('./comfy-schema.json', import.meta.url), 'utf8'))
  schemas.ElysiumSelectFrames = { input: { required: { images: ['IMAGE'], indices: ['STRING'] } }, output: ['IMAGE', 'IMAGE'] }
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost')
      if (url.pathname === '/upload/image') {
        for await (const _ of req) { /* consume multipart body */ }
        res.end(JSON.stringify({ name: 'fixture.mp4', type: 'input' })); return
      }
      if (url.pathname.startsWith('/object_info/')) {
        const type = decodeURIComponent(url.pathname.split('/').at(-1))
        res.end(JSON.stringify(schemas[type] ? { [type]: schemas[type] } : {})); return
      }
      if (url.pathname === '/queue') { res.end(JSON.stringify({ queue_running: [], queue_pending: [] })); return }
      if (url.pathname === '/prompt') {
        let body = ''
        for await (const bytes of req) body += bytes
        const request = JSON.parse(body), graph = request.prompt, id = `prompt-${prompts.length + 1}`
        prompts.push(request)
        const count = ([node]) => graph[node].class_type === 'ImageBatch'
          ? count(graph[node].inputs.image1) + count(graph[node].inputs.image2)
          : graph[node].class_type === 'ElysiumSelectFrames' ? JSON.parse(graph[node].inputs.indices).length : graph[node].inputs.length
        const outputs = {}
        for (const [nodeId, node] of Object.entries(graph)) {
          if (node.class_type !== 'DaSiWa_EnhancedVideoCombine') continue
          const fps = node.inputs.frame_rate, duration = count(node.inputs.images) / fps
          const filename = `${id}-${duration}.mp4`, path = join(directory, filename)
          if (!Object.values(outputs).some(o => o.videos[0].filename === filename)) {
            await promisify(execFile)('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', `color=c=blue:s=480x854:r=${fps}:d=${duration}`,
              '-f', 'lavfi', '-i', `sine=frequency=440:duration=${duration + controls.audioTail}`, '-c:v', 'libx264', '-c:a', 'aac', '-y', path])
          }
          outputs[nodeId] = { videos: [{ filename, subfolder: nodeId, type: 'output' }] }
        }
        history[id] = { prompt: [0, id, graph, request.extra_data], status: { status_str: 'success', completed: true },
          outputs }
        res.end(JSON.stringify({ prompt_id: id })); return
      }
      if (url.pathname === '/history') { res.end(JSON.stringify(history)); return }
      if (url.pathname.startsWith('/history/')) {
        const id = url.pathname.split('/').at(-1)
        res.end(JSON.stringify(history[id] ? { [id]: history[id] } : {})); return
      }
      if (url.pathname === '/view') {
        res.end(controls.corruptShot && /^s\d+_save$/.test(url.searchParams.get('subfolder'))
          ? 'invalid video' : await readFile(join(directory, url.searchParams.get('filename')))); return
      }
      res.writeHead(404).end('{}')
    } catch (error) { res.writeHead(500).end(JSON.stringify({ error: error.message })) }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  return { url: `http://127.0.0.1:${server.address().port}`, prompts, controls,
    close: () => new Promise(resolve => { server.close(resolve); server.closeAllConnections() }) }
}
