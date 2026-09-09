window.__ModuleLoader__.load({
  id: '@dsh-external/dsh-elysium-tools', factory: require => ({
    inject: ['slots'],
    apply(ctx) {
      require('elysium-tools/media-card').apply(ctx)
    },
  }),
})
