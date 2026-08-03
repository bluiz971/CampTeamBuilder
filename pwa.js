/** Camp Builder PWA helpers — install prompt + service worker */
(function (global) {
  let deferredPrompt = null;
  const listeners = [];

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    listeners.forEach((fn) => { try { fn(true); } catch (err) {} });
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    listeners.forEach((fn) => { try { fn(false); } catch (err) {} });
  });

  function isStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches
      || window.navigator.standalone === true;
  }

  function canInstall() {
    return !!deferredPrompt && !isStandalone();
  }

  function onInstallAvailability(fn) {
    listeners.push(fn);
    fn(canInstall());
  }

  async function promptInstall() {
    if (!deferredPrompt) return { ok: false, reason: 'unavailable' };
    deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;
    deferredPrompt = null;
    listeners.forEach((fn) => { try { fn(false); } catch (err) {} });
    return { ok: choice.outcome === 'accepted', reason: choice.outcome };
  }

  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    });
  }

  function readSession() {
    try {
      const raw = localStorage.getItem('campAuthSession')
        || localStorage.getItem('stationAuth')
        || sessionStorage.getItem('campAuthSession');
      if (!raw) return null;
      const s = JSON.parse(raw);
      if (!(s && s.access_token)) return null;
      // Keep both keys in sync so Account / Admin / Station all see the same login
      try {
        localStorage.setItem('campAuthSession', raw);
        localStorage.setItem('stationAuth', raw);
      } catch (e) {}
      return s;
    } catch (e) { return null; }
  }

  function writeSession(session) {
    if (!(session && session.access_token)) {
      clearSession();
      return;
    }
    try {
      const raw = JSON.stringify(session);
      localStorage.setItem('campAuthSession', raw);
      localStorage.setItem('stationAuth', raw);
    } catch (e) {}
  }

  function clearSession() {
    try {
      localStorage.removeItem('campAuthSession');
      localStorage.removeItem('stationAuth');
      sessionStorage.removeItem('campAuthSession');
    } catch (e) {}
  }

  global.CampBuilderPWA = {
    isStandalone,
    canInstall,
    onInstallAvailability,
    promptInstall,
    registerServiceWorker,
    readSession,
    writeSession,
    clearSession
  };

  registerServiceWorker();
})(window);
