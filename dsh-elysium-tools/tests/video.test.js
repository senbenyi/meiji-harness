import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = await realpath(await mkdtemp(join(tmpdir(), 'h3-tools-test-')))
const endpoints = join(root, 'scripts', 'endpoint')
const artifacts = join(root, 'artifacts')
await mkdir(endpoints, { recursive: true })
await mkdir(artifacts)
process.env.LLM_AI_MODEL_ROOT = root
process.env.ARTIFACTS_ROOT = artifacts
process.env.ELYSIUM_TOOLS_STATE_ROOT = join(root, 'state')
after(() => rm(root, { recursive: true, force: true }))
const { createModelTools } = await import('../src/index.js')

// Stub the capability endpoint without a model checkout or GPU.
await writeFile(join(endpoints, 'generate_video.sh'), `#!/usr/bin/env bash
set -eu
args=("$@")
output=''
while (($#)); do
  if [[ "$1" == --output ]]; then output="$2"; shift 2; else shift; fi
done
mkdir -p "$(dirname "$output")"
printf 'test artifact' > "$output"
printf '%s\\n' "\${args[@]}" > "$output.args"
`)
const image = join(artifacts, 'reference.png')
const audio = join(artifacts, 'reference.mp3')
await writeFile(image, 'test image')
await writeFile(audio, 'test audio')

for (const mode of ['text', 'image', 'reference']) {
  test(`${mode} routes through the video capability and preserves prompt/media`, async () => {
    const tool = createModelTools().find(t => t.name === 'model_generate_video')
    assert.deepEqual(tool.parameters.properties.mode.enum, ['text', 'image', 'reference'])
    const args = { prompt: '你好，今天阳光很好。', seed: 123, mode }
    if (mode === 'image') args.image_path = image
    if (mode === 'reference') args.audio_path = audio
    const result = await tool.execute(args)
    assert.equal(result.status, 'succeeded')
    const command = (await readFile(`${result.path}.args`, 'utf8')).trim().split('\n')
    assert.equal(command[command.indexOf('--mode') + 1], { text: 'text', image: 'image', reference: 'reference' }[mode])
    assert.equal(command.filter(arg => arg === '--mode').length, 1)
    assert.equal(command.some(arg => arg === '--provider' || arg.startsWith('--provider=')), false)
    assert.equal(command[command.indexOf('--seed') + 1], '123')
    assert.equal((await readFile(command[command.indexOf('--prompt-file') + 1], 'utf8')).trim(), args.prompt)
    if (mode === 'image') assert.equal(command[command.indexOf('--input') + 1], image)
    if (mode === 'reference') assert.equal(command[command.indexOf('--audio') + 1], audio)
  })
}

test('reference modes reject missing media before running the endpoint', async () => {
  for (const mode of ['image', 'reference']) {
    const tool = createModelTools().find(t => t.name === 'model_generate_video')
    await assert.rejects(tool.execute({ mode, prompt: 'hello' }), error => error.code === 'MODEL_INPUT_INVALID')
  }
})

test('video rejects missing or unknown modes', async () => {
  const tool = createModelTools().find(t => t.name === 'model_generate_video')
  for (const mode of [undefined, 'invalid']) {
    await assert.rejects(tool.execute({ mode, prompt: 'hello' }), error => error.code === 'MODEL_INPUT_INVALID')
  }
})
