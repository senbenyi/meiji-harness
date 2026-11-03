export function findAsset(project,id){for(const [kind,rows]of Object.entries(project.asset_library)){const asset=rows.find(row=>row.id===id);if(asset)return {kind,asset}}throw new TypeError('资产不存在')}
export function requiredAssets(project){
  const ids=new Set(project.asset_requirements.items.map(row=>row.target_id))
  for(const shot of project.shot_design.shots){if(shot.scene_id)ids.add(shot.scene_id);for(const actor of shot.characters)ids.add(actor.look_id||actor.character_id);for(const prop of shot.props){const combined=shot.characters.some(c=>project.asset_library.character_looks.find(l=>l.id===c.look_id)?.prop_ids.includes(prop.prop_id));if(!combined)ids.add(prop.prop_id)}}
  return [...ids].map(id=>findAsset(project,id))
}

export function preparationState(project){
  const missing=requiredAssets(project).filter(({asset})=>!asset.image_ids.length).length
  return {status:missing?'partial':'confirmed',reason:missing?`尚有 ${missing} 项素材图片未准备`:'素材图片已准备完成'}
}
