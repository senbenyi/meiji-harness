// 职责：注册媒体任务卡、会话产物和项目工作台。
window.__ModuleLoader__.load({
  id: '@dsh-external/dsh-elysium', factory: require => ({
    inject: ['slots', 'uiConversation'],
    apply(ctx) {
      require('elysium/media-task-card').apply(ctx)
      require('elysium/workbench').apply(ctx)
    },
  }),
})
