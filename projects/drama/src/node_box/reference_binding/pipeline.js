import {findAsset} from '../asset_preparation/assets.js'
export function bindReferences(project){
  const next=structuredClone(project)
  for(const shot of next.shot_design.shots){const refs=[];const add=(id,role)=>{const {asset}=findAsset(next,id);if(!asset.selected_image_id)throw new TypeError(`镜头${shot.id}缺少已选素材：${asset.name}`);if(!refs.some(r=>r.image_id===asset.selected_image_id))refs.push({image_id:asset.selected_image_id,role})}
    for(const actor of shot.characters)add(actor.look_id||actor.character_id,`人物:${actor.character_id}`)
    if(shot.scene_id)add(shot.scene_id,'场景布局')
    for(const prop of shot.props){const covered=shot.characters.some(c=>next.asset_library.character_looks.find(l=>l.id===c.look_id)?.prop_ids.includes(prop.prop_id));if(!covered)add(prop.prop_id,`道具:${prop.prop_id}`)}
    if(refs.length>9)throw new TypeError(`镜头${shot.id}参考超过9张，请人工调整造型组合或拆镜`)
    shot.reference_images=refs;shot.revision++
  }
  return next
}
