if (!document.getElementById('drama-panel')) {
  void Promise.all([import('./panel-shell.js'), import('./workbench.js')])
    .then(([{ createShell }, { mount }]) => {
      const shell = createShell()
      const view = mount(shell.content)
      shell.content.querySelector('header nav').append(shell.toggle)
      window.addEventListener('pagehide', () => { view.dispose(); shell.dispose() }, { once: true })
    })
    .catch(error => console.error('Drama panel failed to load', error))
}
