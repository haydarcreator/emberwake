/**
 * Installable app support: registers the service worker (offline play) and
 * exposes window.EmberInstall for "Install" buttons.
 */
(function () {
  const embedded = /Electron/.test(navigator.userAgent) || !!window.Capacitor;
  if (!embedded && 'serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }

  let deferred = null;
  const listeners = new Set();
  const notify = () => listeners.forEach((fn) => fn(state()));

  function state() {
    const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
    return { installed: standalone, canPrompt: !!deferred };
  }

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e;
    notify();
  });
  window.addEventListener('appinstalled', () => { deferred = null; notify(); });

  window.EmberInstall = {
    state,
    onChange(fn) { listeners.add(fn); fn(state()); },
    async prompt() {
      if (!deferred) return 'unavailable';
      deferred.prompt();
      const { outcome } = await deferred.userChoice;
      deferred = null;
      notify();
      return outcome;
    },
  };
})();
