window.__ModuleLoader__.load({
  id: '@dsh-external/dsh-elysium-ui', factory: require => ({
    inject: ['slots', 'settingsScope'],
    apply(ctx) {
      require('elysium-ui/settings').apply(ctx)
    },
  }),
})
