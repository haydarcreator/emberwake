/**
 * Website behaviour: mobile menu, install tabs and button, copy buttons, toast.
 */
(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  $$('.year').forEach((n) => (n.textContent = new Date().getFullYear()));

  const toastEl = $('#toast');
  let toastT;
  window.SiteToast = function (msg) {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastT);
    toastT = setTimeout(() => toastEl.classList.remove('show'), 3200);
  };

  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('.copy');
    if (!btn) return;
    const text = btn.parentElement.querySelector('code').textContent;
    try { await navigator.clipboard.writeText(text); SiteToast('Copied to clipboard'); } catch { /* ignore */ }
  });

  const toggle = $('.nav-toggle'), mobile = $('#mobileNav');
  if (toggle && mobile) {
    toggle.addEventListener('click', () => {
      const open = mobile.hidden;
      mobile.hidden = !open;
      toggle.setAttribute('aria-expanded', String(open));
    });
    mobile.addEventListener('click', (e) => { if (e.target.closest('a')) { mobile.hidden = true; toggle.setAttribute('aria-expanded', 'false'); } });
  }

  // Install tabs: open the one for this device.
  const tabs = $$('.tab[data-os]');
  if (tabs.length) {
    const select = (os, focus) => tabs.forEach((t) => {
      const on = t.dataset.os === os;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      $('#panel-' + t.dataset.os).hidden = !on;
      if (on && focus) t.focus();
    });
    tabs.forEach((t, i) => {
      t.addEventListener('click', () => select(t.dataset.os));
      t.addEventListener('keydown', (e) => {
        const d = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
        if (d) select(tabs[(i + d + tabs.length) % tabs.length].dataset.os, true);
      });
    });
    const ua = navigator.userAgent;
    const os = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) ? 'ios'
      : /Android/.test(ua) ? 'android' : /Windows/.test(ua) ? 'windows' : /Mac/.test(ua) ? 'macos' : 'linux';
    select(os);
  }

  // Install button
  const installBtns = $$('[data-install]');
  if (installBtns.length && window.EmberInstall) {
    EmberInstall.onChange((st) => {
      installBtns.forEach((b) => {
        b.textContent = st.installed ? 'Installed ✓' : 'Install the game';
        b.disabled = st.installed;
      });
    });
    installBtns.forEach((b) => b.addEventListener('click', async () => {
      const r = await EmberInstall.prompt();
      if (r === 'unavailable') {
        document.getElementById('install').scrollIntoView({ behavior: 'smooth' });
        SiteToast('Follow the steps for your device below.');
      } else if (r === 'accepted') SiteToast('Emberwake is installed. Look for it with your other apps.');
    }));
  }
})();
