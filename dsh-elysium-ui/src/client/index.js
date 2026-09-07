window.__ModuleLoader__.load({
  id: 'dsh-external/dsh-elysium-ui', factory: require => ({
    inject: ['slots', 'settingsScope'],
    apply(ctx) {
      require('elysium-ui/settings').apply(ctx)
      require('elysium-ui/media-card').apply(ctx)
    },
  }),
})
window.__ModuleLoader__.load({ id: 'dsh-elysium-ui', factory: require => require('dsh-external/dsh-elysium-ui') })
