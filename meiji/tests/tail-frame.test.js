import test from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ffmpegAvailable } from '../server/media/check-ffmpeg.js'
import { saveLastFrame } from '../server/media/extract-video-tail.js'

const exec = promisify(execFile)
test('FFmpeg extracts the actual final blue frame after earlier red frames', async t => {
  if (!await ffmpegAvailable()) return t.skip('本机无 FFmpeg')
  const directory = await mkdtemp(join(tmpdir(), 'meiji-tail-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const video = join(directory, 'two-colors.mp4'), frame = join(directory, 'tail.png')
  await exec('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=32x32:r=2:d=1',
    '-f', 'lavfi', '-i', 'color=c=blue:s=32x32:r=2:d=1', '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', video])
  const png = await saveLastFrame(video, frame)
  assert.equal(png.subarray(1, 4).toString(), 'PNG')
  const { stdout } = await exec('ffmpeg', ['-loglevel', 'error', '-i', frame, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], { encoding: 'buffer' })
  assert.ok(stdout[2] > 200 && stdout[0] < 30, '尾帧应为蓝色，不是前段红色')
})
