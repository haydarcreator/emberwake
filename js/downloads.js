/**
 * Download section: lists the installers, detects the visitor's system and
 * puts the right file first.
 *
 * `base` is where the installer files live:
 *   'downloads/'  → files served by this site (copy them into downloads/)
 *   'https://github.com/USER/REPO/releases/latest/download/' → GitHub Releases
 */
window.EMBER_DOWNLOADS = {
  version: '1.0.0',
  base: 'downloads/',
  platforms: {
    windows: { name: 'Windows', note: 'Windows 10 and 11, 64-bit', files: [
      { label: 'Installer (.msi)', file: 'Emberwake-{v}-x64.msi' },
      { label: 'Setup (.exe)', file: 'Emberwake-Setup-{v}-x64.exe' },
    ] },
    macos: { name: 'macOS', note: 'macOS 11 Big Sur or later', files: [
      { label: 'Apple silicon (.dmg)', file: 'Emberwake-{v}-arm64.dmg' },
      { label: 'Intel (.dmg)', file: 'Emberwake-{v}-x64.dmg' },
    ] },
    linux: { name: 'Linux', note: '64-bit, most distributions', files: [
      { label: 'AppImage (any distro)', file: 'Emberwake-{v}-x86_64.AppImage' },
      { label: 'Debian / Ubuntu (.deb)', file: 'emberwake_{v}_amd64.deb' },
    ] },
    android: { name: 'Android', note: 'Android 7.0 or later', files: [
      { label: 'App (.apk)', file: 'Emberwake-{v}.apk' },
    ] },
    ios: { name: 'iPhone & iPad', note: 'Add to Home Screen from Safari', files: [] },
  },
};

(function () {
  const D = window.EMBER_DOWNLOADS;
  const $ = (s) => document.querySelector(s);
  if (!$('#dlGrid')) return;

  const ua = navigator.userAgent;
  const os = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) ? 'ios'
    : /Android/.test(ua) ? 'android' : /Windows/.test(ua) ? 'windows' : /Mac/.test(ua) ? 'macos'
    : /Linux|X11|CrOS/.test(ua) ? 'linux' : 'windows';

  const url = (f) => D.base + f.file.replace('{v}', D.version);
  const sameOrigin = !/^https?:\/\//.test(D.base);
  const mb = (n) => (n / 1e6).toFixed(0) + ' MB';
  const DL = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 19h14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  // Files hosted on this site are listed in downloads/files.json
  // (written by tools/list-downloads.mjs) with their sizes.
  let listing = null;
  async function probe(f) {
    if (!sameOrigin) return { ok: true };
    if (!listing) listing = fetch(D.base + 'files.json', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
    const size = (await listing)[f.file.replace('{v}', D.version)];
    return { ok: size != null, size };
  }

  function button(f, info, primary) {
    const cls = primary ? 'btn btn-primary btn-lg' : 'btn btn-secondary btn-lg';
    if (!info.ok) return `<span class="${cls} is-off" aria-disabled="true">${f.label} · coming soon</span>`;
    return `<a class="${cls}" href="${url(f)}" download>${DL}<span>${f.label}${info.size ? ' · ' + mb(info.size) : ''}</span></a>`;
  }

  async function render() {
    const infos = {};
    await Promise.all(Object.values(D.platforms).flatMap((p) => p.files).map(async (f) => { infos[f.file] = await probe(f); }));

    const mine = D.platforms[os];
    $('#dlOsName').textContent = `Detected: ${mine.name}`;
    if (os === 'ios') {
      $('#dlTitle').textContent = 'Emberwake for iPhone & iPad';
      $('#dlMeta').textContent = 'Open in Safari → Share → Add to Home Screen';
      $('#dlPrimary').innerHTML = '<a class="btn btn-primary btn-lg" href="play.html">Play now</a>';
    } else {
      $('#dlTitle').textContent = `Download for ${mine.name}`;
      $('#dlMeta').textContent = `Version ${D.version} · ${mine.note}`;
      $('#dlPrimary').innerHTML = mine.files.map((f, i) => button(f, infos[f.file], i === 0)).join('');
    }
    const heroDl = $('#heroDownload');
    if (heroDl && os !== 'ios') heroDl.textContent = `Download for ${mine.name}`;

    $('#dlGrid').innerHTML = Object.entries(D.platforms).map(([key, p]) => `
      <article class="dl-card${key === os ? ' mine' : ''}">
        <h4>${p.name}</h4>
        <p>${p.note}</p>
        <div class="dl-card-links">
          ${p.files.length
            ? p.files.map((f) => (infos[f.file].ok ? `<a href="${url(f)}" download>${DL}${f.label}</a>` : `<span class="off">${f.label} · soon</span>`)).join('')
            : '<a href="#install" data-ios>How to install</a>'}
        </div>
      </article>`).join('');

    document.querySelectorAll('[data-ios]').forEach((a) => a.addEventListener('click', () => {
      const tab = document.getElementById('tab-ios');
      if (tab) tab.click();
    }));
  }

  render();
  if (window.EmberInstall) EmberInstall.onChange((st) => { const el = $('#pwaAlt'); if (el) el.hidden = !st.canPrompt; });
})();
