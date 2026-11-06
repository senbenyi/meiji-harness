// 测试工厂的direction/development参数仅用于简写测试材料，返回值只包含新契约字段。
export function makePlan({direction='明快的戏剧叙事',requirements=[],development='主角为目标采取行动，冲突推动局面变化',character_plans=[],scene_plans=[],group_plans=[]}={}){
 const item=row=>({original_content:row.original_content||`${row.name}：${row.description||''}`,adaptation_plan:row.adaptation_plan||[row.motivation,row.relationships,row.arc,row.function,row.social_role,row.description].filter(Boolean).join('；')})
 return {audience:'成年与青少年',style:direction,story_direction:{main_plot:development,must_preserve:[...requirements],constraints:[...requirements]},character_plans:character_plans.map(item),group_plans:group_plans.map(item),scene_plans:scene_plans.map(item)}
}
