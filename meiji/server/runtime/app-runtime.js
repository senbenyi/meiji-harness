import { LibraryStore } from "../data/library-store.js";
import { locateTarget } from "../../shared/task_contract.js";
import { expireDownstream } from "../../shared/node-dependencies.js";
import { decodeImageData } from "../media/decode-image-data.js";
import { join } from "node:path";
import { ModelRepository } from "../data/model-repository.js";
import { SessionBindings } from "../data/session-bindings.js";
import { TaskService } from "../flow/tasks/task-service.js";
import { createTextHandler } from "../handlers/text-handler.js";
import { createMediaHandler } from "../handlers/media-handler.js";
import { createHandlerRegistry } from "../handlers/handler-registry.js";
import { commitContent } from "../handlers/content.js";
import { MediaStore } from "../media/media-store.js";
import {
  completeChat,
  generateGatewayImage,
  submitGatewayVideo,
  retrieveGatewayVideo,
} from "../gateway/model-gateway.js";
import { withGatewayTrace } from "../gateway/gateway-trace.js";
import { modelStore } from "../data/model-settings.js";
import { NotificationOutbox } from "../host/notification-outbox.js";
import { emptyProject, emptyEpisode } from "../../shared/project_contract.js";
import { invalid, createId } from "../../shared/task_contract.js";

