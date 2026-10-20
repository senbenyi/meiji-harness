import { locateTarget, nodeOf } from "../../shared/task_contract.js";
import { expireDownstream } from "../../shared/node-dependencies.js";
export function applyDelete(snapshot, task) {
  const p = snapshot.project,
    { object, character } = locateTarget(p, task.business_type, task.target_id);
  if (task.business_type === "character-delete")
    p.character_library.characters = p.character_library.characters.filter((c) => c.id !== object.id);
  else {
    for (const e of p.episodes)
      for (const s of e.shot_list.shots)
        for (const r of s.on_screen_characters)
          if (r.costume_id === object.id) {
            r.costume_id = character.default_costume_id;
            if (e.shot_list.node_state.status === "generated") {
              e.shot_list.node_state.status = "expired";
              e.shot_list.node_state.reason = "引用服装已删除，请确认镜头表出镜服装";
            }
            expireDownstream(snapshot, "shots", e.id, "引用服装已删除");
            const node = nodeOf(p, "video", s.id);
            if (node.node_state.status === "generated") {
              node.node_state.status = "expired";
              node.node_state.reason = "引用服装已删除";
            }
            const t = snapshot.tasks.find(
              (t) =>
                t.target_id === s.id &&
                t.business_type === "video" &&
                t.task_status === "queued",
            );
            if (t?.previous_node_state?.status === "generated")
              t.previous_node_state = {
                status: "expired",
                reason: "引用服装已删除",
              };
            expireDownstream(snapshot, "video", s.id, "引用服装已删除");
          }
    character.costumes = character.costumes.filter((co) => co.id !== object.id);
    character.costume_images = character.costume_images.filter(image => image.costume_id !== object.id);
  }
  expireDownstream(snapshot, "project-characters", p.basic_info.id, "角色或服装资料已删除");
}
