window.__ModuleLoader__.load({
  id: 'elysium-tools/creation-commands', factory: () => {
    const commands = [
      { name: '预览创作', description: '快速看构图和动作，生成约 3 秒预览' },
      { name: '常规创作', description: '清晰度与速度兼顾，单次生成最长约 15 秒视频' },
      { name: '高清创作', description: '更高分辨率，适合正式制作，等待较长' },
    ]
    function claim(command) {
      return { claim: {
        token: `/${command.name} `,
        hint: '描述人物、场景和动作；有参考图时粘贴作品地址',
        images: false,
        async submit(args, actx, images = []) {
          if (!args.trim()) return { kind: 'error', text: '请先填写创作内容，再发送。' }
          if (images.length) return { kind: 'error', text: '请使用服务器上的作品地址作为参考图。' }
          await actx.get('conversation').send(`【${command.name}】\n${args.trim()}`)
          return { kind: 'success' }
        },
      } }
    }
    const source = {
      trigger: '/', name: '创作指令', order: -100,
      async candidates(_session, request) {
        if (request.position !== 'leading') return []
        return commands.filter(command => command.name.includes(request.query.trim()))
      },
      onPick(pick) {
        const command = commands.find(command => command.name === pick.candidate.name)
        if (pick.position === 'leading' && command) return claim(command)
      },
      matchSpace(_session, token) {
        const command = commands.find(command => token === `/${command.name}`)
        if (command) return claim(command)
      },
      async matchEnter(_session, line) {
        const command = commands.find(command => line === `/${command.name}` || line.startsWith(`/${command.name} `))
        if (command) return claim(command)
      },
    }
    return { source, apply(ctx) { ctx.effect(() => ctx.inputTriggers.registerSource(source), 'elysium: Chinese creation commands') } }
  },
})
