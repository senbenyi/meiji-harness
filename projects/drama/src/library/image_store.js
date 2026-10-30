import {DatabaseSync} from 'node:sqlite'
import {mkdir, readFile, writeFile, rm, stat} from 'node:fs/promises'
import {mkdirSync} from 'node:fs'
import {join} from 'node:path'
import {randomUUID} from 'node:crypto'
import {normalizeImage} from '../production/media.js'

/** 跨项目不可变图片；数据库严格只有id/url，不保存项目语义或选用状态。 */
export class ImageStore {
  constructor(root) {
    this.root = join(root, 'images'); mkdirSync(this.root, {recursive:true})
    this.database = new DatabaseSync(join(root, 'images.sqlite'))
    this.database.exec('CREATE TABLE IF NOT EXISTS images(id TEXT PRIMARY KEY,url TEXT NOT NULL)')
  }
  get(id) {
    if (!/^img_[a-f0-9-]{36}$/i.test(id || '')) throw new TypeError('图片ID无效')
    const row = this.database.prepare('SELECT id,url FROM images WHERE id=?').get(id)
    if (!row) throw Object.assign(new Error('图片不存在'), {code:'ENOENT'})
    return {...row}
  }
  list({offset = 0, limit = 40} = {}) {
    if (!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>100) throw new TypeError('图片分页无效')
    return {items:this.database.prepare('SELECT id,url FROM images ORDER BY rowid DESC LIMIT ? OFFSET ?').all(limit,offset).map(row=>({...row})), total:this.database.prepare('SELECT count(*) AS total FROM images').get().total, offset, limit}
  }
  async read(id) {this.get(id); return readFile(join(this.root, `${id}.png`))}
  async put(bytes, {id = `img_${randomUUID()}`, signal} = {}) {
    // id来自执行器的固定操作ID，重试时复用；不可覆盖已入库文件。
    if (!/^img_[a-f0-9-]{36}$/i.test(id)) throw new TypeError('图片ID无效')
    const old = this.database.prepare('SELECT id,url FROM images WHERE id=?').get(id)
    if (old) {await this.read(id); return {...old}}
    const normalized = await normalizeImage(bytes,{signal}); signal?.throwIfAborted()
    await mkdir(this.root,{recursive:true}); const path=join(this.root,`${id}.png`)
    try {await writeFile(path,normalized,{flag:'wx',mode:0o600})} catch(error) {if(error.code!=='EEXIST')throw error}
    const row={id,url:`/api/drama/images/${id}`}
    this.database.prepare('INSERT OR IGNORE INTO images(id,url) VALUES(?,?)').run(row.id,row.url)
    return row
  }
  async validate(document) {
    const ids=new Set()
    for (const assets of Object.values(document.asset_library)) for (const asset of assets) for (const id of asset.image_ids) ids.add(id)
    for (const shot of document.shot_design.shots) for(const row of shot.reference_images) ids.add(row.image_id)
    for (const item of document.asset_requirements.items) if(item.image_id)ids.add(item.image_id)
    for (const item of document.video_prompt.items) for(const row of item.reference_images) ids.add(row.image_id)
    for (const clip of document.clip_arrangement.clips) for(const id of [clip.first_image_id,clip.last_image_id]) if(id)ids.add(id)
    for (const take of document.videos) for(const id of take.reference_image_ids) ids.add(id)
    for(const id of ids)this.get(id);await Promise.all([...ids].map(id=>stat(join(this.root,`${id}.png`))))
  }
  dispose(){this.database.close()}
}
