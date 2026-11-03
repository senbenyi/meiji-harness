import test from 'node:test'
import assert from 'node:assert/strict'
import {bindReferences} from '../src/node_box/reference_binding/runtime/pipeline.js'
function project(){return {asset_library:{characters:[{id:'person',name:'巴比堪',image_ids:['img_person'],selected_image_id:null}],scenes:[{id:'place',name:'炮场',image_ids:['img_place'],selected_image_id:null}],props:[],character_looks:[]},asset_requirements:{items:[{id:'req',target_id:'place',status:'pending',image_id:null}]},shot_design:{shots:[{id:'private_shot',sequence:1,revision:1,characters:[{character_id:'person',look_id:null}],scene_id:'place',props:[],reference_images:[]}]},node_states:{asset_preparation:{product_revision:3}}}}

test('唯一候选直接选用并绑定，需求同步ready，原文档不变',()=>{
 const p=project(),before=structuredClone(p),bound=bindReferences(p)
 assert.equal(bound.asset_library.characters[0].selected_image_id,'img_person');assert.equal(bound.asset_library.scenes[0].selected_image_id,'img_place')
 assert.deepEqual(bound.shot_design.shots[0].reference_images.map(r=>r.image_id),['img_person','img_place']);assert.equal(bound.asset_requirements.items[0].status,'ready');assert.equal(bound.asset_requirements.items[0].image_id,'img_place');assert.equal(bound.node_states.asset_preparation.product_revision,4);assert.deepEqual(p,before)
 const repeated=bindReferences(bound);assert.equal(repeated.node_states.asset_preparation.product_revision,4);assert.deepEqual(repeated.shot_design.shots[0].reference_images,bound.shot_design.shots[0].reference_images)
})

test('有多个候选但已选图时保留用户选择',()=>{
 const p=project();p.asset_library.characters[0].image_ids.push('img_alternative');p.asset_library.characters[0].selected_image_id='img_alternative'
 const bound=bindReferences(p);assert.equal(bound.shot_design.shots[0].reference_images[0].image_id,'img_alternative');assert.equal(bound.asset_library.characters[0].selected_image_id,'img_alternative')
})

test('多候选未选择时明确提示，不半保存之前已确定的素材',()=>{
 const p=project();p.asset_library.scenes[0].image_ids.push('img_other');const before=structuredClone(p)
 assert.throws(()=>bindReferences(p),/镜头 1 的炮场有多张候选图片/);assert.deepEqual(p,before)
})

test('确实无图时提示镜头序号与素材名称',()=>{
 const p=project();p.asset_library.characters[0].image_ids=[]
 assert.throws(()=>bindReferences(p),/镜头 1 缺少素材图片：巴比堪/)
})

test('同一图片用于多个素材时，镜头参考去重',()=>{
 const p=project();p.asset_library.scenes[0].image_ids=['img_person'];assert.equal(bindReferences(p).shot_design.shots[0].reference_images.length,1)
})

test('定妆已包含的道具不额外要求独立图片',()=>{
 const p=project();p.asset_library.character_looks=[{id:'look',name:'仪式装束',image_ids:['img_look'],selected_image_id:null,prop_ids:['prop']}];p.asset_library.props=[{id:'prop',name:'手杖',image_ids:[],selected_image_id:null}];p.shot_design.shots[0].characters[0].look_id='look';p.shot_design.shots[0].props=[{prop_id:'prop'}]
 assert.deepEqual(bindReferences(p).shot_design.shots[0].reference_images.map(r=>r.image_id),['img_look','img_place'])
})

test('超过9张参考仍拒绝，自动选用不会半写回',()=>{
 const p=project();for(let i=0;i<9;i++){const id='extra_'+i;p.asset_library.characters.push({id,name:'人物'+i,image_ids:['img_'+i],selected_image_id:null});p.shot_design.shots[0].characters.push({character_id:id,look_id:null})}
 const before=structuredClone(p);assert.throws(()=>bindReferences(p),/镜头 1 参考超过9张/);assert.deepEqual(p,before)
})
