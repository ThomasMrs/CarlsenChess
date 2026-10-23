// Injected only after the user clicks the extension action.
(() => {
  if (document.getElementById('carlsenchess-root')) {
    window.dispatchEvent(new Event('carlsenchess:toggle'));
    return;
  }
  if (globalThis.__carlsenLoading) return;
  globalThis.__carlsenLoading = true;
  import(chrome.runtime.getURL('content/app.js'))
    .then((app) => app.mount())
    .catch((error) => console.error('CarlsenChess:', error))
    .finally(() => { globalThis.__carlsenLoading = false; });
})();
