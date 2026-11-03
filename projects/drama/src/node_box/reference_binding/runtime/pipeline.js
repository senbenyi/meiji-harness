import {findAsset} from '../../asset_preparation/runtime/assets.js'
export function bindReferences(project){
  const next=structuredClone(project);let selectionChanged=false
  for(const shot of next.shot_design.shots){const refs=[];const add=(id,role)=>{
      const {asset}=findAsset(next,id)
      if(!asset.selected_image_id){
        if(!asset.image_ids.length)throw new TypeError(`镜头 ${shot.sequence} 缺少素材图片：${asset.name}`)
        if(asset.image_ids.length>1)throw new TypeError(`镜头 ${shot.sequence} 的${asset.name}有多张候选图片，请选定使用哪张`)
        asset.selected_image_id=asset.image_ids[0];selectionChanged=true
      }
      for(const requirement of next.asset_requirements.items)if(requirement.target_id===asset.id&&(requirement.status!=='ready'||requirement.image_id!==asset.selected_image_id)){requirement.status='ready';requirement.image_id=asset.selected_image_id;selectionChanged=true}
      if(!refs.some(r=>r.image_id===asset.selected_image_id))refs.push({image_id:asset.selected_image_id,role})
    }
    for(const actor of shot.characters)add(actor.look_id||actor.character_id,`人物:${actor.character_id}`)
    if(shot.scene_id)add(shot.scene_id,'场景布局')
    for(const prop of shot.props){const covered=shot.characters.some(c=>next.asset_library.character_looks.find(l=>l.id===c.look_id)?.prop_ids.includes(prop.prop_id));if(!covered)add(prop.prop_id,`道具:${prop.prop_id}`)}
    if(refs.length>9)throw new TypeError(`镜头 ${shot.sequence} 参考超过9张，请调整造型组合或拆镜`)
    shot.reference_images=refs;shot.revision++
  }
  if(selectionChanged)next.node_states.asset_preparation.product_revision++
  return next
}
