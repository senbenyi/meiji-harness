import { projectFrameSize } from '../../shared/media-parameters.js';
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { inspectMedia } from "./media-store.js";

const execute = promisify(execFile);

// 网关支持的请求尺寸与项目输出像素不同；只处理本次新生成的媒体。
export async function normalizeVideo(bytes, size, signal) {
  const [width, height] = projectFrameSize(size);
  signal?.throwIfAborted();
  const temp = await mkdtemp(join(tmpdir(), "meiji-video-size-"));
  try {
    const input = join(temp, "input.mp4"), output = join(temp, "output.mp4");
    await writeFile(input, bytes);
    const info = await inspectMedia(input, "video");
    signal?.throwIfAborted();
    if (info.width === width && info.height === height) return bytes;
    await execute("ffmpeg", [
      "-y", "-hide_banner", "-loglevel", "error", "-i", input,
      "-map", "0:v:0", "-map", "0:a?",
      "-vf", `scale=${width}:${height}:force_original_aspect_ratio=decrease:force_divisible_by=2,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1`,
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac",
      "-movflags", "+faststart", output,
    ], { signal, maxBuffer: 1024 * 1024 });
    signal?.throwIfAborted();
    await inspectMedia(output, "video");
    signal?.throwIfAborted();
    return await readFile(output);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}
