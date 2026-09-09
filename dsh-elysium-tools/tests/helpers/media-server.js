import { writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

// Protocol simulation: no AI model inference. Concat honors graph input order.
export async function mockMedia(directory) {
  const schemas = JSON.parse(await readFile(new URL('./media-schema.json', import.meta.url), 'utf8'))
  const prompts = [], history = {}, controls = { fail: false, views: [] }
  const originalFiles = new Map()
  let corrupt = false
  Object.defineProperty(controls, 'corruptOutput', { get:()=>corrupt, set:value=>{corrupt=value;if(!value){for(const [path,bytes] of originalFiles)writeFileSync(path,bytes);originalFiles.clear()}} })
  const run = promisify(execFile)
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost')
      if (url.pathname.startsWith('/object_info/')) { const type = decodeURIComponent(url.pathname.split('/').at(-1)); const schema = structuredClone(schemas[type]); if (type === 'LoadImage') schema.input.required.image[0] = []; if (type === 'LoadVideo') schema.input.required.file = ['STRING']; res.end(JSON.stringify({ [type]: schema })); return }
      if (url.pathname === '/prompt') {
        let body = ''; for await (const bytes of req) body += bytes
        const request = JSON.parse(body), g = request.prompt, id = `media-${prompts.length + 1}`
        prompts.push(request)
        if (controls.fail) history[id] = { prompt: [0, id, g, request.extra_data], status: { status_str: 'error', messages: [] } }
        else {
          const image = g['7'].class_type === 'SaveImage', name = `${id}${image ? '.png' : '.mp4'}`, path = join(directory, name)
          if (image) await run('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', `color=c=blue:s=${g['4'].inputs.width}x${g['4'].inputs.height}`, '-frames:v', '1', path])
          else {
            const files = ([node]) => g[node].class_type === 'ImageBatch' ? [...files(g[node].inputs.image1), ...files(g[node].inputs.image2)] : [join(directory, g[g[node].inputs.video[0]].inputs.file.replace(/ \[(input|output)\]$/, ''))]
            const paths = files(g['7'].inputs.images), list = join(directory, `${id}.txt`)
            await writeFile(list, paths.map(p => `file '${p}'`).join('\n'))
            await run('ffmpeg', ['-v', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', path])
          }
          if (controls.corruptOutput) { originalFiles.set(path,await readFile(path));await writeFile(path,'corrupt media') }
          history[id] = { prompt: [0, id, g, request.extra_data], status: { completed: true, status_str: 'success' }, outputs: { '7': { [image ? 'images' : 'videos']: [{ filename: name, type: 'output', subfolder: '' }] } } }
        }
        res.end(JSON.stringify({ prompt_id: id })); return
      }
      if (url.pathname === '/queue') { res.end(JSON.stringify({ queue_running: [], queue_pending: [] })); return }
      if (url.pathname.startsWith('/history')) { const id = url.pathname.split('/')[2]; res.end(JSON.stringify(id ? history[id] ? { [id]: history[id] } : {} : history)); return }
      if (url.pathname === '/view') { controls.views.push(url.href); res.end(controls.corruptOutput ? Buffer.from('corrupt media') : await readFile(join(directory, url.searchParams.get('subfolder') || '', url.searchParams.get('filename')))); return }
      res.writeHead(404); res.end('{}')
    } catch (e) { res.writeHead(500); res.end(JSON.stringify({ error: e.message })) }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  return { url: `http://127.0.0.1:${server.address().port}`, prompts, controls, close: () => new Promise(resolve => { server.close(resolve); server.closeAllConnections() }) }
}
