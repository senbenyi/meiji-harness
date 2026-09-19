// 职责：按外壳、列表、详情、素材、设置注入工作台样式，不包含业务逻辑。
window.__ModuleLoader__.load({ id: 'elysium/workbench-styles', factory: require => {
  const exports = {}
  exports.apply = () => {
    const style = document.createElement('style')
    style.textContent = [
      require('elysium/styles-shell').css,
      require('elysium/styles-projects').css,
      require('elysium/styles-detail').css,
      require('elysium/styles-materials').css,
      require('elysium/styles-settings').css,
    ].join('\n')
    document.head.appendChild(style)
    return () => style.remove()
  }
  return exports
} })
