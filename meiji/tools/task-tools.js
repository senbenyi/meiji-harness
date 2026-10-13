const jsonOutput = {
  schema: { type: "string" },
  render: (_args, value) => [{ type: "text", text: value }],
};
const sessionId = (exec) => {
  const id = exec?.agent?.session?.id;
  if (!id) throw new Error("必须从 Harness 会话调用");
  return id;
};
export function taskTools(runtime) {
  return [
    {
      name: "meiji-context-query",
      description:
        "查询当前会话绑定与项目资料、节点状态和任务。普通聊天无需绑定；不推测工作区归属。",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {},
      },
      output: jsonOutput,
      async execute(_args, exec) {
        const id = await runtime.bindings.projectForSession(sessionId(exec));
        return JSON.stringify({
          projects: await runtime.repository.list(),
          current: id ? (await runtime.repository.open(id)).read() : null,
        });
      },
    },
    {
      name: "meiji-project-command",
      description:
        "按用户明确请求创建或打开项目。自由创作方向由用户提供，剧本模式需完整剧本；已绑定会话不切换其他项目。",
      parameters: {
        type: "object",
        properties: {
          type: { type: "string", enum: ["create", "open", "add-episode"] },
          project_id: { type: "string" },
          request_id: { type: "string" },
          fields: { type: "object" },
        },
      },
      output: jsonOutput,
      async execute(args, exec) {
        return JSON.stringify(
          await runtime.projectCommand(args, sessionId(exec), "session"),
        );
      },
    },
    {
      name: "meiji-task-command",
      description:
        "对一个明确节点提交任务或组合任务，查询或取消。前置不足只报告失败，不自行补前置或修复；继续创建新组。人工编辑、放行、删除与队列控制由面板执行。",
      parameters: {
        type: "object",
        properties: {
          type: {
            type: "string",
            enum: [
              "submit",
              "submit-group",
              "query",
              "cancel",
              "continue-group",
            ],
          },
          project_id: { type: "string" },
          request_id: { type: "string" },
          business_type: { type: "string" },
          target_id: { type: "string", description: "项目/角色/服装等对象 ID。costume-image 有明确服装使用 co_，服装数组为空使用角色 c_；角色图 character-image 始终使用 c_。" },
          action: { type: "string", enum: ["generate", "regenerate"], description: "节点或成片组的执行方式：generate 补齐未有效生成的内容，regenerate 重跑所选范围；成片组缺省为 generate。" },
          opinion: { type: "string" },
          group_type: {
            type: "string",
            enum: ["episode-seconds", "episode-film"],
          },
          episode_id: { type: "string" },
          shot_id: { type: "string", description: "成片组可限定当前剧集内的一个镜头；不填则逐镜生成整集" },
          task_id: { type: "string" },
          group_id: { type: "string" },
        },
        required: ["type", "project_id"],
        additionalProperties: false,
      },
      output: jsonOutput,
      async execute(args, exec) {
        if (
          ![
            "submit",
            "submit-group",
            "query",
            "cancel",
            "continue-group",
          ].includes(args.type)
        )
          throw new Error("此操作只支持面板");
        return JSON.stringify(
          await runtime.command(args, sessionId(exec), "session"),
        );
      },
    },
  ];
}
