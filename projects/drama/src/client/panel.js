if (!document.getElementById('drama-panel')) {
  void Promise.all([import('./ui/panel-shell.js'), import('./workbench.js'), import('./task-messages.js')])
    .then(([{ createShell }, { mount }, { mountTaskMessages }]) => {
      const shell = createShell()
      const view = mount(shell.content)
      const messages = mountTaskMessages()
      shell.content.querySelector('header nav').append(shell.toggle)
      window.addEventListener('pagehide', () => { messages.dispose(); view.dispose(); shell.dispose() }, { once: true })
    })
    .catch(error => console.error('Drama panel failed to load', error))
}
