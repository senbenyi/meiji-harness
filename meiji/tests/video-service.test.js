import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { videoRequest } from "../server/http/video-request.js";
import { videoPayload, imageParameters } from "../server/http/llm-server/params.js";
import { llmServerClient } from "../server/http/llm-server/client.js";
import { withGatewayTrace } from "../server/gateway/gateway-trace.js";
import { createVideoPromptHandler } from "../server/handlers/video-prompt-handler.js";
import { projectFixture } from "./fixtures/project.js";
import { emptyCharacterModel } from "../shared/models/character_model.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { JSDOM } from "jsdom";
import { PROJECT_ASPECT_RATIOS, projectFrameSize, videoSizeOf, aspectRatioOfSize } from "../shared/media-parameters.js";
import { emptyProject, validateProject } from "../shared/project_contract.js";
import { projectDialog, detailsDialog } from "../client/project-forms.js";
import { ModelRepository } from "../server/data/model-repository.js";
import { dependencyHash, isNodeCurrent } from "../shared/node-dependencies.js";
import { seedQueuedTasks } from "./fixtures/queued-tasks.js";

describe("video-service", () => {
  const image = 'data:image/png;base64,aW1hZ2U=';
  const textPrompt = { integrated_multimodal_description: '(S1)<d>别走。我还有话说。</d>', overall_soundscape: '风声', non_diegetic_music: 'N/A' };
  const input = { type: '文生', textPrompt, duration: 4, aspectRatio: '9:16' };
  const options = { baseUrl: 'http://localhost:11435/v1', model: 'MiniMax-H3' };
  const response = extra => new Response(JSON.stringify({ task_id: 'remote-video', status: 'succeeded', url: 'https://cdn.example/result.mp4?signature=temporary', ...extra }));

  test('三模式发送新接口白名单；首尾帧可显式给目标尾帧，不能混参考图', () => {
    const variants = [input, { ...input, type: '首尾帧', firstFrame: image, lastFrame: image }, { ...input, type: '多模态', referenceImages: [image] }];
    for (const row of variants) {
      const body = videoPayload({ model: 'MiniMax-H3', ...videoRequest(row) });
      assert.equal('model' in body, false);
      assert.equal(body.duration, 4); assert.equal(body.resolution, '768P');
      for (const key of ['seconds', 'size', 'input_reference', 'reference_images']) assert.equal(key in body, false);
      assert.equal(body.ratio, row.type === '首尾帧' ? 'adaptive' : '9:16');
      assert.equal('first_frame' in body, row.type === '首尾帧');
      assert.equal('last_frame' in body, row.type === '首尾帧');
      assert.equal('images' in body, row.type === '多模态');
    }
    for (const row of [{ ...input, lastFrame: image }, { ...input, type: '多模态', referenceImages: [image], lastFrame: image }]) assert.throws(() => videoRequest(row), /不能/);
  });

  test('先合并映射与三段正文再执行7000字符检查，不截断对白或偷偷改秒数', () => {
    const bindings = [{ name: '甲', speaker_tag: '(S2)', costume: '蓝色制服' }];
    const request = videoRequest({ ...input, type: '多模态', referenceImages: [image], referenceBindings: bindings });
    assert.match(request.prompt, /subject_definitions:\n<Subject 1> 是 <Picture 1> 中的"甲"\(S2\)，服装为"蓝色制服"/);
    assert.match(request.prompt, /summary:\n\[reference generation\] 目标视频以 <Subject 1> 作为参考/);
    assert.match(request.prompt, /retention_analysis:\n<Subject 1>（出现在 \[Shot 1\]）：fully_preserved/);
    assert.match(request.prompt, /detailed_description:\n\[Shot 1\] \(S1\)<d>别走。我还有话说。<\/d>/);
    assert.match(request.prompt, /<d>别走。我还有话说。<\/d>/);
    assert.throws(() => videoRequest({ ...input, type: '多模态', referenceImages: [image], referenceBindings: [] }), /一图一项/);
    assert.throws(() => videoRequest({ ...input, textPrompt: { ...textPrompt, integrated_multimodal_description: '长'.repeat(7000) } }), /7000/);
    assert.throws(() => videoRequest({ ...input, duration: 3 }), /4 到 15/);
  });

  test('时间线里的人物和场景改标为 Subject，对白内的姓名保持原文', () => {
    const bindings = [{ name: '甲', speaker_tag: '(S1)', costume: '蓝衣' }, { kind: 'scene', name: '老宅', description: '木门', state: '白天' }];
    const text = { ...textPrompt, integrated_multimodal_description: '[Shot 1] 甲站在老宅门口约两秒。(S1)说：<d>甲，别走。</d>' };
    const request = videoRequest({ ...input, type: '多模态', textPrompt: text, referenceImages: [image, image], referenceBindings: bindings });
    assert.match(request.prompt, /detailed_description:\n\[Shot 1\] <Subject 1>站在<Subject 2>门口约两秒。\(S1\)说：<d>甲，别走。<\/d>/);
    assert.doesNotMatch(request.prompt, /detailed_description:[\s\S]*<Picture /);
    const packed = request.prompt;
    const saved = { ...input, type: '多模态', textPrompt: text, referenceImages: [image, image], referenceBindings: bindings, packedPrompt: packed };
    assert.equal(videoRequest(saved).prompt, packed);
    assert.throws(() => videoRequest({ ...saved, packedPrompt: packed.replace('甲，别走。', '别走。') }), /正文.*不一致/);
  });

  test('实际正文来自已保存编排，修订仅在末尾附加意见', () => {
    const packedPrompt = '明确的参考图映射\n' + Object.entries(textPrompt).map(([key,value]) => `${key}:\n${value}`).join('\n\n');
    const row = { ...input, type: '多模态', referenceImages: [image], packedPrompt };
    assert.equal(videoRequest(row).prompt, packedPrompt);
    assert.equal(videoRequest({ ...row, opinion: '保持动作落点' }, 'regenerate').prompt, packedPrompt + '\n\nRevision instructions:\n保持动作落点');
    assert.throws(() => videoRequest({ ...row, packedPrompt: packedPrompt.replace('别走。我还有话说。', '别走。') }), /正文.*不一致/);
  });

  test('程序编排按图片顺序映射全项目稳定speaker_tag及本镜服装，保存本地地址', async () => {
    const project = projectFixture(), shot = project.episodes[0].shot_list.shots[0];
    const a = emptyCharacterModel({ name: '甲' }), b = emptyCharacterModel({ name: '乙' });
    a.costumes = [{ id: 'coat-a', name: '蓝衣', description: '短外套', color: '蓝', material: '棉', props: [] }];
    a.costume_images = [{ costume_id: 'coat-a', address: 'a.png', node_state: { status: 'generated' } }];
    b.costume_images = [{ costume_id: '', address: 'b.png', node_state: { status: 'generated' } }];
    project.character_library.characters = [a, b];
    shot.on_screen_characters = [{ character_id: b.id, costume_id: '' }, { character_id: a.id, costume_id: 'coat-a' }];
    shot.text_to_video_prompt = { ...shot.text_to_video_prompt, ...textPrompt };
    const handler = createVideoPromptHandler({ media: { validate: async () => {}, read: async address => Buffer.from(address) } });
    const { content } = await handler({ snapshot: { project }, task: { business_type: 'multimodal', target_id: shot.id }, signal: new AbortController().signal });
    assert.deepEqual(content.reference_images, [{ address: 'b.png' }, { address: 'a.png' }]);
    assert.match(content.prompt, /<Subject 1> 是 <Picture 1> 中的"乙"\(S\d+\)/); assert.match(content.prompt, /<Subject 2> 是 <Picture 2> 中的"甲"\(S\d+\)[\s\S]*蓝衣/);
    const tag = [...[a.id, b.id]].sort((x,y) => x.localeCompare(y)).indexOf(b.id) + 1;
    assert.match(content.prompt, new RegExp(`<Subject 1> 是 <Picture 1> 中的"乙"\\(S${tag}\\)`));
    assert.doesNotMatch(JSON.stringify(content), /data:image/);
  });

  test('成功响应只返回服务端地址，不在生成时下载', async () => {
    const calls = [];
    const fetchImpl = async (url, request) => { calls.push({ url: String(url), request }); return response(); };
    const result = await llmServerClient.generateVideo({ ...options, ...videoRequest(input), fetchImpl });
    assert.equal(result.taskId, 'remote-video');
    assert.equal(result.url, 'https://cdn.example/result.mp4?signature=temporary');
    assert.equal(calls.length, 1);
  });

  test('下载步骤按服务端地址取文件且不发送本地凭据', async () => {
    const calls = [], transfers = [];
    const fetchImpl = async (url, request) => { calls.push({ url: String(url), request }); return new Response('mp4'); };
    const bytes = await withGatewayTrace(transfer => { if (!transfers.includes(transfer)) transfers.push(transfer); }, () => llmServerClient.downloadVideo({ url: 'https://cdn.example/result.mp4?signature=temporary', fetchImpl }));
    assert.equal(bytes.toString(), 'mp4');
    assert.equal(calls[0].request.headers, undefined);
    assert.equal(transfers[0].fn, 'downloadVideo'); assert.equal(transfers[0].bytes, 3); assert.equal(transfers[0].ok, true);
    assert.doesNotMatch(transfers[0].path, /signature/);
  });

  test('非成功状态和服务端402/503拒绝，不下载也不重新提交', async () => {
    for (const variant of [{ status: 'running' }, { status: 'failed' }, { http: 402 }, { http: 503 }]) {
      let calls = 0;
      const fetchImpl = async () => { calls++; return variant.http ? new Response(JSON.stringify({ error: { message: '服务不可用' } }), { status: variant.http }) : response(variant); };
      await assert.rejects(llmServerClient.generateVideo({ ...options, ...videoRequest(input), fetchImpl }), error => variant.http ? error.status === variant.http : /成功状态/.test(error.message));
      assert.equal(calls, 1);
    }
  });

  test('下载失败和空文件记入HTTP详情并拒绝，不返回假视频', async () => {
    for (const file of [new Response('expired', { status: 403 }), new Response('')]) {
      let calls = 0; const transfers = [];
      await assert.rejects(withGatewayTrace(transfer => { if (!transfers.includes(transfer)) transfers.push(transfer); }, () => llmServerClient.downloadVideo({ url: 'https://cdn.example/result.mp4', fetchImpl: async () => { calls++; return file; } })), /下载失败|空的/);
      assert.equal(calls, 1); assert.equal(transfers.at(-1).ok, false); assert.match(transfers.at(-1).error, /下载失败|空的/);
    }
  });

  test('请求期间取消，终止连接且不下载、不重新生成', async () => {
    const controller = new AbortController(); let calls = 0;
    const request = llmServerClient.generateVideo({ ...options, ...videoRequest(input), signal: controller.signal, fetchImpl: async (_url, request) => { calls++; controller.abort(); request.signal.throwIfAborted(); } });
    await assert.rejects(request, /abort/i); assert.equal(calls, 1);
  });
});

