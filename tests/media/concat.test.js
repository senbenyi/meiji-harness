import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ffmpegConcat } from '../../lib/concat.js'

const hasFfmpeg = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0

function fixture(path, color, frequency) {
  const result = spawnSync('ffmpeg', [
    '-y', '-f', 'lavfi', '-i', `color=c=${color}:s=320x180:r=24:d=1`,
    '-f', 'lavfi', '-i', `sine=frequency=${frequency}:sample_rate=32000:duration=1`,
    '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', path,
  ], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
}

test('ffmpegConcat atomically retimes video and audio to target duration', { skip: !hasFfmpeg }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-concat-test-'))
  const a = join(dir, 'a.mp4')
  const b = join(dir, 'b.mp4')
  const out = join(dir, 'out.mp4')
  fixture(a, 'red', 440)
  fixture(b, 'blue', 660)

  const result = await ffmpegConcat([a, b], out, { targetDuration: 3, strategy: 'retime' })
  assert.equal(result.retimed, true)
  assert.ok(Math.abs(result.probe.duration - 3) <= 0.15, result.probe.duration)
  assert.equal(result.probe.hasAudio, true)
  assert.ok(result.probe.frames > 0)
  assert.ok((await stat(out)).size > 0)
})

test('strict target mismatch fails without publishing output', { skip: !hasFfmpeg }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-concat-strict-'))
  const a = join(dir, 'a.mp4')
  const b = join(dir, 'b.mp4')
  const out = join(dir, 'out.mp4')
  fixture(a, 'red', 440)
  fixture(b, 'blue', 660)

  await assert.rejects(() => ffmpegConcat([a, b], out, { targetDuration: 3, strategy: 'strict' }), /concat-duration-mismatch/)
  await assert.rejects(() => stat(out), /ENOENT/)
})

test('relative source paths are normalized before writing concat list', { skip: !hasFfmpeg }, async () => {
  const dir = await mkdtemp(join(process.cwd(), '.tmp-concat-relative-'))
  try {
    const a = join(dir, 'a.mp4')
    const b = join(dir, 'b.mp4')
    const out = join(dir, 'out.mp4')
    fixture(a, 'red', 440)
    fixture(b, 'blue', 660)
    const relative = (path) => path.slice(process.cwd().length + 1)
    const result = await ffmpegConcat([relative(a), relative(b)], out)
    assert.ok(result.probe.duration > 1.8)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
