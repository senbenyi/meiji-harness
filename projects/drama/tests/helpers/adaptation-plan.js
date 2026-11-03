// Shared valid V4 plan for simulated model and document tests.
export function makePlan({direction='明快的戏剧叙事',requirements=[],development='主角为目标采取行动，冲突推动局面变化',character_plans=[],scene_plans=[],group_plans=[],...metadata}={}){
 return {...metadata,creative_constraints:{style:direction,audience:'成年与青少年',adaptation_scope:'保留主线，强化因果',preserve:requirements,allowed_changes:['调整叙事表达'],locked_requirements:requirements},plot_development:development,character_plans,scene_plans,group_plans}
}