describe("project-aspects", () => {
  for(const ratio of PROJECT_ASPECT_RATIOS) test(`项目${ratio}贯通图片、视频和输出尺寸`,()=>{
    const p=projectFixture();p.aspect_ratio=ratio;assert.doesNotThrow(()=>validateProject(p));
    const [w,h]=projectFrameSize(ratio),[a,b]=ratio.split(':').map(Number);
    assert.equal(w*b,h*a);assert.ok(w%2===0&&h%2===0&&Math.min(w,h)>=768);
    assert.equal(aspectRatioOfSize(videoSizeOf(ratio)),ratio);
    const local={baseUrl:'http://localhost/v1',prompt:'完整场景',aspectRatio:ratio};
    const image=imageParameters({...local,model:'gpt-image'});
    assert.ok(image.body.prompt.includes(ratio));
    assert.equal(imageParameters({...local,model:'krea2 turbo V2.5'}).body.aspect,ratio);
    const input={model:'MiniMax-H3',prompt:'画面动作',duration:4,aspectRatio:ratio};
    assert.equal(videoPayload({...input,mode:'text'}).ratio,ratio);
    const ref='data:image/png;base64,AAAA';
    assert.equal(videoPayload({...input,mode:'reference',referenceImages:[ref]}).ratio,ratio);
    assert.equal(videoPayload({...input,mode:'first_frame',inputReference:ref}).ratio,'adaptive');
  });

  test('创建和编辑项目均展示H3六比例，默认9:16',()=>{
    const dom=new JSDOM('<main></main>'),previous=globalThis.document;
    globalThis.document=dom.window.document;
    dom.window.HTMLDialogElement.prototype.show=function(){};
    try {
      const root=document.querySelector('main');
      const dialog=projectDialog(root,()=>{}),select=dialog.querySelector('select[name=aspect]');
      assert.deepEqual([...select.options].map(o=>o.value),PROJECT_ASPECT_RATIOS);
      assert.equal(select.value,'9:16');assert.equal(emptyProject().aspect_ratio,'9:16');
      const edit=detailsDialog(root,'编辑',{aspect_ratio:'21:9'},()=>{});
      assert.deepEqual([...edit.querySelector('select').options].map(o=>o.value),PROJECT_ASPECT_RATIOS);
      assert.equal(edit.querySelector('select').value,'21:9');
    } finally {globalThis.document=previous;dom.window.close();}
  });

  test('旧项目尺寸只在v25迁移为比例，保留媒体、历史和有效视频指纹',async()=>{
    const home=await mkdtemp(join(tmpdir(),'meiji-aspects-'));let repo;
    try {
      repo=new ModelRepository(home);const original=projectFixture();const model=await repo.create(original);
      await seedQueuedTasks(model,[['project-summary',original.id]]);await repo.close();repo=null;
      let db=new DatabaseSync(join(home,'meiji.sqlite'));
      const p=JSON.parse(db.prepare('SELECT data_json FROM projects WHERE id=?').get(original.id).data_json);
      p.aspect_ratio='768x1344';const snapshot={project:p,tasks:[],steps:[]};
      for(const e of p.episodes){for(const s of e.shot_list.shots){
        for(const [b,node]of [['first-last-frame',s.first_last_frame_prompt],['multimodal',s.multimodal_prompt],['video',s.video],['tail',s.last_frame]])
          if(node.node_state.status==='generated')node.node_state.dependency_hash=dependencyHash(snapshot,b,s.id);
      }e.assembly.node_state.dependency_hash=dependencyHash(snapshot,'assembly',e.id);}
      db.prepare('UPDATE projects SET data_json=? WHERE id=?').run(JSON.stringify(p),p.id);
      db.exec('PRAGMA user_version=24; DELETE FROM schema_migrations WHERE version=25;');
      const oldTasks=db.prepare('SELECT * FROM tasks').all(),oldSteps=db.prepare('SELECT * FROM task_steps').all();db.close();
      repo=new ModelRepository(home);const migrated=(await repo.open(p.id)).read().project;
      assert.equal(migrated.aspect_ratio,'9:16');
      for(let i=0;i<p.episodes[0].shot_list.shots.length;i++){
        const old=p.episodes[0].shot_list.shots[i],s=migrated.episodes[0].shot_list.shots[i];
        assert.equal(s.video.address,old.video.address);assert.equal(s.last_frame.address,old.last_frame.address);
        assert.equal(s.video.node_state.status,old.video.node_state.status);
        assert.equal(isNodeCurrent({project:migrated,tasks:[],steps:[]},'video',s.id),true);
      }
      await repo.close();repo=null;
      db=new DatabaseSync(join(home,'meiji.sqlite'));
      assert.equal(db.prepare('PRAGMA user_version').get().user_version,27);
      assert.deepEqual(db.prepare('SELECT * FROM tasks').all(),oldTasks);
      assert.deepEqual(db.prepare('SELECT * FROM task_steps').all(),oldSteps);db.close();
      assert.throws(()=>validateProject({...migrated,aspect_ratio:'768x1344'}),/aspect_ratio/);
    } finally {await repo?.close();await rm(home,{recursive:true,force:true});}
  });
});
