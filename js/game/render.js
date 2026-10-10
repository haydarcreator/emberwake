/**
 * Canvas renderer. Draws a snapshot (EmberSim.snapshot) plus client-side
 * effects: particles, floating numbers, banners and screen shake.
 * All art is drawn with code, so there are no image files to load.
 */
(function () {
  const { W, H, WALL, COLORS, ENEMY_TYPES } = EmberSim;
  const TAU = Math.PI * 2;

  function shade(hex, f) {
    const n = parseInt(hex.slice(1), 16);
    let r = n >> 16, g = (n >> 8) & 255, b = n & 255;
    if (f < 0) { r *= 1 + f; g *= 1 + f; b *= 1 + f; }
    else { r += (255 - r) * f; g += (255 - g) * f; b += (255 - b) * f; }
    return `rgb(${r | 0},${g | 0},${b | 0})`;
  }

  class Renderer {
    constructor(canvas, opts = {}) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.hud = opts.hud !== false;
      this.cover = !!opts.cover;
      this.particles = [];
      this.texts = [];
      this.banners = [];
      this.shake = 0;
      this.bgKey = '';
      this.time = 0;
      this.scale = 1;
      this.ox = 0;
      this.oy = 0;
      this.resize();
      this._vignette = null;
      if (window.ResizeObserver) new ResizeObserver(() => this.resize()).observe(canvas);
    }

    resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = this.canvas.getBoundingClientRect();
      const cw = Math.max(1, rect.width), ch = Math.max(1, rect.height);
      this.canvas.width = Math.round(cw * dpr);
      this.canvas.height = Math.round(ch * dpr);
      this.dpr = dpr;
      this.cw = cw; this.ch = ch;
      this.scale = (this.cover ? Math.max : Math.min)(cw / W, ch / H);
      this.ox = (cw - W * this.scale) / 2;
      this.oy = (ch - H * this.scale) / 2;
    }

    toWorld(clientX, clientY) {
      const rect = this.canvas.getBoundingClientRect();
      return { x: (clientX - rect.left - this.ox) / this.scale, y: (clientY - rect.top - this.oy) / this.scale };
    }

    // ------------------------------------------------------------ backdrop
    buildBackground(rocks) {
      const key = JSON.stringify(rocks);
      if (key === this.bgKey) return;
      this.bgKey = key;
      const c = document.createElement('canvas');
      c.width = W; c.height = H;
      const x = c.getContext('2d');
      let seed = 7;
      const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

      x.fillStyle = '#16100e';
      x.fillRect(0, 0, W, H);
      const T = 64;
      for (let ty = 0; ty < H; ty += T) {
        for (let tx = 0; tx < W; tx += T) {
          const v = 22 + rnd() * 10;
          x.fillStyle = `rgb(${v + 6},${v},${v - 3})`;
          x.fillRect(tx + 2, ty + 2, T - 4, T - 4);
          if (rnd() < 0.25) {
            x.strokeStyle = 'rgba(0,0,0,.35)';
            x.lineWidth = 1.5;
            x.beginPath();
            const sx = tx + rnd() * T, sy = ty + rnd() * T;
            x.moveTo(sx, sy);
            x.lineTo(sx + (rnd() - 0.5) * 30, sy + (rnd() - 0.5) * 30);
            x.lineTo(sx + (rnd() - 0.5) * 40, sy + (rnd() - 0.5) * 40);
            x.stroke();
          }
        }
      }
      // Rune circle in the middle of the arena
      x.save();
      x.translate(W / 2, H / 2);
      x.strokeStyle = 'rgba(255,122,61,.13)';
      x.lineWidth = 3;
      for (const r of [150, 190]) { x.beginPath(); x.arc(0, 0, r, 0, TAU); x.stroke(); }
      x.lineWidth = 2;
      for (let i = 0; i < 12; i++) {
        x.rotate(TAU / 12);
        x.beginPath(); x.moveTo(155, 0); x.lineTo(185, 0); x.moveTo(170, -8); x.lineTo(170, 8); x.stroke();
      }
      x.beginPath();
      for (let i = 0; i <= 5; i++) { const a = (i * 2 * TAU) / 5 - Math.PI / 2; x.lineTo(Math.cos(a) * 140, Math.sin(a) * 140); }
      x.stroke();
      x.restore();

      // Walls
      const wall = x.createLinearGradient(0, 0, 0, WALL);
      wall.addColorStop(0, '#2a1d18'); wall.addColorStop(1, '#3d2a22');
      x.fillStyle = '#2b1e19';
      x.fillRect(0, 0, W, WALL); x.fillRect(0, H - WALL, W, WALL); x.fillRect(0, 0, WALL, H); x.fillRect(W - WALL, 0, WALL, H);
      x.strokeStyle = 'rgba(255,140,80,.25)';
      x.lineWidth = 2;
      x.strokeRect(WALL, WALL, W - 2 * WALL, H - 2 * WALL);
      x.fillStyle = 'rgba(0,0,0,.35)';
      for (let i = 0; i < W; i += 48) { x.fillRect(i, 0, 2, WALL); x.fillRect(i + 24, H - WALL, 2, WALL); }
      for (let i = 0; i < H; i += 48) { x.fillRect(0, i, WALL, 2); x.fillRect(W - WALL, i + 24, WALL, 2); }

      // Rocks
      for (const r of rocks) {
        x.fillStyle = 'rgba(0,0,0,.4)';
        x.beginPath(); x.ellipse(r.x + 6, r.y + 10, r.r, r.r * 0.8, 0, 0, TAU); x.fill();
        const gr = x.createRadialGradient(r.x - r.r * 0.4, r.y - r.r * 0.4, 2, r.x, r.y, r.r);
        gr.addColorStop(0, '#6b5a50'); gr.addColorStop(1, '#2e2420');
        x.fillStyle = gr;
        x.beginPath();
        for (let i = 0; i < 9; i++) {
          const a = (i / 9) * TAU, rr = r.r * (0.88 + rnd() * 0.14);
          x.lineTo(r.x + Math.cos(a) * rr, r.y + Math.sin(a) * rr);
        }
        x.closePath(); x.fill();
        x.strokeStyle = 'rgba(255,255,255,.06)';
        x.stroke();
      }
      this.bg = c;

      const v = document.createElement('canvas');
      v.width = W; v.height = H;
      const vx = v.getContext('2d');
      const vg = vx.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, W * 0.65);
      vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,.55)');
      vx.fillStyle = vg; vx.fillRect(0, 0, W, H);
      this._vignette = v;
    }

    // ------------------------------------------------------------- effects
    burst(x, y, color, n, speed = 220, life = 0.5, size = 3) {
      for (let i = 0; i < n && this.particles.length < 900; i++) {
        const a = Math.random() * TAU, s = speed * (0.3 + Math.random() * 0.7);
        this.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: life * (0.6 + Math.random() * 0.6), max: life, size: size * (0.6 + Math.random() * 0.8), color });
      }
    }
    text(x, y, txt, color = '#fff', size = 18) {
      if (this.texts.length < 80) this.texts.push({ x: x + (Math.random() - 0.5) * 12, y, txt, color, size, life: 0.8 });
    }
    banner(txt, sub = '', color = '#ffd166', dur = 2.2) {
      this.banners = [{ txt, sub, color, life: dur, max: dur }];
    }
    addShake(v) { this.shake = Math.min(18, this.shake + v); }

    // ---------------------------------------------------------------- draw
    draw(view, dt, opts = {}) {
      this.time += dt;
      const { ctx } = this;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = '#0b0807';
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
      if (!view) return;
      this.buildBackground(view.rocks);

      this.shake *= Math.pow(0.002, dt);
      const sx = (Math.random() - 0.5) * this.shake, sy = (Math.random() - 0.5) * this.shake;
      const s = this.scale * this.dpr;
      ctx.setTransform(s, 0, 0, s, (this.ox + sx) * this.dpr, (this.oy + sy) * this.dpr);

      ctx.drawImage(this.bg, 0, 0);
      for (const k of view.pickups) this.drawPickup(k);
      for (const e of view.enemies) this.drawEnemy(e);
      for (const p of view.players) this.drawPlayer(p, opts.localIds || []);
      this.drawBullets(view.bullets);
      this.updateParticles(dt);
      this.updateTexts(dt);
      if (this._vignette) ctx.drawImage(this._vignette, 0, 0);
      if (this.hud) this.drawHud(view, opts);
      this.updateBanners(dt);
    }

    drawPickup([, x, y, blink]) {
      if (blink && Math.floor(this.time * 8) % 2) return;
      const { ctx } = this;
      const bob = Math.sin(this.time * 4 + x) * 3;
      ctx.save();
      ctx.translate(x, y + bob);
      ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 26);
      g.addColorStop(0, 'rgba(255,80,110,.6)'); g.addColorStop(1, 'rgba(255,80,110,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, 26, 0, TAU); ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = '#ff4d6d';
      ctx.beginPath();
      ctx.moveTo(0, 8);
      ctx.bezierCurveTo(-14, -2, -8, -14, 0, -6);
      ctx.bezierCurveTo(8, -14, 14, -2, 0, 8);
      ctx.fill();
      ctx.restore();
    }

    drawEnemy([id, ti, x, y, hp, flash, state]) {
      const { ctx } = this;
      const type = ENEMY_TYPES[ti];
      const t = this.time + id * 0.37;
      const r = EmberSim.ENEMIES[type].r;
      ctx.save();
      ctx.translate(x, y);
      ctx.fillStyle = 'rgba(0,0,0,.35)';
      ctx.beginPath(); ctx.ellipse(0, r * 0.75, r, r * 0.35, 0, 0, TAU); ctx.fill();

      if (type === 'slime') {
        const sq = 1 + Math.sin(t * 8) * 0.08;
        ctx.scale(1 / sq, sq);
        ctx.fillStyle = flash ? '#fff' : '#5fd17a';
        ctx.beginPath(); ctx.arc(0, 2, r, Math.PI, 0); ctx.lineTo(r, r * 0.55); ctx.quadraticCurveTo(0, r * 0.9, -r, r * 0.55); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,.35)';
        ctx.beginPath(); ctx.ellipse(-r * 0.4, -r * 0.35, r * 0.25, r * 0.15, -0.5, 0, TAU); ctx.fill();
        this.eyes(r * 0.32, -1, 3.5, '#10261a');
      } else if (type === 'bat') {
        const flap = Math.sin(t * 22);
        ctx.fillStyle = flash ? '#fff' : '#7b3fbf';
        for (const sgn of [-1, 1]) {
          ctx.beginPath();
          ctx.moveTo(sgn * r * 0.5, 0);
          ctx.lineTo(sgn * r * 2.1, -r * (0.6 + flap * 0.7));
          ctx.lineTo(sgn * r * 1.5, r * 0.3);
          ctx.lineTo(sgn * r * 1.0, r * 0.1);
          ctx.fill();
        }
        ctx.fillStyle = flash ? '#fff' : '#9d5ce6';
        ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill();
        this.eyes(r * 0.35, -2, 3, '#ffd166');
      } else if (type === 'archer') {
        ctx.fillStyle = flash ? '#fff' : '#e8dcc8';
        ctx.beginPath(); ctx.arc(0, -2, r, 0, TAU); ctx.fill();
        ctx.fillRect(-r * 0.5, r * 0.5, r, r * 0.5);
        ctx.fillStyle = '#1b1210';
        ctx.beginPath(); ctx.arc(-r * 0.38, -3, r * 0.27, 0, TAU); ctx.arc(r * 0.38, -3, r * 0.27, 0, TAU); ctx.fill();
        ctx.fillStyle = '#ff3b3b';
        ctx.beginPath(); ctx.arc(-r * 0.38, -3, 2.4, 0, TAU); ctx.arc(r * 0.38, -3, 2.4, 0, TAU); ctx.fill();
        ctx.strokeStyle = '#8b5a2b'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(r * 1.1, 0, r * 0.9, -1.1, 1.1); ctx.stroke();
      } else if (type === 'brute') {
        const wind = state === 1, charge = state === 2;
        if (wind || charge) {
          ctx.shadowColor = '#ff3b3b'; ctx.shadowBlur = wind ? 25 + Math.sin(t * 40) * 10 : 15;
        }
        ctx.fillStyle = flash ? '#fff' : charge ? '#e0453a' : '#b0342b';
        this.roundRect(-r, -r * 0.9, r * 2, r * 1.8, r * 0.5); ctx.fill();
        ctx.shadowBlur = 0;
        ctx.fillStyle = '#efe6d8';
        for (const sgn of [-1, 1]) {
          ctx.beginPath(); ctx.moveTo(sgn * r * 0.5, -r * 0.8); ctx.lineTo(sgn * r * 0.95, -r * 1.45); ctx.lineTo(sgn * r * 0.85, -r * 0.7); ctx.fill();
        }
        this.eyes(r * 0.35, -r * 0.2, 4.5, wind ? '#ffd166' : '#1a0a08', true);
      } else if (type === 'boss') {
        const pulse = 0.5 + Math.sin(t * 5) * 0.5;
        ctx.globalCompositeOperation = 'lighter';
        const gl = ctx.createRadialGradient(0, 0, r * 0.3, 0, 0, r * 1.8);
        gl.addColorStop(0, `rgba(200,60,255,${0.25 + pulse * 0.2})`); gl.addColorStop(1, 'rgba(200,60,255,0)');
        ctx.fillStyle = gl; ctx.beginPath(); ctx.arc(0, 0, r * 1.8, 0, TAU); ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = flash ? '#fff' : '#2b0f4a';
        ctx.beginPath();
        for (let i = 0; i < 16; i++) {
          const a = (i / 16) * TAU + t * 0.4, rr = i % 2 ? r : r * 1.12;
          ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
        }
        ctx.fill();
        ctx.fillStyle = '#ffd166';
        for (let i = 0; i < 5; i++) {
          const cx = (i - 2) * 16;
          ctx.beginPath(); ctx.moveTo(cx - 7, -r * 0.75); ctx.lineTo(cx, -r * 1.15 - (i % 2 ? 0 : 8)); ctx.lineTo(cx + 7, -r * 0.75); ctx.fill();
        }
        const core = ctx.createRadialGradient(0, 4, 2, 0, 4, r * 0.45);
        core.addColorStop(0, '#fff'); core.addColorStop(0.4, '#ff5cf0'); core.addColorStop(1, 'rgba(120,0,160,0)');
        ctx.fillStyle = core; ctx.beginPath(); ctx.arc(0, 4, r * 0.45, 0, TAU); ctx.fill();
        this.eyes(r * 0.42, -r * 0.3, 7, '#ff5cf0', true);
      }
      ctx.restore();

      if (type !== 'boss' && hp < 100) {
        ctx.fillStyle = 'rgba(0,0,0,.6)';
        ctx.fillRect(x - r, y - r - 12, r * 2, 4);
        ctx.fillStyle = '#ff6b4a';
        ctx.fillRect(x - r, y - r - 12, (r * 2 * hp) / 100, 4);
      }
    }

    eyes(dx, y, size, color, angry) {
      const { ctx } = this;
      ctx.fillStyle = color;
      for (const sgn of [-1, 1]) {
        ctx.beginPath(); ctx.arc(sgn * dx, y, size, 0, TAU); ctx.fill();
      }
      if (angry) {
        ctx.strokeStyle = '#000'; ctx.lineWidth = 2.5;
        for (const sgn of [-1, 1]) {
          ctx.beginPath(); ctx.moveTo(sgn * (dx + size * 1.4), y - size * 1.8); ctx.lineTo(sgn * (dx - size * 0.8), y - size * 0.8); ctx.stroke();
        }
      }
    }

    roundRect(x, y, w, h, r) {
      const { ctx } = this;
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    }

    drawPlayer(p, localIds) {
      const { ctx } = this;
      const color = COLORS[p.slot];
      if (!p.alive) return;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.fillStyle = 'rgba(0,0,0,.4)';
      ctx.beginPath(); ctx.ellipse(0, 15, 17, 6, 0, 0, TAU); ctx.fill();

      if (p.downed) {
        ctx.globalAlpha = 0.75;
        ctx.fillStyle = '#5a5250';
        ctx.beginPath(); ctx.ellipse(0, 6, 22, 11, 0.2, 0, TAU); ctx.fill();
        ctx.globalAlpha = 1;
        ctx.strokeStyle = 'rgba(255,255,255,.25)'; ctx.lineWidth = 4;
        ctx.beginPath(); ctx.arc(0, 0, 34, 0, TAU); ctx.stroke();
        ctx.strokeStyle = color;
        ctx.beginPath(); ctx.arc(0, 0, 34, -Math.PI / 2, -Math.PI / 2 + TAU * p.revive); ctx.stroke();
        ctx.fillStyle = '#fff'; ctx.font = '600 13px Inter, sans-serif'; ctx.textAlign = 'center';
        ctx.fillText('HELP!', 0, -42 + Math.sin(this.time * 6) * 2);
        ctx.restore();
        return;
      }
      if (p.inv && Math.floor(this.time * 20) % 2) ctx.globalAlpha = 0.45;

      const ang = Math.atan2(p.dy, p.dx);
      // Glow
      ctx.globalCompositeOperation = 'lighter';
      const gl = ctx.createRadialGradient(0, 0, 4, 0, 0, 44);
      gl.addColorStop(0, color + '55'); gl.addColorStop(1, color + '00');
      ctx.fillStyle = gl; ctx.beginPath(); ctx.arc(0, 0, 44, 0, TAU); ctx.fill();
      ctx.globalCompositeOperation = 'source-over';

      // Staff
      ctx.save();
      ctx.rotate(ang);
      ctx.strokeStyle = '#6b4a2f'; ctx.lineWidth = 4; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(4, 10); ctx.lineTo(30, 6); ctx.stroke();
      ctx.fillStyle = shade(color, 0.4);
      ctx.shadowColor = color; ctx.shadowBlur = 14;
      ctx.beginPath(); ctx.arc(31, 6, 5, 0, TAU); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.restore();

      // Robe and hood
      ctx.fillStyle = shade(color, -0.35);
      ctx.beginPath(); ctx.moveTo(-16, 14); ctx.quadraticCurveTo(0, 22, 16, 14); ctx.lineTo(11, -4); ctx.lineTo(-11, -4); ctx.fill();
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(0, -5, 15, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.moveTo(-9, -16); ctx.lineTo(-2 - p.dx * 6, -30); ctx.lineTo(9, -16); ctx.fill();
      ctx.fillStyle = '#120c0a';
      ctx.beginPath(); ctx.arc(p.dx * 4, -4 + p.dy * 3, 9.5, 0, TAU); ctx.fill();
      ctx.fillStyle = shade(color, 0.6);
      ctx.shadowColor = color; ctx.shadowBlur = 8;
      for (const sgn of [-1, 1]) {
        ctx.beginPath(); ctx.arc(p.dx * 6 + sgn * 3.5 - p.dy * sgn * 1.5, -5 + p.dy * 4, 1.9, 0, TAU); ctx.fill();
      }
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;

      // Name and health
      const mine = localIds.includes(p.id);
      ctx.textAlign = 'center';
      ctx.font = `${mine ? 700 : 600} 13px Inter, sans-serif`;
      ctx.fillStyle = 'rgba(0,0,0,.6)';
      ctx.fillText(p.name, 1, -37);
      ctx.fillStyle = mine ? '#fff' : shade(color, 0.5);
      ctx.fillText(p.name, 0, -38);
      ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(-20, 24, 40, 5);
      ctx.fillStyle = p.hp / p.maxHp < 0.3 ? '#ff4d4d' : '#7ee081';
      ctx.fillRect(-20, 24, (40 * p.hp) / p.maxHp, 5);
      ctx.restore();
    }

    drawBullets(list) {
      const { ctx } = this;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (const [, x, y, slot, vx, vy] of list) {
        const enemy = slot < 0;
        const c = enemy ? '#c86bff' : COLORS[slot];
        const len = Math.hypot(vx, vy) || 1;
        const tx = (vx / len) * (enemy ? 10 : 18), ty = (vy / len) * (enemy ? 10 : 18);
        ctx.strokeStyle = c + '88'; ctx.lineWidth = enemy ? 8 : 7; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(x - tx, y - ty); ctx.lineTo(x, y); ctx.stroke();
        ctx.fillStyle = enemy ? '#f0c8ff' : '#fff6e0';
        ctx.beginPath(); ctx.arc(x, y, enemy ? 5.5 : 4, 0, TAU); ctx.fill();
        ctx.fillStyle = c + '66';
        ctx.beginPath(); ctx.arc(x, y, enemy ? 11 : 9, 0, TAU); ctx.fill();
      }
      ctx.restore();
    }

    updateParticles(dt) {
      const { ctx } = this;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      this.particles = this.particles.filter((q) => {
        q.life -= dt;
        if (q.life <= 0) return false;
        q.x += q.vx * dt; q.y += q.vy * dt;
        q.vx *= 1 - 3 * dt; q.vy *= 1 - 3 * dt;
        ctx.globalAlpha = Math.min(1, q.life / q.max * 1.5);
        ctx.fillStyle = q.color;
        ctx.beginPath(); ctx.arc(q.x, q.y, q.size, 0, TAU); ctx.fill();
        return true;
      });
      ctx.restore();
    }

    updateTexts(dt) {
      const { ctx } = this;
      ctx.save();
      ctx.textAlign = 'center';
      this.texts = this.texts.filter((t) => {
        t.life -= dt;
        if (t.life <= 0) return false;
        t.y -= 40 * dt;
        ctx.globalAlpha = Math.min(1, t.life * 2);
        ctx.font = `800 ${t.size}px Inter, sans-serif`;
        ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillText(t.txt, t.x + 1.5, t.y + 1.5);
        ctx.fillStyle = t.color; ctx.fillText(t.txt, t.x, t.y);
        return true;
      });
      ctx.restore();
    }

    updateBanners(dt) {
      const { ctx } = this;
      this.banners = this.banners.filter((b) => {
        b.life -= dt;
        if (b.life <= 0) return false;
        const k = b.max - b.life, a = Math.min(1, k * 4, b.life * 2);
        const sc = 1 + Math.max(0, 0.25 - k) * 1.2;
        ctx.save();
        ctx.globalAlpha = a;
        ctx.translate(W / 2, H * 0.36);
        ctx.scale(sc, sc);
        ctx.textAlign = 'center';
        ctx.font = '900 64px Inter, sans-serif';
        ctx.lineWidth = 8; ctx.strokeStyle = 'rgba(0,0,0,.7)'; ctx.strokeText(b.txt, 0, 0);
        ctx.fillStyle = b.color; ctx.fillText(b.txt, 0, 0);
        if (b.sub) {
          ctx.font = '600 22px Inter, sans-serif';
          ctx.lineWidth = 5; ctx.strokeText(b.sub, 0, 40);
          ctx.fillStyle = '#f5ece4'; ctx.fillText(b.sub, 0, 40);
        }
        ctx.restore();
        return true;
      });
    }

    // ------------------------------------------------------------------ HUD
    drawHud(view, opts) {
      const { ctx } = this;
      ctx.save();
      ctx.textBaseline = 'alphabetic';
      view.players.slice().sort((a, b) => a.slot - b.slot).forEach((p, i) => {
        const x = 44 + i * 250, y = 44;
        const c = COLORS[p.slot];
        ctx.fillStyle = 'rgba(12,8,7,.72)';
        this.roundRect(x, y, 232, 54, 10); ctx.fill();
        ctx.strokeStyle = c + '66'; ctx.lineWidth = 1.5; ctx.stroke();
        ctx.fillStyle = c; ctx.beginPath(); ctx.arc(x + 20, y + 20, 7, 0, TAU); ctx.fill();
        ctx.font = '700 14px Inter, sans-serif'; ctx.textAlign = 'left';
        ctx.fillStyle = '#f5ece4'; ctx.fillText(p.name, x + 34, y + 25);
        ctx.textAlign = 'right'; ctx.fillStyle = '#c9b8ab'; ctx.font = '600 12px Inter, sans-serif';
        ctx.fillText(view.mode === 'versus' ? `${p.kills} kills` : `${p.score}`, x + 220, y + 25);
        ctx.fillStyle = 'rgba(255,255,255,.1)'; ctx.fillRect(x + 14, y + 36, 170, 7);
        ctx.fillStyle = p.downed || !p.alive ? '#666' : p.hp / p.maxHp < 0.3 ? '#ff4d4d' : '#7ee081';
        ctx.fillRect(x + 14, y + 36, (170 * Math.max(0, p.hp)) / p.maxHp, 7);
        // dash pip
        ctx.strokeStyle = 'rgba(255,255,255,.2)'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(x + 208, y + 39, 8, 0, TAU); ctx.stroke();
        ctx.strokeStyle = p.dashReady >= 1 ? '#4cc9f0' : '#3a6b80';
        ctx.beginPath(); ctx.arc(x + 208, y + 39, 8, -Math.PI / 2, -Math.PI / 2 + TAU * p.dashReady); ctx.stroke();
      });

      ctx.textAlign = 'right';
      if (view.mode === 'coop') {
        ctx.font = '900 30px Inter, sans-serif'; ctx.fillStyle = '#ffd166';
        ctx.fillText(view.wave ? `WAVE ${view.wave}` : 'GET READY', W - 46, 72);
        ctx.font = '600 14px Inter, sans-serif'; ctx.fillStyle = '#e6d6c9';
        const sub = view.phase === 'intermission' ? `Next wave in ${Math.ceil(view.timer)}s` : view.phase === 'wave' ? `${view.left} enemies left · ${view.score} pts` : '';
        ctx.fillText(sub, W - 46, 94);
      } else {
        ctx.font = '900 30px Inter, sans-serif'; ctx.fillStyle = '#ffd166';
        const m = Math.floor(view.timeLeft / 60), s = String(view.timeLeft % 60).padStart(2, '0');
        ctx.fillText(`${m}:${s}`, W - 46, 72);
        ctx.font = '600 14px Inter, sans-serif'; ctx.fillStyle = '#e6d6c9';
        ctx.fillText(`First to ${view.killTarget} kills`, W - 46, 94);
      }

      if (view.phase === 'countdown') {
        ctx.textAlign = 'center';
        ctx.font = '900 96px Inter, sans-serif';
        ctx.fillStyle = '#fff';
        ctx.lineWidth = 8; ctx.strokeStyle = 'rgba(0,0,0,.6)';
        const n = String(Math.max(1, Math.ceil(view.timer)));
        ctx.strokeText(n, W / 2, H / 2 - 120); ctx.fillText(n, W / 2, H / 2 - 120);
      }

      const boss = view.enemies.find((e) => ENEMY_TYPES[e[1]] === 'boss');
      if (boss) {
        const bw = 600, bx = (W - bw) / 2, by = H - 70;
        ctx.fillStyle = 'rgba(12,8,7,.8)'; this.roundRect(bx - 10, by - 28, bw + 20, 50, 10); ctx.fill();
        ctx.textAlign = 'center'; ctx.font = '800 14px Inter, sans-serif'; ctx.fillStyle = '#e9b8ff';
        ctx.fillText('THE HOLLOW KING', W / 2, by - 9);
        ctx.fillStyle = 'rgba(255,255,255,.1)'; ctx.fillRect(bx, by, bw, 10);
        ctx.fillStyle = '#c84bff'; ctx.fillRect(bx, by, (bw * boss[4]) / 100, 10);
      }

      for (const p of view.players) {
        if (!p.alive && p.respawn > 0 && (opts.localIds || []).includes(p.id)) {
          ctx.textAlign = 'center'; ctx.font = '700 22px Inter, sans-serif'; ctx.fillStyle = '#fff';
          ctx.fillText(`${p.name}: respawning in ${Math.ceil(p.respawn)}…`, W / 2, H - 60);
        }
      }
      ctx.restore();
    }

    // Turn simulation events into sound, particles and shake.
    applyEvents(events, audio, localSlots = []) {
      for (const e of events) {
        const c = e.s >= 0 ? COLORS[e.s] : '#c86bff';
        switch (e.k) {
          case 'shot': this.burst(e.x, e.y, c, 3, 120, 0.15, 2.5); audio && audio.sfx('shot', e.s); break;
          case 'hit': this.burst(e.x, e.y, '#ffcf8a', 5, 160, 0.25, 2.5); this.text(e.x, e.y - 10, e.d, '#ffe2b8', 15); audio && audio.sfx('hit'); break;
          case 'spark': this.burst(e.x, e.y, c, 4, 90, 0.2, 2); break;
          case 'kill': {
            const col = { slime: '#5fd17a', bat: '#9d5ce6', archer: '#e8dcc8', brute: '#e0453a', boss: '#ff5cf0' }[e.e];
            this.burst(e.x, e.y, col, e.e === 'boss' ? 120 : e.e === 'brute' ? 30 : 16, e.e === 'boss' ? 500 : 260, e.e === 'boss' ? 1.4 : 0.6, e.e === 'boss' ? 6 : 4);
            this.addShake(e.e === 'boss' ? 18 : e.e === 'brute' ? 6 : 2);
            audio && audio.sfx(e.e === 'boss' ? 'bossdie' : 'kill');
            if (e.e === 'boss') this.banner('BOSS DEFEATED', '', '#ff5cf0');
            break;
          }
          case 'hurt':
            this.burst(e.x, e.y, '#ff4d4d', 10, 200, 0.4, 3);
            if (localSlots.includes(e.s)) { this.addShake(9); audio && audio.sfx('hurt'); }
            break;
          case 'down': this.burst(e.x, e.y, c, 30, 260, 0.8, 4); this.addShake(10); audio && audio.sfx('down'); break;
          case 'revive': this.burst(e.x, e.y, '#7ee081', 30, 220, 0.8, 3.5); audio && audio.sfx('revive'); break;
          case 'pkill': this.burst(e.x, e.y, c, 40, 320, 0.9, 4.5); this.addShake(8); audio && audio.sfx('kill'); break;
          case 'spawn': if (e.s != null) { this.burst(e.x, e.y, c, 24, 200, 0.6, 3); } else this.burst(e.x, e.y, '#3a2a40', 6, 80, 0.4, 3); break;
          case 'dash': this.burst(e.x, e.y, c, 14, 160, 0.35, 3.5); audio && audio.sfx('dash'); break;
          case 'pickup': this.burst(e.x, e.y, '#ff4d6d', 18, 180, 0.5, 3); this.text(e.x, e.y - 14, '+30', '#ff8fa3', 18); audio && audio.sfx('pickup'); break;
          case 'eshot': audio && audio.sfx(e.big ? 'bossshot' : 'eshot'); break;
          case 'charge': audio && audio.sfx('charge'); break;
          case 'wave':
            this.banner(e.boss ? 'BOSS WAVE' : `WAVE ${e.n}`, e.boss ? 'The Hollow King awakens' : '', e.boss ? '#ff5cf0' : '#ffd166');
            audio && audio.sfx(e.boss ? 'boss' : 'wave');
            if (e.boss) this.addShake(12);
            break;
          case 'cleared': this.banner('WAVE CLEARED', 'Choose an upgrade', '#7ee081', 2); audio && audio.sfx('cleared'); break;
          case 'upgrade': if (localSlots.includes(e.s)) audio && audio.sfx('upgrade'); break;
          case 'fight': this.banner('FIGHT!', '', '#ff7a3d', 1.4); audio && audio.sfx('wave'); break;
          case 'over': audio && audio.sfx('over'); break;
        }
      }
    }
  }

  window.EmberRenderer = Renderer;
})();
