window.__ModuleLoader__.load({
  id: '@dsh-external/dsh-elysium-tools', factory: require => ({
    inject: ['slots', 'uiConversation'],
    apply(ctx) {
      require('elysium-tools/media-card').apply(ctx)
      require('elysium-tools/media-results').apply(ctx)
    },
  }),
})
