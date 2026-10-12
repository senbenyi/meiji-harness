import { locateTarget, nodeOf } from "../../shared/task_contract.js";
import { expireDownstream } from "../../shared/node-dependencies.js";
export function applyDelete(snapshot, task) {
  const p = snapshot.project,
    { object, character } = locateTarget(p, task.business_type, task.target_id);
  if (task.business_type === "character-delete")
    p.角色库.角色 = p.角色库.角色.filter((c) => c.id !== object.id);
  else {
    for (const e of p.剧集)
      for (const s of e.镜头表.镜头)
        for (const r of s.出镜角色)
          if (r.服装id === object.id) {
            r.服装id = character.默认服装id;
            const node = nodeOf(p, "video", s.id);
            if (node.状态 === "generated") {
              node.状态 = "expired";
              node.原因 = "引用服装已删除";
            }
            if (node.状态 === "queued") {
              const t = snapshot.tasks.find(
                (t) =>
                  t.target_id === s.id &&
                  t.business_type === "video" &&
                  t.task_status === "queued",
              );
              if (t?.previous_node_state.状态 === "generated")
                t.previous_node_state = {
                  状态: "expired",
                  原因: "引用服装已删除",
                };
            }
            expireDownstream(snapshot, "video", s.id, "引用服装已删除");
          }
    character.服装 = character.服装.filter((co) => co.id !== object.id);
  }
}
