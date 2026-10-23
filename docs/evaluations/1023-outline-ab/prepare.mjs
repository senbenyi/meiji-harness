import {readFile,writeFile} from 'node:fs/promises'
import {nodeDefinitions} from '../../../projects/drama/src/node_runtime/node_definition_registry.js'
const dir=new URL('./',import.meta.url),load=async p=>JSON.parse(await readFile(new URL(p,import.meta.url),'utf8')),save=async(p,x)=>writeFile(new URL(p,dir),JSON.stringify(x,null,2)+'\n')
const story=await load('../../../projects/drama/skills/story_segments.json'),shot=await load('../../../projects/drama/skills/shot_design.json')
const aStory=structuredClone(story),aShot=structuredClone(shot),bStory=structuredClone(story),bShot=structuredClone(shot)
const aDefs=structuredClone(nodeDefinitions),bDefs=structuredClone(nodeDefinitions)
for(const field of ['world_background','characters_and_groups','scene_and_space','emotion_and_rhythm']) {
 delete bDefs.story_segments.output.properties.segments.items.properties[field]
 bDefs.story_segments.output.properties.segments.items.required=bDefs.story_segments.output.properties.segments.items.required.filter(x=>x!==field)
}
bDefs.story_segments.output.properties.segments.items.properties.body.description='最终改编定稿的完整可表演正文及定稿对白，直接呈现必要背景、人物目标与反应、空间行动、情绪节奏及转场；不另设解释字段，下游以此为唯一完整叙事依据。'
for(const action of ['generate','review','revise']) {
 const aParagraph='本方案使用多字段大纲。body承载完整叙事，world_background、characters_and_groups、scene_and_space、emotion_and_rhythm分别提炼有效背景、人物参与、空间行动与情绪节奏，作为下游检索辅助；必须与正文一致，不用辅助字段代替正文中的必要过程。'
 aStory.rules[action].base=aParagraph+'\n\n'+aStory.rules[action].base
 let s=bStory.rules[action].base
 const from=s.indexOf('body保存最终改编后的完整剧情'),end=s.indexOf('\nkey_anchors.content',from)
 if(from<0||end<0)throw new Error('源规则变化，请重新检查B规则适配')
 s=s.slice(0,from)+'body是唯一完整叙事载体。将必要背景、人物目标动机与反应、关系变化、初始站位和行动空间、情绪推进、信息揭示、转场与完整定稿对白直接落实在可表演的连续正文中，不另设背景、人物说明、空间说明或情绪说明字段。无需机械为每段写全所有信息，只保留本段因果与观看理解所必需的内容。不把创作解释堆入正文，也不用标签代替人物行动。'+s.slice(end)
 s=s.replace('联动正文、定稿对白、锚点、背景、人物与空间、情绪及必要的前后交接','联动正文内的定稿对白、人物与空间状态、情绪推进、锚点及必要的前后交接')
 bStory.rules[action].base='本方案使用精简大纲结构，只输出id、title、body、key_anchors、duration_seconds、continuity。必要信息在body中充分表达，锚点仅保存容易遗漏且必须保留的限定，交接仅保存必要跨段状态，不重复复述正文。\n\n'+s
 aShot.rules[action].base='输入方案：多字段大纲。先完整阅读body，再结合world_background、characters_and_groups、scene_and_space、emotion_and_rhythm理解本段必要背景、人物、空间与情绪。辅助字段只帮助落实正文，不是新增剧情来源；有实际矛盾则定位上游，不自行选择性改戏。key_anchors用于覆盖核对，continuity用于跨段承接。\n\n'+aShot.rules[action].base
 bShot.rules[action].base='输入方案：精简大纲。背景、人物动机与反应、空间与情绪节奏已融入body，必须完整读取连续正文并跟随其中行动因果生成镜头，不要求或补造独立背景/人物/空间/情绪说明字段。key_anchors仅是重点限定清单，不能以其代替正文；continuity仅辅助跨段状态交接。不得再做剧情改编或把正文压缩成只拍锚点。\n\n'+bShot.rules[action].base
}
for(const [p,x]of Object.entries({'rules/A-story.json':aStory,'rules/A-shot.json':aShot,'rules/A-definitions.json':aDefs,'rules/B-story.json':bStory,'rules/B-shot.json':bShot,'rules/B-definitions.json':bDefs}))await save(p,x)
console.log('两套独立规则与Schema已保存；B保留字段：'+Object.keys(bDefs.story_segments.output.properties.segments.items.properties).join(','))
