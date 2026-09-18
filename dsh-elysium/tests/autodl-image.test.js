// 职责：验证 AutoDL 图片模板、参考图、角色视图和三视图仍保持 main 分支行为。
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { withConfig } from '../src/utils/config.js'
import { buildImageGraph } from '../src/servers/providers/autodl/workflows/image/graph.js'
import { normalizeImagePlan, validateImagePlan } from '../src/servers/providers/autodl/workflows/image/plan.js'
import { createWorkflowTools } from '../src/harness/index.js'

const backend = { provider: 'autodl', service: 'comfyui', base_url: 'http://127.0.0.1:8188' }
const view = name => `http://127.0.0.1:8188/view?filename=${name}&type=output`
const hash = bytes => createHash('sha256').update(bytes).digest('hex')

test('AutoDL keeps main image and pose assets byte-identical', async () => {
  const expected = {
    'workflow_generate_image.json': '69d729ffad7eb78a5b9f1258c46d0aabfaf8a74fcf55b90c18c4a422f48422c2',
    'workflow_generate_image_reference.json': '9b8ec39ce72fc4732738cf9ba28a7259b2edd97ee410bd3a855f8c5ca5ee7169',
    'workflow_character_front.json': 'f808289a920d67a39660a27e571e055e0b1210076f69e5a6a06f19d16665bb95',
    'workflow_character_view.json': '216df32557b6cdc0a390bc93247a8f84dadb2c15621d3dbe84e3e904d9c36778',
    'workflow_character_sheet.json': 'bbb8719ff3affda5d31d2a96c8c44e87439c467e373126ccd387aa63eacaffcc',
    'poses/front.png': '18f9d9b4bb8742fbc59bb79baba5e73dc82e4bf6e85f0a717d598a5cfcde0d25',
    'poses/side.png': '0871d49f0dcd102475ebb58d282da0e99dfe83ffb33f46c8637b8d5f637f84a0',
    'poses/back.png': '5e72685465b6b69186463a30832f4e1435a854dcf569b5c905af9bc100fcec1d',
  }
  for (const [name, digest] of Object.entries(expected)) {
    assert.equal(hash(await readFile(new URL(`../src/servers/providers/autodl/workflows/image/templates/${name}`, import.meta.url))), digest, name)
  }
})

test('AutoDL builds text, reference, character and sheet image graphs', async () => withConfig({ COMFYUI_URL: backend.base_url, ELYSIUM_BACKEND: backend }, async () => {
  const job = 'a'.repeat(32)
  const textPlan = normalizeImagePlan({ prompt: 'cinematic portrait', seed: 7 })
  validateImagePlan(textPlan)
  const text = await buildImageGraph(textPlan, {}, job)
  assert.equal(text.workflowName, 'workflow_generate_image')
  assert.equal(text.graph['2'].inputs.text, 'cinematic portrait')
  assert.equal(text.graph['5'].inputs.seed, 7)
  assert.equal(text.graph['7'].inputs.filename_prefix, `elysium/${job}/final`)

  const source = view('reference.png'), referencePlan = normalizeImagePlan({ prompt: 'same person', images: [source] })
  validateImagePlan(referencePlan)
  const reference = await buildImageGraph(referencePlan, { [source]: { name: 'reference.png [output]' } }, job)
  assert.equal(reference.workflowName, 'workflow_generate_image_reference')
  assert.equal(reference.graph['8'].inputs.image, 'reference.png [output]')

  const characterPlan = { capability: 'image-generate', params: { prompt: 'full body', preset: 'standard', seed: 666,
    image_path: source, character: { view: 'side', reference_job_id: 'b'.repeat(32) } } }
  validateImagePlan(characterPlan)
  const character = await buildImageGraph(characterPlan, { [source]: { name: 'reference.png [output]' }, pose: { name: 'elysium/poses/side.png [input]' } }, job)
  assert.equal(character.workflowName, 'workflow_character_view')
  assert.equal(character.graph['11'].inputs.image, 'elysium/poses/side.png [input]')

  const paths = ['front.png', 'side.png', 'back.png'].map(view)
  const sheetPlan = { capability: 'image-compose', params: { views: paths.map(path => ({ path, crop: { x: 10, y: 20, width: 300, height: 900 } })) } }
  validateImagePlan(sheetPlan)
  const sheet = await buildImageGraph(sheetPlan, Object.fromEntries(paths.map(path => [path, { name: `${new URL(path).searchParams.get('filename')} [output]`, info: { width: 1024, height: 1024 } }])), job)
  assert.equal(sheet.workflowName, 'workflow_character_sheet')
  assert.equal(sheet.outputNode, '7')
}))

test('character tools are registered with the workflow tools', () => {
  const names = createWorkflowTools().map(tool => tool.name)
  assert.ok(names.includes('model_character_view'))
  assert.ok(names.includes('model_character_sheet'))
})
