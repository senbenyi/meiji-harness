// 职责：注册媒体任务卡、会话产物、创作指令和项目工作台。
window.__ModuleLoader__.load({
  id: '@dsh-external/dsh-elysium', factory: require => ({
    inject: ['slots', 'uiConversation', 'inputTriggers', 'sessions', 'workspaces', 'uiWorkspace', 'modelDirectories'],
    apply(ctx) {
      require('elysium/media-task-card').apply(ctx)
      require('elysium/creation-commands').apply(ctx)
      require('elysium/workbench').apply(ctx)
      require('elysium/project-generation').apply(ctx)
    },
  }),
})
