window.__ModuleLoader__.load({
  id: 'elysium-tools/media-styles', factory: () => ({
    apply() {
      if (typeof document === 'undefined') return
      const id = 'elysium-media-styles'
      if (document.getElementById(id)) return
      const style = document.createElement('style')
      style.id = id
      style.textContent = `
.elysium-download { display: inline-grid; place-items: center; width: 28px; height: 28px; padding: 0; border: 0; border-radius: 6px; background: none; color: var(--media-muted); cursor: pointer; text-decoration: none; }
.elysium-download:hover { color: var(--dsw-alias-label-primary, #fff); }
.elysium-card { --media-muted: var(--dsw-alias-label-secondary, #a3a3a3); box-sizing: border-box; width: 100%; margin: 8px 0; padding: 8px; border: 1px solid var(--dsw-alias-border-l2, #ffffff1a); border-radius: 16px; color: var(--dsw-alias-label-primary, inherit); font: inherit; font-size: 13px; line-height: 1.5; }
.elysium-preview { position: relative; overflow: hidden; border-radius: 10px; background: var(--dsw-alias-interactive-bg-hover, #8881); }
.elysium-preview > video, .elysium-preview > img { display: block; width: 100%; height: 100%; object-fit: contain; }
.elysium-placeholder { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; color: var(--media-muted); font-size: 12px; background: var(--dsw-alias-bg-base, #171717); }
.elysium-spinner { width: 22px; height: 22px; border: 1.5px solid currentColor; border-right-color: transparent; border-radius: 50%; animation: elysium-spin 1s linear infinite; }
@keyframes elysium-spin { to { transform: rotate(360deg); } }
.elysium-card button, .elysium-card a { font: inherit; }
.elysium-control { position: absolute; display: grid; place-items: center; width: 30px; height: 30px; padding: 0; border: 1px solid #ffffff20; border-radius: 8px; background: #0007; color: #fff; cursor: pointer; backdrop-filter: blur(8px); transition: background .15s; }
.elysium-control:hover { background: #000b; }
.elysium-control:focus-visible, .elysium-details > summary:focus-visible, .elysium-text-button:focus-visible { outline: 2px solid currentColor; outline-offset: 3px; }
.elysium-play { top: 50%; left: 50%; transform: translate(-50%, -50%); width: 44px; height: 44px; border-radius: 50%; }
.elysium-expand { bottom: 10px; right: 10px; }
.elysium-info { padding: 10px 4px 4px; }
.elysium-heading { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.elysium-heading strong { font-size: 14px; font-weight: 500; }
.elysium-meta { display: flex; align-items: baseline; flex-wrap: wrap; gap: 4px 10px; margin-top: 3px; color: var(--media-muted); font-size: 12px; line-height: 1.5; font-variant-numeric: tabular-nums; }
.elysium-details { flex-basis: 100%; font-size: 12px; overflow-wrap: anywhere; }
.elysium-details > summary { cursor: pointer; list-style: none; color: var(--media-muted); }
.elysium-details > summary::-webkit-details-marker { display: none; }
.elysium-details > summary::after { content: '⌄'; display: inline-block; margin-left: 4px; }
.elysium-details[open] > summary::after { transform: rotate(180deg); }
.elysium-details p { margin: 8px 0 0; font-size: 12px; }
.elysium-text-button { padding: 0; border: 0; background: none; color: inherit; text-decoration: underline; text-underline-offset: 3px; cursor: pointer; }
.elysium-error { margin: 8px 0 0; font-size: 12px; color: var(--media-muted); overflow-wrap: anywhere; }
.elysium-dialog { max-width: 92vw; max-height: 92vh; margin: auto; padding: 6px; border: 1px solid #ffffff20; border-radius: 14px; background: #111; color: #fff; }
.elysium-dialog::backdrop { background: #000b; backdrop-filter: blur(4px); }
.elysium-dialog video { display: block; max-width: 88vw; max-height: 88vh; border-radius: 8px; }
.elysium-close { top: 12px; right: 12px; z-index: 1; border-radius: 50%; }
@media (hover: hover) { .elysium-expand { opacity: 0; transition: opacity .15s; } .elysium-preview:hover .elysium-control, .elysium-preview:focus-within .elysium-control { opacity: 1; } }
@media (prefers-reduced-motion: reduce) { .elysium-spinner { animation: none; } .elysium-control { transition: none; } }
`
      document.head.appendChild(style)
    },
  }),
})
