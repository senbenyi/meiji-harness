// One-time addition of derived frame image nodes; no library assets are created.
import { projectStore } from '../server/data/projects.js'
import { node } from '../client/drama-model.js'
const home = process.argv[2]
if (!home) throw new Error('请传入 DSH_HOME')
const store = projectStore(home)
for (const project of await store.list()) {
 if (project.episodes.some(e => e.activity)) throw new Error('仍有任务运行，先停止任务再迁移')
 await store.save(project.id, current => {
  for (const e of current.episodes) for (const shot of e.shots.items) {
   if (!shot.tailFrame) shot.tailFrame = node(`tailFrame:${shot.id}`)
  }
  return current
 })
}
