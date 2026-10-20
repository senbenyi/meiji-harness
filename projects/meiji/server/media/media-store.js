import {
  mkdir,
  writeFile,
  readFile,
  rename,
  rm,
  lstat,
} from "node:fs/promises";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { assertId, invalid } from "../../shared/task_contract.js";
const execute = promisify(execFile);
export async function inspectMedia(path, kind) {
  const { stdout } = await execute(
    "ffprobe",
    ["-v", "error", "-show_streams", "-show_format", "-of", "json", path],
    { maxBuffer: 1024 * 1024 },
  );
  const info = JSON.parse(stdout),
    video = info.streams?.find((s) => s.codec_type === "video");
  if (
    !video ||
    video.width < 1 ||
    video.height < 1 ||
    (kind === "video" && !(Number(info.format?.duration) > 0))
  )
    invalid("媒体", "无效或空媒体文件");
  await execute("ffmpeg", ["-v", "error", "-i", path, "-f", "null", "-"], {
    maxBuffer: 1024 * 1024,
  });
  return {
    width: video.width,
    height: video.height,
    duration: Number(info.format?.duration) || 0,
  };
}
export class MediaStore {
  constructor(root) {
    this.root = root;
  }
  path(address, projectId) {
    assertId(projectId, "project_id");
    const prefix = `/api/meiji/media/${projectId}/`;
    if (
      typeof address !== "string" ||
      !address.startsWith(prefix) ||
      !/^asset_[a-f0-9-]{36}\.(png|jpg|webp|mp4)$/.test(
        address.slice(prefix.length),
      )
    )
      invalid("地址", "媒体路径非法或跨项目");
    return join(this.root, projectId, address.slice(prefix.length));
  }
  async read(address, projectId) {
    const path = this.path(address, projectId),
      stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink())
      invalid("媒体", "不能读取符号链接");
    return readFile(path);
  }
  async validate(address, projectId, kind) {
    const path = this.path(address, projectId);
    try { await this.read(address, projectId); }
    catch (error) {
      if (error.code === 'ENOENT') invalid('媒体', '文件不存在');
      throw error;
    }
    try { return await inspectMedia(path, kind); }
    catch (error) {
      if (typeof error.code === 'number') invalid('媒体', '文件损坏或无法解码');
      throw error;
    }
  }
  async put(projectId, bytes, ext, signal) {
    assertId(projectId, "project_id");
    signal?.throwIfAborted();
    if (
      !Buffer.isBuffer(bytes) ||
      !bytes.length ||
      !["png", "jpg", "webp", "mp4"].includes(ext)
    )
      invalid("媒体", "媒体文件为空或类型无效");
    const directory = join(this.root, projectId);
    await mkdir(directory, { recursive: true });
    const name = `asset_${randomUUID()}.${ext}`,
      temp = join(directory, `.${name}`),
      target = join(directory, name),
      address = `/api/meiji/media/${projectId}/${name}`;
    try {
      await writeFile(temp, bytes, { mode: 0o600, flag: "wx" });
      const info = await inspectMedia(temp, ext === "mp4" ? "video" : "image");
      signal?.throwIfAborted();
      await rename(temp, target);
      return { address, path: target, ...info };
    } finally {
      await rm(temp, { force: true });
    }
  }
}
