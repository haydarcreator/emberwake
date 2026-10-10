/**
 * Keyboard, mouse and gamepad input.
 *
 * Control schemes:
 *   kbm   WASD/arrows move, mouse aims + left click fires, Space fires with
 *         auto-aim, Shift or right click dashes. (Solo and online.)
 *   kb1   Local player on the left of the keyboard: WASD, Space, Left Shift.
 *   kb2   Local player on the right: arrows, Enter, Right Shift.
 *   pad0…pad3  Gamepads: left stick moves, right stick aims and fires,
 *         RT/A fire, B/LB dash.
 *   Touch screens add twin virtual sticks to kbm: left half of the screen
 *   moves, right half aims and fires (a tap fires with auto-aim), plus a
 *   dash button.
 */
(function () {
  const keys = new Set();
  const pressed = new Set();
  const mouse = { x: 0, y: 0, down: false, right: false, rightPressed: false, used: false };

  const touch = { active: false, move: { id: null }, aim: { id: null }, dash: false };
  const STICK = 60;

  function stickVec(st) {
    if (st.id == null) return [0, 0, 0];
    let dx = (st.x - st.ox) / STICK, dy = (st.y - st.oy) / STICK;
    const l = Math.hypot(dx, dy);
    if (l > 1) { dx /= l; dy /= l; }
    return [dx, dy, Math.min(1, l)];
  }

  function buildTouchUI() {
    const ui = document.createElement('div');
    ui.id = 'touchUI';
    ui.innerHTML = '<div class="stick" id="stickL"><i></i></div><div class="stick" id="stickR"><i></i></div><button type="button" id="touchDash" aria-label="Dash">DASH</button>';
    document.getElementById('ui').appendChild(ui);
    const dash = ui.querySelector('#touchDash');
    dash.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); touch.dash = true; dash.classList.add('on'); });
    dash.addEventListener('pointerup', () => dash.classList.remove('on'));
    dash.addEventListener('pointercancel', () => dash.classList.remove('on'));
    return ui;
  }

  function drawSticks() {
    for (const [st, id] of [[touch.move, 'stickL'], [touch.aim, 'stickR']]) {
      const el = document.getElementById(id);
      if (!el) continue;
      el.classList.toggle('on', st.id != null);
      if (st.id == null) continue;
      const [dx, dy] = stickVec(st);
      el.style.transform = `translate(${st.ox - 60}px, ${st.oy - 60}px)`;
      el.firstChild.style.transform = `translate(${dx * STICK}px, ${dy * STICK}px)`;
    }
  }

  const PREVENT = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab']);

  window.addEventListener('keydown', (e) => {
    if (e.target.closest && e.target.closest('input, textarea, select')) return;
    if (!keys.has(e.code)) pressed.add(e.code);
    keys.add(e.code);
    if (PREVENT.has(e.code) && document.body.classList.contains('in-game')) e.preventDefault();
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));
  window.addEventListener('blur', () => { keys.clear(); mouse.down = mouse.right = false; });

  const Input = {
    renderer: null,
    attach(canvas, renderer) {
      this.renderer = renderer;
      canvas.addEventListener('mousemove', (e) => { const w = renderer.toWorld(e.clientX, e.clientY); mouse.x = w.x; mouse.y = w.y; mouse.used = true; });
      canvas.addEventListener('mousedown', (e) => {
        if (e.button === 0) mouse.down = true;
        if (e.button === 2) { mouse.right = true; mouse.rightPressed = true; }
        const w = renderer.toWorld(e.clientX, e.clientY); mouse.x = w.x; mouse.y = w.y; mouse.used = true;
      });
      window.addEventListener('mouseup', (e) => { if (e.button === 0) mouse.down = false; if (e.button === 2) mouse.right = false; });
      canvas.addEventListener('contextmenu', (e) => e.preventDefault());

      // Touch: stop the browser from turning touches into mouse clicks or scrolling.
      canvas.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
      canvas.addEventListener('pointerdown', (e) => {
        if (e.pointerType !== 'touch') return;
        if (!touch.active) { touch.active = true; document.body.classList.add('touch'); buildTouchUI(); }
        const st = e.clientX < window.innerWidth / 2 ? touch.move : touch.aim;
        if (st.id != null) return;
        Object.assign(st, { id: e.pointerId, ox: e.clientX, oy: e.clientY, x: e.clientX, y: e.clientY });
        drawSticks();
      });
      window.addEventListener('pointermove', (e) => {
        for (const st of [touch.move, touch.aim]) if (st.id === e.pointerId) { st.x = e.clientX; st.y = e.clientY; }
        drawSticks();
      });
      const release = (e) => {
        for (const st of [touch.move, touch.aim]) if (st.id === e.pointerId) st.id = null;
        drawSticks();
      };
      window.addEventListener('pointerup', release);
      window.addEventListener('pointercancel', release);
    },

    get touchActive() { return touch.active; },

    down: (code) => keys.has(code),
    wasPressed: (code) => pressed.has(code),
    endFrame() { pressed.clear(); mouse.rightPressed = false; touch.dash = false; padPrev = padNow; padNow = {}; },

    pads() {
      const out = [];
      const list = navigator.getGamepads ? navigator.getGamepads() : [];
      for (const gp of list) if (gp && gp.connected) out.push(gp);
      return out;
    },

    padButton(index, button) {
      const gp = this.pads()[index];
      return !!(gp && gp.buttons[button] && gp.buttons[button].pressed);
    },
    padPressed(index, button) {
      const now = this.padButton(index, button);
      const key = index + ':' + button;
      padNow[key] = now;
      return now && !padPrev[key];
    },

    // Read one player's input for the given scheme. `self` is the player's
    // position in the world, needed to turn the mouse into an aim direction.
    read(scheme, self, settings) {
      const inp = { mx: 0, my: 0, ax: 0, ay: 0, fire: false, dash: false, pick: -1 };
      const k = (c) => keys.has(c);
      if (scheme === 'kbm' || scheme === 'kb1') {
        inp.mx = (k('KeyD') ? 1 : 0) - (k('KeyA') ? 1 : 0);
        inp.my = (k('KeyS') ? 1 : 0) - (k('KeyW') ? 1 : 0);
        inp.fire = k('Space');
        inp.dash = pressed.has('ShiftLeft');
      }
      if (scheme === 'kbm') {
        inp.mx += (k('ArrowRight') ? 1 : 0) - (k('ArrowLeft') ? 1 : 0);
        inp.my += (k('ArrowDown') ? 1 : 0) - (k('ArrowUp') ? 1 : 0);
        inp.dash = inp.dash || pressed.has('ShiftRight') || mouse.rightPressed;
        if (mouse.down && self) {
          inp.fire = true;
          const dx = mouse.x - self.x, dy = mouse.y - self.y, l = Math.hypot(dx, dy) || 1;
          inp.ax = dx / l; inp.ay = dy / l;
        }
      }
      if (scheme === 'kbm' && touch.active) {
        const [mx, my, ml] = stickVec(touch.move);
        if (ml > 0.15) { inp.mx = mx; inp.my = my; }
        if (touch.aim.id != null) {
          const [ax, ay, al] = stickVec(touch.aim);
          inp.fire = true;
          if (al > 0.3) { inp.ax = ax; inp.ay = ay; }
        }
        if (touch.dash) inp.dash = true;
      }
      if (scheme === 'kb2') {
        inp.mx = (k('ArrowRight') ? 1 : 0) - (k('ArrowLeft') ? 1 : 0);
        inp.my = (k('ArrowDown') ? 1 : 0) - (k('ArrowUp') ? 1 : 0);
        inp.fire = k('Enter') || k('NumpadEnter') || k('ControlRight');
        inp.dash = pressed.has('ShiftRight') || pressed.has('Numpad0');
      }
      if (scheme.startsWith('pad')) {
        const gp = this.pads()[Number(scheme.slice(3))];
        if (gp) {
          const dz = (v) => (Math.abs(v) < 0.2 ? 0 : v);
          inp.mx = dz(gp.axes[0] || 0);
          inp.my = dz(gp.axes[1] || 0);
          if (gp.buttons[14] && gp.buttons[14].pressed) inp.mx = -1;
          if (gp.buttons[15] && gp.buttons[15].pressed) inp.mx = 1;
          if (gp.buttons[12] && gp.buttons[12].pressed) inp.my = -1;
          if (gp.buttons[13] && gp.buttons[13].pressed) inp.my = 1;
          const rx = gp.axes[2] || 0, ry = gp.axes[3] || 0;
          if (Math.hypot(rx, ry) > 0.45) { inp.ax = rx; inp.ay = ry; inp.fire = true; }
          const b = (i) => gp.buttons[i] && gp.buttons[i].pressed;
          if (b(7) || b(0) || b(5)) inp.fire = true;
          inp.dash = this.padPressed(Number(scheme.slice(3)), 1) || this.padPressed(Number(scheme.slice(3)), 4);
        }
      }
      if (settings && settings.autoFire) inp.fire = true;
      return inp;
    },

    mouse,
  };

  let padPrev = {}, padNow = {};
  window.EmberInput = Input;
})();
