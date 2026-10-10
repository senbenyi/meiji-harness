import {
  mkdir,
  readFile,
  writeFile,
  rename,
  readdir,
  rm,
  lstat,
} from "node:fs/promises";
import { join, extname } from "node:path";
import { randomUUID } from "node:crypto";
import { invalid, assertId } from "../../shared/task-contract.js";
const assetId = (id) => {
  if (
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
      id || "",
    )
  )
    invalid("asset_id", "素材 ID 无效");
};
const categories = ["characters", "costumes", "audio", "video", "scripts"];
export class LibraryStore {
  #root;
  #tail = Promise.resolve();
  constructor(root) {
    this.#root = root;
  }
  async list() {
    let names;
    try {
      names = await readdir(this.#root);
    } catch (error) {
      if (error.code === "ENOENT") return [];
      throw error;
    }
    const rows = [];
    for (const category of names.filter((n) => categories.includes(n))) {
      for (const id of await readdir(join(this.#root, category))) {
        if (!/^[a-f0-9-]{36}$/i.test(id)) continue;
        const path = join(this.#root, category, id),
          stat = await lstat(path);
        if (stat.isSymbolicLink() || !stat.isDirectory())
          invalid("素材", "素材路径非法");
        const metadata = JSON.parse(
          await readFile(join(path, "metadata.json"), "utf8"),
        );
        if (metadata.id !== id || metadata.category !== category)
          invalid("素材", "元数据无效");
        if (!metadata.removedAt) rows.push(metadata);
      }
    }
    return rows;
  }
  async references() {
    return (await this.list())
      .flatMap((row) => row.references || [])
      .map((r) => r.object_id);
  }
  async command(command, repository) {
    const run = this.#tail
      .catch(() => {})
      .then(async () => {
        if (command.type === "import") {
          if (!categories.includes(command.category))
            invalid("category", "素材分类无效");
          const match = /^data:([^;,]+);base64,([a-zA-Z0-9+/=]+)$/.exec(
            command.data || "",
          );
          if (!match) invalid("data", "素材需 Base64 data URL");
          const bytes = Buffer.from(match[2], "base64");
          if (!bytes.length || bytes.length > 128 * 1024 * 1024)
            invalid("data", "素材为空或过大");
          const name = String(command.name || "")
            .split(/[\\/]/)
            .pop();
          if (!name) invalid("name", "素材名称为空");
          const extension = extname(name).toLowerCase();
          if (
            ![
              ".png",
              ".jpg",
              ".jpeg",
              ".webp",
              ".mp3",
              ".wav",
              ".ogg",
              ".mp4",
              ".txt",
              ".md",
            ].includes(extension)
          )
            invalid("name", "文件类型不支持");
          const id = randomUUID(),
            directory = join(this.#root, command.category, id),
            metadata = {
              id,
              originalName: name,
              category: command.category,
              mime: match[1],
              file: "original" + extension,
              references: [],
              createdAt: new Date().toISOString(),
            };
          await mkdir(directory, { recursive: true });
          await writeFile(join(directory, metadata.file), bytes, {
            mode: 0o600,
            flag: "wx",
          });
          await writeFile(
            join(directory, "metadata.json"),
            JSON.stringify(metadata),
            { mode: 0o600, flag: "wx" },
          );
          return { asset: metadata };
        }
        assetId(command.id);
        const row = (await this.list()).find((a) => a.id === command.id);
        if (!row) invalid("id", "素材不存在");
        if (command.type === "delete") {
          if (row.references?.length) invalid("素材", "素材仍被项目引用");
          for (const entry of await repository.list())
            if (!entry.unsupported) {
              const p = (await repository.open(entry.id)).read().project;
              if (JSON.stringify(p).includes(`/api/meiji/library/${row.id}`))
                invalid("素材", "素材仍被项目引用");
            }
          await rm(join(this.#root, row.category, row.id), { recursive: true });
          return { deleted: true };
        }
        if (command.type === "reference") {
          assertId(command.project_id, "project_id");
          assertId(command.object_id, "object_id");
          const model = await repository.open(command.project_id);
          if (
            !model
              .read()
              .project.角色库.角色.some(
                (c) =>
                  c.id === command.object_id ||
                  c.服装.some((co) => co.id === command.object_id),
              )
          )
            invalid("object_id", "角色或服装不存在");
          if (
            !(row.references ||= []).some(
              (r) =>
                r.project_id === command.project_id &&
                r.object_id === command.object_id,
            )
          )
            row.references.push({
              project_id: command.project_id,
              object_id: command.object_id,
            });
        } else if (command.type === "unreference")
          row.references = (row.references || []).filter(
            (r) =>
              !(
                r.project_id === command.project_id &&
                r.object_id === command.object_id
              ),
          );
        else invalid("type", "素材命令无效");
        const path = join(this.#root, row.category, row.id, "metadata.json"),
          temp = path + "." + randomUUID();
        await writeFile(temp, JSON.stringify(row), { mode: 0o600, flag: "wx" });
        await rename(temp, path);
        return { asset: row };
      });
    this.#tail = run;
    return run;
  }
  async file(id) {
    assetId(id);
    const row = (await this.list()).find((a) => a.id === id);
    if (!row) invalid("id", "素材不存在");
    if (!/^original\.[a-z]+$/.test(row.file)) invalid("素材", "文件路径非法");
    return {
      metadata: row,
      bytes: await readFile(join(this.#root, row.category, id, row.file)),
    };
  }
}
