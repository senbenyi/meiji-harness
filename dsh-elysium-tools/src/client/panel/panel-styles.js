window.__ModuleLoader__.load('elysium-tools/panel-styles', (require, exports) => {
  exports.apply = () => {
    const style = document.createElement('style')
    style.textContent = `
.elysium-panel { position: fixed; top: 52px; right: 0; bottom: 0; z-index: 100; display: flex; flex-direction: column; box-sizing: border-box; background: var(--dsw-alias-background-primary, #202020); color: var(--dsw-alias-label-primary, #eee); border-left: 1px solid #8885; font: 13px/1.5 system-ui; }
.elysium-panel-header { display: flex; padding: 10px; gap: 6px; border-bottom: 1px solid #8885; }
.elysium-panel-body { overflow: auto; flex: 1; padding: 12px; }
.elysium-panel-toggle { position: fixed; right: 16px; top: 12px; z-index: 101; }
.elysium-panel-resize { position: absolute; left: -4px; width: 8px; top: 0; bottom: 0; cursor: ew-resize; }
.elysium-panel button, .elysium-panel-toggle { border: 1px solid #8885; border-radius: 6px; padding: 5px 8px; background: var(--dsw-alias-background-primary, #303030); color: inherit; cursor: pointer; }
.elysium-panel button:disabled { opacity: .5; cursor: wait; }
.elysium-panel-tab-active { font-weight: bold; text-decoration: underline; }
.elysium-asset-item { padding: 10px 0; border-bottom: 1px solid #8884; overflow-wrap: anywhere; }
.elysium-asset-thumb { width: 100%; max-height: 160px; object-fit: contain; background: #0003; }
.elysium-panel a { color: #8bcaff; }
.elysium-panel input, .elysium-panel textarea { box-sizing: border-box; width: 100%; margin: 4px 0; background: transparent; color: inherit; border: 1px solid #8887; padding: 5px; }
.elysium-panel-actions { display: flex; gap: 4px; flex-wrap: wrap; }
`
    document.head.appendChild(style)
    return () => style.remove()
  }
})
