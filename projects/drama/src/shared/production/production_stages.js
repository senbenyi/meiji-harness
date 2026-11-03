// 浏览器与服务端共用的阶段目录，不导入模型、文件或业务执行器。
export const projectStages=Object.freeze([
 {id:'project',title:'短剧与原稿',field:'source',kind:'program'},
 {id:'source_analysis',title:'原著解析',field:'source_analysis',kind:'program'},
 {id:'adaptation_plan',title:'联合改编规划',field:'adaptation_plan',kind:'ai'},
 {id:'story_segments',title:'故事分段定稿',field:'story_segments',kind:'ai'},
 {id:'shot_design',title:'文字分镜',field:'shot_design',kind:'ai'},
 {id:'asset_preparation',title:'素材与人物定妆',field:'asset_library',kind:'image'},
 {id:'reference_binding',title:'分镜参考确认',field:'shot_design',kind:'program'},
 {id:'clip_arrangement',title:'生成分片编排',field:'clip_arrangement',kind:'program'},
 {id:'video_prompt',title:'视频提示词',field:'video_prompt',kind:'ai'},
 {id:'video_render',title:'视频与声音',field:'videos',kind:'video'},
 {id:'editing',title:'连续剪辑与后期',field:'editing',kind:'program'},
 {id:'delivery',title:'最终分集与导出',field:'delivery',kind:'program'},
])

export function stageProduct(document,stageId){
 const stage=projectStages.find(row=>row.id===stageId)
 if(!stage)throw new TypeError('未知制作步骤')
 if(stageId==='delivery')return {episodes:document.episodes,delivery:document.delivery}
 if(stageId==='shot_design')return {shot_design:document.shot_design,asset_requirements:document.asset_requirements}
 return document[stage.field]
}
