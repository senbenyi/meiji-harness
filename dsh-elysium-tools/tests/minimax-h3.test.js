import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { copyFile, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

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

// Exercise tool -> task builder -> real mode wrapper, replacing GPU execution only.
await writeFile(join(endpoints, 'generate_minimax_h3.sh'), `#!/usr/bin/env bash
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
for (const mode of ['t2va', 'fl2va', 'ref2va']) {
  await copyFile(new URL(`../../../llm-ai-model/scripts/endpoint/generate_minimax_h3_${mode}.sh`, import.meta.url),
    join(endpoints, `generate_minimax_h3_${mode}.sh`))
}
const image = join(artifacts, 'reference.png')
const audio = join(artifacts, 'reference.mp3')
await writeFile(image, 'test image')
await writeFile(audio, 'test audio')

for (const mode of ['t2va', 'fl2va', 'ref2va']) {
  test(`${mode} routes through its fixed-mode script and preserves prompt/media`, async () => {
    const tool = createModelTools().find(t => t.name === `model_generate_minimax_h3_${mode}`)
    assert.equal(tool.parameters.properties.mode, undefined)
    if (mode === 'fl2va') assert.ok(tool.parameters.required.includes('image_path'))
    const args = { prompt: '你好，今天阳光很好。', seed: 123, mode: 'invalid' }
    if (mode === 'fl2va') args.image_path = image
    if (mode === 'ref2va') args.audio_path = audio
    const result = await tool.execute(args)
    assert.equal(result.status, 'succeeded')
    const command = (await readFile(`${result.path}.args`, 'utf8')).trim().split('\n')
    assert.deepEqual(command.slice(0, 2), ['--mode', mode])
    assert.equal(command[command.indexOf('--seed') + 1], '123')
    assert.equal((await readFile(command[command.indexOf('--prompt-file') + 1], 'utf8')).trim(), args.prompt)
    if (mode === 'fl2va') assert.equal(command[command.indexOf('--image') + 1], image)
    if (mode === 'ref2va') assert.equal(command[command.indexOf('--audio') + 1], audio)
    const override = spawnSync('bash', [join(endpoints, `generate_minimax_h3_${mode}.sh`), '--mode=t2va'])
    assert.equal(override.status, 2)
  })
}

test('reference modes reject missing media before running the endpoint', async () => {
  for (const mode of ['fl2va', 'ref2va']) {
    const tool = createModelTools().find(t => t.name === `model_generate_minimax_h3_${mode}`)
    await assert.rejects(tool.execute({ prompt: 'hello' }), error => error.code === 'MODEL_INPUT_INVALID')
  }
})
