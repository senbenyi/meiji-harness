void import("/plugins/meiji/client/workbench.js")
  .then((module) => module.mount())
  .catch((error) => console.error("Meiji panel failed to load", error));
