/**
 * Emberwake client: screens, game sessions (demo, solo, local, online) and
 * the main loop.
 */
(function () {
  const S = EmberSim;
  const Audio = EmberAudio;
  const Input = EmberInput;
  const Profile = EmberProfile;
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];

  // ---------------------------------------------------------------- settings
  const DEFAULTS = { master: 0.8, music: 0.5, sfx: 0.8, shake: true, autoFire: false, fps: false };
  let settings = DEFAULTS;
  try { settings = Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem('ew.settings')) || {}); } catch { /* defaults */ }
  const saveSettings = () => { try { localStorage.setItem('ew.settings', JSON.stringify(settings)); } catch { /* ignore */ } };
  Audio.setVolumes(settings);

  const canvas = $('#game');
  const renderer = new EmberRenderer(canvas);
  Input.attach(canvas, renderer);
  window.addEventListener('resize', () => renderer.resize());

  const net = new EmberNet();
  let session = null;
  let screen = 'menu';
  let screenBack = 'menu';

  // ------------------------------------------------------------------ toast
  const toastEl = $('#toast');
  let toastT;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastT);
    toastT = setTimeout(() => toastEl.classList.remove('show'), 3000);
  }

  // ---------------------------------------------------------------- screens
  function show(id) {
    if (id && id !== screen && ['settings', 'howto'].includes(id)) screenBack = screen || 'menu';
    $$('.screen').forEach((s) => (s.hidden = s.id !== 'scr-' + id));
    screen = id;
    if (!id && document.activeElement) document.activeElement.blur();
    const playing = !id && session && session.kind !== 'demo';
    document.body.classList.toggle('in-game', !!playing);
    $('#pauseBtn').hidden = !playing;
    renderer.hud = !!(session && session.kind !== 'demo');
    if (id === 'menu') refreshMenu();
    if (id === 'local') openLocal();
    if (id === 'online') openOnline();
    if (id === 'settings') syncSettingsUI();
    const first = id && $(`#scr-${id} .menu-btn.primary, #scr-${id} .menu-btn`);
    if (first && !matchMedia('(pointer: coarse)').matches) first.focus({ preventScroll: true });
  }

  document.addEventListener('click', (e) => {
    const b = e.target.closest('button, a.menu-btn');
    if (b) { Audio.unlock(); Audio.sfx('click'); }
    const go = e.target.closest('[data-go]');
    if (go) show(go.dataset.go);
    if (e.target.closest('[data-back]')) show(screenBack);
    if (e.target.closest('[data-action="solo"]')) startLocalGame('coop', [{ scheme: 'kbm' }]);
  });
  document.addEventListener('pointerdown', () => Audio.unlock(), { once: true });
  document.addEventListener('keydown', () => Audio.unlock(), { once: true });

  // Segmented controls
  function seg(el, value) {
    if (value != null) el.querySelectorAll('[data-mode]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.mode === value)));
    const on = el.querySelector('[aria-checked="true"]');
    return on ? on.dataset.mode : null;
  }
  $$('.seg').forEach((el) => el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-mode]');
    if (!b || el.classList.contains('locked')) return;
    seg(el, b.dataset.mode);
    el.dispatchEvent(new CustomEvent('change', { detail: b.dataset.mode }));
  }));

  // ------------------------------------------------------------------- menu
  function refreshMenu() {
    const s = Profile.stats();
    $('#menuStats').innerHTML = s.games
      ? `Best wave <b>${s.bestWave}</b> · Best score <b>${s.bestScore}</b> · ${s.kills} kills`
      : 'Your stats will show up here after your first game.';
    const user = window.SiteAuth && SiteAuth.user;
    $('#menuAccount').innerHTML = user
      ? `Playing as <b>${escapeHtml(Profile.name())}</b> · <a href="account.html">Account</a>`
      : `Playing as <b>${escapeHtml(Profile.name())}</b> · <button type="button" class="link-btn" data-auth="signin">Sign in</button> to keep your stats`;
  }
  const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  if (window.SiteAuth) SiteAuth.onChange(() => { if (screen === 'menu') refreshMenu(); });

  // --------------------------------------------------------------- settings
  function syncSettingsUI() {
    $$('[data-set]').forEach((el) => {
      if (el.type === 'checkbox') el.checked = !!settings[el.dataset.set];
      else el.value = settings[el.dataset.set];
    });
  }
  $$('[data-set]').forEach((el) => el.addEventListener('input', () => {
    settings[el.dataset.set] = el.type === 'checkbox' ? el.checked : Number(el.value);
    Audio.setVolumes(settings);
    $('#fps').hidden = !settings.fps;
    saveSettings();
  }));
  $('#fps').hidden = !settings.fps;

  // ------------------------------------------------------------------ demo
  function startDemo() {
    const game = S.create({ mode: 'coop', seed: (Math.random() * 1e9) | 0, players: [{ id: 'bot1', name: 'Ash' }, { id: 'bot2', name: 'Brin' }, { id: 'bot3', name: 'Cinder' }] });
    session = { kind: 'demo', game, locals: [], acc: 0 };
    renderer.particles = [];
    renderer.banners = [];
    Audio.startMusic(false);
  }

  // ------------------------------------------------------------ local games
  const SCHEME_LABEL = { kbm: 'Keyboard + mouse', kb1: 'Keyboard left (WASD)', kb2: 'Keyboard right (arrows)' };
  const schemeLabel = (s) => SCHEME_LABEL[s] || `Gamepad ${Number(s.slice(3)) + 1}`;

  function startLocalGame(mode, locals) {
    const players = locals.map((l, i) => ({ id: 'p' + (i + 1), name: l.name || (i === 0 ? Profile.name() : `Player ${i + 1}`) }));
    const game = S.create({ mode, seed: (Math.random() * 1e9) | 0, players });
    session = {
      kind: 'local', mode, game, acc: 0, paused: false, started: performance.now(),
      locals: locals.map((l, i) => ({ id: players[i].id, scheme: l.scheme, name: players[i].name })),
      picks: {}, setup: locals,
    };
    renderer.particles = [];
    renderer.banners = [];
    upgradeRows = {};
    Audio.startMusic(true);
    show(null);
  }

  // Join screen
  let joined = [];
  function openLocal() {
    joined = [];
    if (document.activeElement) document.activeElement.blur();
    $('#localError').hidden = true;
    renderJoin();
  }
  function renderJoin() {
    const grid = $('#joinGrid');
    grid.innerHTML = '';
    for (let i = 0; i < 4; i++) {
      const j = joined[i];
      const card = document.createElement('div');
      card.className = 'join-card' + (j ? ' joined' : '');
      card.style.setProperty('--pc', S.COLORS[i]);
      card.innerHTML = j
        ? `<strong>P${i + 1}</strong><span>${schemeLabel(j.scheme)}</span><button type="button" class="link-btn" data-unjoin="${i}">Remove</button>`
        : `<strong>P${i + 1}</strong><span class="muted">Press to join</span>`;
      grid.appendChild(card);
    }
  }
  $('#joinGrid').addEventListener('click', (e) => {
    const b = e.target.closest('[data-unjoin]');
    if (b) { joined.splice(Number(b.dataset.unjoin), 1); renderJoin(); }
  });
  function pollJoin() {
    const tryJoin = (scheme) => {
      if (joined.length >= 4 || joined.some((j) => j.scheme === scheme)) return;
      joined.push({ scheme });
      Audio.sfx('pickup');
      renderJoin();
    };
    if (Input.wasPressed('Space')) tryJoin('kb1');
    if (Input.wasPressed('Enter') || Input.wasPressed('NumpadEnter')) tryJoin('kb2');
    Input.pads().forEach((_, i) => { if (Input.padPressed(i, 0)) tryJoin('pad' + i); });
  }
  $('#localStart').addEventListener('click', () => {
    const mode = seg($('#localMode'));
    const need = mode === 'versus' ? 2 : 1;
    if (joined.length < need) {
      const err = $('#localError');
      err.textContent = mode === 'versus' ? 'Versus needs at least 2 players. Press Space, Enter or A to join.' : 'Press Space, Enter or a gamepad’s A button to join.';
      err.hidden = false;
      return;
    }
    startLocalGame(mode, joined.slice());
  });
  // Space/Enter join players on this screen instead of clicking buttons.
  document.addEventListener('keydown', (e) => {
    if (screen === 'local' && ['Space', 'Enter', 'NumpadEnter'].includes(e.code)) e.preventDefault();
  }, true);

  // ----------------------------------------------------------------- online
  function setNetStatus(txt, ok) {
    const el = $('#netStatus');
    el.textContent = txt;
    el.classList.toggle('ok', !!ok);
  }
  function showError(id, msg) {
    const el = $(id);
    el.textContent = msg || '';
    el.hidden = !msg;
  }

  // Which server to use: the one serving this page, unless the player typed
  // another address (needed in the Android app, or to join a friend's LAN game).
  const servedByServer = /^https?:$/.test(location.protocol) && !window.Capacitor;
  function serverAddress() {
    let v = '';
    try { v = localStorage.getItem('ew.server') || ''; } catch { /* ignore */ }
    return v || (servedByServer ? location.host : '');
  }
  function serverUrls(addr) {
    addr = addr.trim().replace(/\/+$/, '');
    if (!addr) return null;
    const secure = /^https:\/\//.test(addr) || (!/^http:\/\//.test(addr) && addr === location.host && location.protocol === 'https:');
    const host = addr.replace(/^(https?|wss?):\/\//, '');
    return { ws: `${secure ? 'wss' : 'ws'}://${host}/ws`, http: `${secure ? 'https' : 'http'}://${host}` };
  }
  function currentServer() {
    const v = $('#netServer').value.trim();
    try { localStorage.setItem('ew.server', v === location.host && servedByServer ? '' : v); } catch { /* ignore */ }
    return serverUrls(v);
  }

  async function openOnline() {
    $('#netName').value = Profile.name();
    $('#netServer').value = serverAddress();
    showError('#netError', '');
    if (net.connected) { setNetStatus('Connected to the game server.', true); return; }
    const urls = currentServer();
    if (!urls) { setNetStatus('Enter the address of an Emberwake server, for example the one your friend’s computer shows (192.168.1.20:8080).'); return; }
    setNetStatus('Connecting to the game server…');
    try {
      await net.connect(Profile.name(), urls.ws);
      net.httpBase = urls.http;
      setNetStatus('Connected to the game server.', true);
    } catch {
      setNetStatus('Can’t reach the game server at ' + $('#netServer').value + '. Start it with “node server.js” or the desktop app, and check the address.');
    }
  }
  $('#netServer').addEventListener('change', () => { net.disconnect(); openOnline(); });

  function netName() {
    const n = $('#netName').value.trim();
    if (!(window.SiteAuth && SiteAuth.user)) Profile.setName(n);
    return n || Profile.name();
  }

  async function ensureNet() {
    if (net.connected) { net.send({ t: 'hello', name: netName() }); return true; }
    const urls = currentServer();
    if (!urls) { showError('#netError', 'Enter a server address first.'); return false; }
    try { await net.connect(netName(), urls.ws); net.httpBase = urls.http; setNetStatus('Connected to the game server.', true); return true; }
    catch { showError('#netError', 'The game server isn’t reachable.'); return false; }
  }

  $('#createRoom').addEventListener('click', async () => {
    if (await ensureNet()) net.send({ t: 'create', mode: seg($('#createMode')) });
  });
  $('#joinRoom').addEventListener('click', async () => {
    const code = $('#joinCode').value.trim().toUpperCase();
    if (code.length !== 4) return showError('#netError', 'Room codes have 4 characters.');
    if (await ensureNet()) net.send({ t: 'join', code });
  });
  $('#joinCode').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#joinRoom').click(); });
  $('#joinCode').addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });

  net.on('error', (msg) => {
    if (screen === 'lobby') showError('#lobbyError', msg);
    else if (screen === 'online') showError('#netError', msg);
    else toast(msg);
  });

  net.on('room', (room) => {
    renderLobby(room);
    if (room.status === 'lobby' && (screen === 'online' || screen === 'lobby')) show('lobby');
  });

  net.on('start', (m) => {
    session = {
      kind: 'online', mode: m.mode, locals: [{ id: net.id, scheme: 'kbm' }], started: performance.now(),
      overShown: false,
    };
    renderer.particles = [];
    renderer.banners = [];
    upgradeRows = {};
    Audio.startMusic(true);
    show(null);
  });

  net.on('close', () => {
    if (session && session.kind === 'online') {
      toast('Disconnected from the game server.');
      startDemo();
      show('menu');
    } else if (screen === 'lobby') {
      show('online');
    }
    if (screen === 'online') setNetStatus('Disconnected from the game server.');
  });

  function renderLobby(room) {
    $('#roomCode').textContent = room.code;
    const isHost = room.host === net.id;
    const me = room.players.find((p) => p.id === net.id);
    seg($('#lobbyMode'), room.mode);
    $('#lobbyMode').classList.toggle('locked', !isHost);
    $('#lobbyList').innerHTML = room.players.map((p, i) => `
      <li style="--pc:${S.COLORS[i]}">
        <span class="dot"></span><span class="lname">${escapeHtml(p.name)}${p.id === net.id ? ' (you)' : ''}</span>
        <span class="lstate">${p.id === room.host ? 'Host' : p.ready ? 'Ready' : 'Not ready'}</span>
      </li>`).join('') + (room.players.length < 4 ? '<li class="empty">Waiting for players…</li>' : '');
    $('#readyBtn').hidden = isHost;
    $('#readyBtn').textContent = me && me.ready ? 'Not ready' : 'Ready';
    $('#startRoom').hidden = !isHost;
    const others = room.players.filter((p) => p.id !== room.host);
    $('#startRoom').disabled = others.some((p) => !p.ready) || (room.mode === 'versus' && room.players.length < 2);
    showLobbyHint();
    showError('#lobbyError', '');
  }
  let lobbyHintFor = null;
  async function showLobbyHint() {
    const base = net.httpBase || location.origin;
    if (lobbyHintFor === base) return;
    lobbyHintFor = base;
    const host = new URL(base).hostname;
    const local = host === 'localhost' || host === '127.0.0.1';
    $('#lobbyHint').textContent = local ? 'Share this code with your friends.' : `Friends open ${new URL(base).host} (or enter it as the server address in the app) and use this code.`;
    if (!local) return;
    try {
      const info = await (await fetch(base + '/api/info')).json();
      if (info.lan && info.lan.length) {
        const addr = `${info.lan.find((a) => a.startsWith('192.168.')) || info.lan[0]}:${info.port}`;
        $('#lobbyHint').textContent = `Friends on your Wi-Fi: open http://${addr} in a browser, or enter ${addr} as the server address in the app, then use this code.`;
      }
    } catch { /* hint stays generic */ }
  }
  $('#lobbyMode').addEventListener('change', (e) => net.send({ t: 'mode', mode: e.detail }));
  $('#readyBtn').addEventListener('click', () => {
    const me = net.room && net.room.players.find((p) => p.id === net.id);
    net.send({ t: 'ready', v: !(me && me.ready) });
  });
  $('#startRoom').addEventListener('click', () => net.send({ t: 'start' }));
  $('#leaveRoom').addEventListener('click', () => { net.send({ t: 'leave' }); net.room = null; show('online'); });
  $('#copyCode').addEventListener('click', () => {
    navigator.clipboard && navigator.clipboard.writeText($('#roomCode').textContent).then(() => toast('Room code copied'));
  });

  // ------------------------------------------------------------- upgrades
  let upgradeRows = {};
  function updateUpgrades(view) {
    const box = $('#upgrades');
    const mine = view.players.filter((p) => session.locals.some((l) => l.id === p.id) && p.offers);
    if (view.phase !== 'intermission' || !mine.length) {
      if (!box.hidden) { box.hidden = true; box.innerHTML = ''; upgradeRows = {}; }
      return;
    }
    box.hidden = false;
    for (const p of mine) {
      const key = p.id + ':' + p.offers.join(',');
      let row = upgradeRows[p.id];
      if (!row || row.key !== key) {
        const local = session.locals.find((l) => l.id === p.id);
        row = upgradeRows[p.id] = { key, sel: 0, chosen: false, scheme: local.scheme, el: document.createElement('div') };
        row.el.className = 'up-row';
        row.el.style.setProperty('--pc', S.COLORS[p.slot]);
        const hint = { kbm: '1 · 2 · 3 or click', kb1: 'A / D, then Space', kb2: '← / →, then Enter' }[local.scheme] || 'D-pad, then A';
        row.el.innerHTML = `<div class="up-who"><b>${escapeHtml(p.name)}</b><span>${hint}</span></div>` +
          p.offers.map((k, i) => `<button type="button" class="up-card" data-pick="${i}"><strong>${S.UPGRADES[k].name}</strong><span>${S.UPGRADES[k].desc}</span></button>`).join('');
        row.el.addEventListener('click', (e) => { const c = e.target.closest('[data-pick]'); if (c) choose(p.id, Number(c.dataset.pick)); });
        box.querySelectorAll('.up-row').forEach((r) => { if (!Object.values(upgradeRows).some((u) => u.el === r)) r.remove(); });
        box.appendChild(row.el);
      }
      row.el.querySelectorAll('.up-card').forEach((c, i) => c.classList.toggle('sel', i === row.sel));
      row.el.classList.toggle('done', row.chosen);
    }
    for (const id of Object.keys(upgradeRows)) {
      if (!mine.some((p) => p.id === id)) { upgradeRows[id].el.remove(); delete upgradeRows[id]; }
    }
  }
  function choose(id, idx) {
    const row = upgradeRows[id];
    if (!row || row.chosen) return;
    row.chosen = true;
    row.sel = idx;
    if (session.kind === 'online') net.sendInput({ mx: 0, my: 0, ax: 0, ay: 0, fire: false, dash: false, pick: idx }, 0);
    else session.picks[id] = idx;
  }
  function pollUpgradeKeys() {
    for (const [id, row] of Object.entries(upgradeRows)) {
      if (row.chosen) continue;
      const s = row.scheme;
      const move = (d) => { row.sel = (row.sel + d + 3) % 3; Audio.sfx('hover'); };
      if (s === 'kbm') {
        ['Digit1', 'Digit2', 'Digit3'].forEach((k, i) => { if (Input.wasPressed(k)) choose(id, i); });
        if (Input.wasPressed('KeyA') || Input.wasPressed('ArrowLeft')) move(-1);
        if (Input.wasPressed('KeyD') || Input.wasPressed('ArrowRight')) move(1);
        if (Input.wasPressed('Enter') || Input.wasPressed('Space')) choose(id, row.sel);
      } else if (s === 'kb1') {
        if (Input.wasPressed('KeyA')) move(-1);
        if (Input.wasPressed('KeyD')) move(1);
        if (Input.wasPressed('Space')) choose(id, row.sel);
      } else if (s === 'kb2') {
        if (Input.wasPressed('ArrowLeft')) move(-1);
        if (Input.wasPressed('ArrowRight')) move(1);
        if (Input.wasPressed('Enter') || Input.wasPressed('NumpadEnter')) choose(id, row.sel);
      } else {
        const i = Number(s.slice(3));
        if (Input.padPressed(i, 14)) move(-1);
        if (Input.padPressed(i, 15)) move(1);
        if (Input.padPressed(i, 0)) choose(id, row.sel);
      }
    }
  }

  // ------------------------------------------------------------ pause/over
  function pause() {
    if (!session || session.kind === 'demo' || screen) return;
    if (session.kind === 'local') session.paused = true;
    $('#pauseNote').textContent = session.kind === 'online' ? 'Online games keep running while this menu is open.' : '';
    show('pause');
  }
  function resume() {
    if (session && session.kind === 'local') session.paused = false;
    show(null);
  }
  $('#pauseBtn').addEventListener('click', pause);
  $('#resumeBtn').addEventListener('click', resume);
  $('#quitBtn').addEventListener('click', quitToMenu);
  $('#overMenu').addEventListener('click', quitToMenu);
  $('#overAgain').addEventListener('click', () => {
    if (session.kind === 'online') { show('lobby'); if (net.room) renderLobby(net.room); }
    else startLocalGame(session.mode, session.setup);
  });

  function quitToMenu() {
    if (session && session.kind === 'online') net.send({ t: 'leave' });
    $('#upgrades').hidden = true;
    $('#upgrades').innerHTML = '';
    upgradeRows = {};
    startDemo();
    show('menu');
  }

  function gameOver(view) {
    session.overShown = true;
    const localIds = session.locals.map((l) => l.id);
    const me = view.players.find((p) => p.id === localIds[0]);
    const seconds = (performance.now() - session.started) / 1000;
    if (view.mode === 'coop') {
      $('#overTitle').textContent = 'The arena falls';
      $('#overSub').textContent = `You reached wave ${view.wave} with ${view.score} points.`;
    } else {
      const w = view.players.find((p) => p.slot === view.winner);
      $('#overTitle').textContent = w ? `${w.name} wins!` : 'Draw';
      $('#overSub').textContent = w && localIds.includes(w.id) ? 'Victory.' : 'Better luck next round.';
    }
    const rows = view.players.slice().sort((a, b) => (view.mode === 'versus' ? b.kills - a.kills : b.score - a.score));
    $('#overTable').innerHTML = `<thead><tr><th>Player</th><th>Kills</th>${view.mode === 'versus' ? '<th>Deaths</th>' : '<th>Score</th>'}</tr></thead><tbody>` +
      rows.map((p) => `<tr style="--pc:${S.COLORS[p.slot]}"><td><span class="dot"></span>${escapeHtml(p.name)}</td><td>${p.kills}</td><td>${view.mode === 'versus' ? p.deaths : p.score}</td></tr>`).join('') + '</tbody>';
    $('#overAgain').textContent = session.kind === 'online' ? 'Back to lobby' : 'Play again';
    if (me) {
      Profile.record({ mode: view.mode, wave: view.wave, score: view.score, kills: me.kills, won: view.winner === me.slot, seconds });
    }
    $('#upgrades').hidden = true;
    Audio.startMusic(false);
    show('over');
  }

  // ----------------------------------------------------------------- loop
  let last = performance.now();
  let fpsT = 0, fpsN = 0;
  const STEP = 1 / 60;

  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    let view = null;
    let events = [];

    if (screen === 'local') pollJoin();
    if ((Input.wasPressed('Escape') || Input.wasPressed('KeyP') || Input.pads().some((_, i) => Input.padPressed(i, 9))) && session && session.kind !== 'demo') {
      if (!screen) pause();
      else if (screen === 'pause') resume();
    }

    if (session && (session.kind === 'demo' || session.kind === 'local')) {
      const g = session.game;
      if (!session.paused) {
        session.acc += dt;
        while (session.acc >= STEP) {
          session.acc -= STEP;
          const inputs = {};
          for (const p of g.players) {
            if (session.kind === 'demo') inputs[p.id] = S.botInput(g, p);
            else {
              const l = session.locals.find((x) => x.id === p.id);
              const inp = Input.read(l.scheme, p, settings);
              if (session.picks[p.id] != null) { inp.pick = session.picks[p.id]; delete session.picks[p.id]; }
              inputs[p.id] = inp;
            }
          }
          S.step(g, inputs, STEP);
          events.push(...S.drainEvents(g));
        }
      }
      view = S.snapshot(g);
      if (session.kind === 'demo' && g.phase === 'over' && g.t > 4) startDemo();
    } else if (session && session.kind === 'online') {
      view = net.view();
      events = net.takeEvents();
      const latest = net.latest();
      const self = latest && latest.players.find((p) => p.id === net.id);
      if (!screen || screen === 'pause') net.sendInput(screen ? { mx: 0, my: 0, ax: 0, ay: 0, fire: false, dash: false, pick: -1 } : Input.read('kbm', self, settings), now);
    }

    if (view && session.kind !== 'demo') {
      updateUpgrades(view);
      if (!screen || screen === 'pause') pollUpgradeKeys();
      if (view.phase === 'over' && !session.overShown) {
        session.overAt = session.overAt || now;
        if (now - session.overAt > 1500) gameOver(view);
      }
    }

    const localIds = session ? session.locals.map((l) => l.id) : [];
    const localSlots = view ? view.players.filter((p) => localIds.includes(p.id)).map((p) => p.slot) : [];
    renderer.draw(view, dt, { localIds });
    const shakeBefore = renderer.shake;
    renderer.applyEvents(events, session && session.kind !== 'demo' ? Audio : null, localSlots);
    if (!settings.shake) renderer.shake = Math.min(renderer.shake, shakeBefore);
    if (!settings.shake) renderer.shake = 0;

    if (settings.fps) {
      fpsT += dt; fpsN++;
      if (fpsT > 0.5) { $('#fps').textContent = Math.round(fpsN / fpsT) + ' FPS'; fpsT = 0; fpsN = 0; }
    }
    Input.endFrame();
    requestAnimationFrame(frame);
  }

  // Auto-pause when the tab is hidden during a local game.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && session && session.kind === 'local' && !screen) pause();
  });

  // Inside the desktop or Android app there is no website to go back to.
  if (/Electron/.test(navigator.userAgent) || window.Capacitor) {
    const back = document.querySelector('.menu-list a[href="index.html"]');
    if (back) back.remove();
  }

  startDemo();
  show('menu');
  requestAnimationFrame(frame);

  // Deep links from the website: play.html#solo, #local, #online
  const hash = location.hash.slice(1);
  if (hash === 'solo') startLocalGame('coop', [{ scheme: 'kbm' }]);
  else if (['local', 'online', 'howto'].includes(hash)) show(hash);
})();