export async function createAppRuntime({
  home,
  sessionController,
  workspaceController,
  gateway: injected,
  libraryReferences = async () => [],
}) {
  const root = join(home, "storages", "meiji"),
    repository = new ModelRepository(join(root, "projects"), { databasePath: join(root, "meiji.sqlite") }),
    bindings = new SessionBindings(root),
    media = new MediaStore(join(root, "media")),
    models = modelStore(home),
    library = new LibraryStore(join(root, "assets"));
  const route = async (purpose) => {
    const config = await models.read();
    return { ...config, ...config[purpose] };
  };
  const trace = async (options, work) => {
    const transfers = [];
    return withGatewayTrace(async (data) => {
      transfers.push(data);
      if (options.trace && options.record) {
        options.trace.transfers = transfers;
        await options.record({ prompt: options.trace });
      }
    }, work);
  };
  const gateway = injected || {
    chat: async (options) =>
      trace(options, async () =>
        completeChat({ ...(await route("story")), ...options }),
      ),
    image: async (options) =>
      trace(options, async () =>
        generateGatewayImage({ ...(await route("image")), ...options }),
      ),
    submitVideo: async (options) =>
      trace(options, async () =>
        submitGatewayVideo({ ...(await route("video")), ...options }),
      ),
    retrieveVideo: async (options) =>
      trace(options, async () =>
        retrieveGatewayVideo({ ...(await route("video")), ...options }),
      ),
  };
  const text = createTextHandler({ chat: gateway.chat }),
    mediaHandler = createMediaHandler({ media, gateway }),
    execute = createHandlerRegistry({ text, media: mediaHandler }),
    tasks = new TaskService({
      repository,
      execute,
      commitOutput: commitContent,
      libraryReferences: async () => [
        ...(await library.references()),
        ...(await libraryReferences()),
      ],
    }),
    notices = new NotificationOutbox(repository, sessionController);
  let disposed = false;
  const changed = (event) => {
    if (!disposed) void notices.drain(event.project_id).catch(() => {});
  };
  repository.on("change", changed);
  for (const entry of await repository.list())
    if (!entry.unsupported) {
      const model = await repository.open(entry.id);
      await tasks.recover(model);
      // 通知需要宿主 Agent；不能在插件尚未公布服务时等待其启动。
      void notices.drain(entry.id).catch(() => {});
    }
  const runtime = {
    home,
    root,
    repository,
    bindings,
    media,
    models,
    library,
    tasks,
    notices,
    async command(command, sessionId, source = "panel") {
      await bindings.require(sessionId, command.project_id);
      const result = await tasks.command(command, {
        source,
        session_id: sessionId,
      });
      let notification;
      try {
        notification = await notices.drain(command.project_id);
      } catch (error) {
        notification = { notification_error: error.message };
      }
      return { ...result, ...notification };
    },
    async projectCommand(command, sessionId, source = "panel") {
      const current = await bindings.projectForSession(sessionId);
      if (
        source === "session" &&
        current &&
        ["create", "open"].includes(command.type) &&
        current !== command.project_id
      )
        invalid("project", "当前会话已关联项目，请使用新会话");
      if (command.type === "create") {
        const fields = command.fields || {};
        for (const key of Object.keys(fields))
          if (
            ![
              "名称",
              "创作方式",
              "画幅",
              "创作方向",
              "输出语言",
              "参考单集时长秒",
              "规则",
              "剧本",
            ].includes(key)
          )
            invalid(key, "创建项目不接受身份、节点或执行状态");
        if (fields.剧本)
          fields.剧本 = {
            ...emptyProject().剧本,
            正文: fields.剧本.正文 || "",
          };
        if (!fields.名称?.trim()) invalid("名称", "项目名称为空");
        if (fields.创作方式 === "剧本" && !fields.剧本?.正文?.trim())
          invalid("剧本", "剧本模式需完整剧本");
        if (fields.创作方式 !== "剧本" && !fields.创作方向?.trim())
          invalid("创作方向", "自由创作需用户提供方向");
        const p = emptyProject(fields);
        await repository.create(p);
        return runtime.projectCommand(
          { type: "open", project_id: p.id },
          sessionId,
          source,
        );
      }
      if (command.type === "open") {
        const model = await repository.open(command.project_id);
        let id = current === model.id ? sessionId :
          await bindings.sessionForProject(model.id);
        if (!id && source === "session" && !current) id = sessionId;
        const workspace = workspaceController
          ? await bindings.workspace(model.id, async () => {
              const { workspace } = await workspaceController.create({
                path: join(root, "projects", model.id),
              });
              await workspaceController.rename({
                workspaceId: workspace.workspaceId,
                title: `${model.read().project.名称} · ${model.id.slice(-8)}`,
              });
              return {
                id: workspace.workspaceId,
                title: model.read().project.名称,
              };
            })
          : null;
        if (!id) {
          if (!sessionController?.create) invalid("session_id", "需要会话");
          id = (await sessionController.create({ workspaceId: workspace?.id, agentPreset: "meiji" }))
            .sessionId;
        }
        await bindings.bind(id, model.id);
        return { project_id: model.id, session_id: id, workspace };
      }
      if (
        command.type === "delete" &&
        /^[a-f0-9-]{36}$/i.test(command.project_id || "")
      ) {
        if (source !== "panel") invalid("source", "旧项目只允许面板显式删除");
        return repository.removeUnsupported(command.project_id);
      }
      await bindings.require(sessionId, command.project_id);
      const model = await repository.open(command.project_id);
      if (command.type === "delete") {
        await repository.remove(model.id);
        await bindings.forget(model.id);
        return { deleted: true };
      }
      if (command.type === "add-episode")
        return model.update(command.request_id, command, (s) => {
          if (s.tasks.some((t) => t.task_status === "running"))
            invalid("状态", "运行中不能编辑");
          if (s.project.创作方式 === "剧本")
            invalid("剧集", "剧本创作方式请使用拆分剧集");
          for (const key of Object.keys(command.fields || {}))
            if (!["时长秒", "本集要求"].includes(key))
              invalid(key, "未定义剧集创建字段");
          const e = emptyEpisode({
            ...command.fields,
            序号: Math.max(0, ...s.project.剧集.map((e) => e.序号)) + 1,
          });
          s.project.剧集.push(e);
          return { episode_id: e.id };
        });
      if (command.type === "reference-image") {
        if (source !== "panel") invalid("source", "参考图只允许面板维护");
        const image = decodeImageData(command.data, command.mime),
          asset = await media.put(
            model.id,
            image.bytes,
            image.mime === "image/jpeg"
              ? "jpg"
              : image.mime === "image/webp"
                ? "webp"
                : "png",
          );
        return model.update(
          command.request_id,
          {
            type: command.type,
            target_id: command.target_id,
            address: asset.address,
          },
          (s) => {
            if (s.tasks.some((t) => t.task_status === "running"))
              invalid("状态", "运行中不能编辑");
            const target = locateTarget(
              s.project,
              "character-image",
              command.target_id,
            );
            target.object.参考图.地址 = asset.address;
            return {};
          },
        );
      }
      if (command.type === "edit-character" || command.type === "edit-costume")
        return model.update(command.request_id, command, (s) => {
          if (source !== "panel") invalid("source", "角色设置只允许面板维护");
          if (s.tasks.some((t) => t.task_status === "running"))
            invalid("状态", "运行中不能编辑");
          const isCharacter = command.type === "edit-character",
            target = locateTarget(
              s.project,
              isCharacter ? "character-image" : "costume-image",
              command.target_id,
            ).object;
          const allowed = isCharacter
            ? [
                "名称",
                "国籍",
                "身份",
                "身份特征",
                "性别",
                "年代",
                "年龄",
                "身高",
                "体型",
                "面相",
                "声音",
                "必出",
                "默认服装id",
              ]
            : ["名称", "描述"];
          let visual = false;
          for (const [key, value] of Object.entries(command.fields || {})) {
            if (!allowed.includes(key)) invalid(key, "未定义资料字段");
            if (
              !["声音", "默认服装id"].includes(key) &&
              JSON.stringify(value) !== JSON.stringify(target[key])
            )
              visual = true;
            target[key] = value;
          }
          if (visual)
            expireDownstream(
              s,
              isCharacter ? "character-setting" : "costume-setting",
              target.id,
              "固定资料已修改",
            );
          return {};
        });
      if (command.type === "edit-episode")
        return model.update(command.request_id, command, (s) => {
          if (source !== "panel") invalid("source", "剧集资料只允许面板维护");
          if (s.tasks.some((t) => t.task_status === "running"))
            invalid("状态", "运行中不能编辑");
          const e = s.project.剧集.find((e) => e.id === command.episode_id);
          if (!e) invalid("剧集", "剧集不存在");
          for (const [key, value] of Object.entries(command.fields || {})) {
            if (!["本集要求", "时长秒", "剧情"].includes(key))
              invalid(key, "未定义剧集资料");
            if (key === "剧情") {
              if (typeof value !== "string") invalid("剧情", "需为文本");
              const changed = value !== e.剧情;
              e.剧情 = value;
              if (changed)
                expireDownstream(s, "episode-plot", e.id, "剧情已修改");
            } else e[key] = value;
          }
          return {};
        });
      if (command.type === "edit")
        return model.update(command.request_id, command, (s) => {
          if (s.tasks.some((t) => t.task_status === "running"))
            invalid("状态", "运行中不能编辑");
          const allowed = [
            "名称",
            "创作方向",
            "输出语言",
            "画幅",
            "参考单集时长秒",
            "规则",
          ];
          for (const [key, value] of Object.entries(command.fields || {})) {
            if (!allowed.includes(key)) invalid(key, "未定义项目配置");
            if (key === "规则") {
              if (!Array.isArray(value)) invalid("规则", "需为数组");
              const targets = new Map([["项目", s.project.id]]);
              for (const c of s.project.角色库.角色) {
                targets.set(c.编号, c.id);
                for (const co of c.服装) targets.set(co.编号, co.id);
              }
              for (const e of s.project.剧集) {
                targets.set(`第${e.序号}集`, e.id);
                for (const shot of e.镜头表.镜头)
                  targets.set(`第${e.序号}集/${shot.编号}`, shot.id);
              }
              s.project.规则 = value.map((row, index) => {
                const { 节点编号, ...fields } = row;
                if (
                  Object.keys(fields).some(
                    (k) =>
                      !["范围", "适用业务", "类别", "约束", "内容"].includes(k),
                  )
                )
                  invalid("规则", "未定义规则字段");
                const node =
                  fields.范围 === "project" ? "" : targets.get(节点编号);
                if (node === undefined)
                  invalid("节点编号", "规则目标编号不存在");
                return {
                  id: s.project.规则[index]?.id || createId("rule"),
                  ...fields,
                  节点id: node,
                };
              });
            } else s.project[key] = value;
          }
          return {};
        });
      invalid("project-command", "未知项目管理命令");
    },
    async dispose() {
      disposed = true;
      repository.off("change", changed);
      await tasks.dispose();
      await notices.dispose();
      await repository.close();
    },
  };
  return runtime;
}
