/**
 * Emberwake game simulation.
 *
 * Pure game logic with no rendering, shared by the browser (solo and local
 * play) and by server.js (LAN / online play, where the server is authoritative).
 *
 *   const game = EmberSim.create({ mode: 'coop', players: [{ id, name }], seed });
 *   EmberSim.step(game, { [playerId]: input }, dt);
 *   const view = EmberSim.snapshot(game);   // what the renderer draws
 *   const events = EmberSim.drainEvents(game);  // sounds and effects
 *
 * Input: { mx, my, ax, ay, fire, dash, pick }
 *   mx/my  movement (-1..1), ax/ay aim direction (0,0 = auto-aim),
 *   fire   held, dash pressed this step, pick upgrade index (0-2) or -1.
 */
(function (root) {
  'use strict';

  const W = 1600;
  const H = 900;
  const WALL = 28;
  const COLORS = ['#ff7a3d', '#4cc9f0', '#b5e853', '#f472b6'];
  const VERSUS_KILLS = 7;
  const VERSUS_TIME = 180;

  const ENEMY_TYPES = ['slime', 'bat', 'archer', 'brute', 'boss'];
  const ENEMIES = {
    slime:  { r: 16, hp: 30,   speed: 74,  dmg: 10, score: 10 },
    bat:    { r: 12, hp: 16,   speed: 150, dmg: 8,  score: 15 },
    archer: { r: 15, hp: 26,   speed: 66,  dmg: 10, score: 20, range: 330 },
    brute:  { r: 28, hp: 150,  speed: 46,  dmg: 22, score: 40 },
    boss:   { r: 56, hp: 1100, speed: 42,  dmg: 30, score: 500 },
  };

  const UPGRADES = {
    dmg:    { name: 'Searing Bolts', desc: '+25% damage',            apply: (p) => { p.stats.dmg *= 1.25; } },
    rate:   { name: 'Quick Cast',    desc: '+20% fire rate',         apply: (p) => { p.stats.rate *= 1.2; } },
    multi:  { name: 'Split Shot',    desc: '+1 bolt per cast',       apply: (p) => { p.stats.multi = Math.min(7, p.stats.multi + 1); } },
    speed:  { name: 'Fleet Foot',    desc: '+12% move speed',        apply: (p) => { p.stats.speed *= 1.12; } },
    hp:     { name: 'Ember Heart',   desc: '+25 max HP, full heal',  apply: (p) => { p.maxHp += 25; p.hp = p.maxHp; } },
    pierce: { name: 'Lance',         desc: 'Bolts pierce +1 enemy',  apply: (p) => { p.stats.pierce += 1; } },
    regen:  { name: 'Kindling',      desc: 'Regenerate 1.5 HP/s',    apply: (p) => { p.stats.regen += 1.5; } },
    dash:   { name: 'Blink',         desc: '-30% dash cooldown',     apply: (p) => { p.stats.dashCd *= 0.7; } },
  };
  const UPGRADE_KEYS = Object.keys(UPGRADES);

  // ------------------------------------------------------------------ utils
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const dist2 = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
  function norm(x, y) {
    const l = Math.hypot(x, y);
    return l > 0 ? [x / l, y / l, l] : [0, 0, 0];
  }
  const r1 = (v) => Math.round(v * 10) / 10;

  function emit(g, k, data) { g.events.push(Object.assign({ k }, data)); }

  // ------------------------------------------------------------------ setup
  function create(opts) {
    const rng = mulberry32((opts.seed >>> 0) || 1);
    const g = {
      mode: opts.mode === 'versus' ? 'versus' : 'coop',
      rng, t: 0, tick: 0, nextId: 1,
      phase: 'countdown', phaseTimer: 3, wave: 0,
      spawnQueue: [], spawnTimer: 0,
      players: [], enemies: [], bullets: [], pickups: [], rocks: [],
      events: [], score: 0, winner: null, timeLeft: VERSUS_TIME, pickupTimer: 8,
    };
    makeRocks(g);
    opts.players.forEach((info, i) => g.players.push(makePlayer(g, i, info)));
    return g;
  }

  function makeRocks(g) {
    const count = 6 + Math.floor(g.rng() * 3);
    for (let tries = 0; g.rocks.length < count && tries < 300; tries++) {
      const r = 26 + g.rng() * 30;
      const rock = { x: 160 + g.rng() * (W - 320), y: 140 + g.rng() * (H - 280), r };
      if (Math.hypot(rock.x - W / 2, rock.y - H / 2) < 230) continue;
      if (g.rocks.some((o) => Math.hypot(o.x - rock.x, o.y - rock.y) < o.r + r + 110)) continue;
      rock.x = Math.round(rock.x); rock.y = Math.round(rock.y); rock.r = Math.round(r);
      g.rocks.push(rock);
    }
  }

  function spawnPoint(g, i, n) {
    if (g.mode === 'versus') {
      const corners = [[200, 200], [W - 200, H - 200], [W - 200, 200], [200, H - 200]];
      return corners[i % 4];
    }
    const a = (i / Math.max(1, n)) * Math.PI * 2 - Math.PI / 2;
    return [W / 2 + Math.cos(a) * 60, H / 2 + Math.sin(a) * 60];
  }

  function makePlayer(g, slot, info) {
    const [x, y] = spawnPoint(g, slot, 4);
    return {
      id: info.id, slot, name: String(info.name || `Player ${slot + 1}`).slice(0, 16),
      x, y, vx: 0, vy: 0, r: 18,
      hp: 100, maxHp: 100, alive: true, downed: false, reviveT: 0, respawn: 0,
      dirX: 1, dirY: 0, fireCd: 0, dashCd: 0, dashT: 0, dashX: 0, dashY: 0, inv: 1,
      stats: { dmg: 12, rate: 4, multi: 1, speed: 230, pierce: 0, regen: 0, dashCd: 2.2 },
      kills: 0, deaths: 0, score: 0, offers: null, upgrades: [],
    };
  }

  function addPlayer(g, info) {
    const used = new Set(g.players.map((p) => p.slot));
    let slot = 0;
    while (used.has(slot)) slot++;
    const p = makePlayer(g, slot, info);
    g.players.push(p);
    return p;
  }

  function removePlayer(g, id) {
    g.players = g.players.filter((p) => p.id !== id);
    if (g.phase === 'over') return;
    if (g.mode === 'versus' && g.players.length < 2) endGame(g, g.players[0] ? g.players[0].slot : null);
    else if (g.mode === 'coop') checkAllDown(g);
  }

  // ------------------------------------------------------------------- step
  function step(g, inputs, dt) {
    g.t += dt;
    g.tick++;
    if (g.phase === 'over') return;

    for (const p of g.players) updatePlayer(g, p, inputs[p.id] || NO_INPUT, dt);
    updateBullets(g, dt);
    updatePickups(g, dt);

    if (g.mode === 'coop') {
      updateEnemies(g, dt);
      updateRevives(g, dt);
      updateWaves(g, inputs, dt);
    } else {
      updateVersus(g, dt);
    }
  }

  const NO_INPUT = { mx: 0, my: 0, ax: 0, ay: 0, fire: false, dash: false, pick: -1 };

  function collideWorld(g, o) {
    o.x = clamp(o.x, WALL + o.r, W - WALL - o.r);
    o.y = clamp(o.y, WALL + o.r, H - WALL - o.r);
    for (const r of g.rocks) {
      const dx = o.x - r.x, dy = o.y - r.y, min = r.r + o.r;
      const d2 = dx * dx + dy * dy;
      if (d2 < min * min) {
        const d = Math.sqrt(d2) || 1;
        o.x = r.x + (dx / d) * min;
        o.y = r.y + (dy / d) * min;
      }
    }
  }

  function updatePlayer(g, p, inp, dt) {
    if (!p.alive) {
      if (g.mode === 'versus' && p.respawn > 0) {
        p.respawn -= dt;
        if (p.respawn <= 0) respawn(g, p);
      }
      return;
    }
    if (p.downed) return;

    p.inv = Math.max(0, p.inv - dt);
    p.fireCd -= dt;
    p.dashCd -= dt;
    if (p.stats.regen) p.hp = Math.min(p.maxHp, p.hp + p.stats.regen * dt);

    let [mx, my, ml] = norm(clamp(inp.mx || 0, -1, 1), clamp(inp.my || 0, -1, 1));
    const mag = Math.min(1, ml);

    if (inp.dash && p.dashCd <= 0) {
      const [dx, dy] = ml > 0.1 ? [mx, my] : [p.dirX, p.dirY];
      p.dashX = dx; p.dashY = dy; p.dashT = 0.16; p.dashCd = p.stats.dashCd;
      p.inv = Math.max(p.inv, 0.25);
      emit(g, 'dash', { x: r1(p.x), y: r1(p.y), s: p.slot });
    }

    if (p.dashT > 0) {
      p.dashT -= dt;
      p.vx = p.dashX * 950; p.vy = p.dashY * 950;
    } else {
      // Light acceleration so movement feels responsive but not twitchy.
      const tx = mx * mag * p.stats.speed, ty = my * mag * p.stats.speed;
      const k = Math.min(1, dt * 18);
      p.vx += (tx - p.vx) * k; p.vy += (ty - p.vy) * k;
    }
    p.x += p.vx * dt; p.y += p.vy * dt;
    collideWorld(g, p);

    // Aim: explicit direction, else nearest target, else movement direction.
    let [ax, ay, al] = norm(inp.ax || 0, inp.ay || 0);
    if (al < 0.01) {
      const target = nearestTarget(g, p, 700);
      if (target) [ax, ay] = norm(target.x - p.x, target.y - p.y);
      else if (ml > 0.1) [ax, ay] = [mx, my];
      else [ax, ay] = [p.dirX, p.dirY];
    }
    p.dirX = ax; p.dirY = ay;

    if (inp.fire && p.fireCd <= 0) {
      p.fireCd = 1 / p.stats.rate;
      const n = p.stats.multi, spread = 0.13;
      const base = Math.atan2(ay, ax);
      for (let i = 0; i < n; i++) {
        const a = base + (i - (n - 1) / 2) * spread;
        const cx = Math.cos(a), cy = Math.sin(a);
        g.bullets.push({
          id: g.nextId++, own: p.id, slot: p.slot,
          x: p.x + cx * 24, y: p.y + cy * 24, vx: cx * 680, vy: cy * 680,
          r: 6, dmg: p.stats.dmg, life: 0.9, pierce: p.stats.pierce, hits: [],
        });
      }
      emit(g, 'shot', { x: r1(p.x + ax * 26), y: r1(p.y + ay * 26), s: p.slot });
    }

    if (g.phase === 'intermission' && p.offers && inp.pick >= 0 && inp.pick < p.offers.length) {
      applyUpgrade(g, p, p.offers[inp.pick]);
    }
  }

  function nearestTarget(g, p, range) {
    let best = null, bd = range * range;
    const list = g.mode === 'coop' ? g.enemies : g.players.filter((o) => o !== p && o.alive);
    for (const e of list) {
      const d = dist2(p, e);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }

  function applyUpgrade(g, p, key) {
    UPGRADES[key].apply(p);
    p.upgrades.push(key);
    p.offers = null;
    emit(g, 'upgrade', { s: p.slot, u: key });
  }

  function respawn(g, p) {
    let best = null, bestD = -1;
    for (let i = 0; i < 8; i++) {
      const c = { x: 150 + g.rng() * (W - 300), y: 150 + g.rng() * (H - 300), r: p.r };
      collideWorld(g, c);
      const d = Math.min(...g.players.filter((o) => o !== p && o.alive).map((o) => dist2(o, c)), 1e9);
      if (d > bestD) { bestD = d; best = c; }
    }
    Object.assign(p, { x: best.x, y: best.y, vx: 0, vy: 0, hp: p.maxHp, alive: true, inv: 1.5, dashT: 0 });
    emit(g, 'spawn', { x: r1(p.x), y: r1(p.y), s: p.slot });
  }

  function damagePlayer(g, p, dmg, killer) {
    if (!p.alive || p.downed || p.inv > 0) return;
    p.hp -= dmg;
    p.inv = 0.5;
    emit(g, 'hurt', { x: r1(p.x), y: r1(p.y), s: p.slot });
    if (p.hp > 0) return;
    p.hp = 0;
    p.deaths++;
    if (g.mode === 'coop') {
      p.downed = true; p.reviveT = 0;
      emit(g, 'down', { x: r1(p.x), y: r1(p.y), s: p.slot });
      checkAllDown(g);
    } else {
      p.alive = false; p.respawn = 2.5;
      if (killer) { killer.kills++; killer.score += 100; }
      emit(g, 'pkill', { x: r1(p.x), y: r1(p.y), s: p.slot, by: killer ? killer.slot : -1 });
      if (killer && killer.kills >= VERSUS_KILLS) endGame(g, killer.slot);
    }
  }

  function checkAllDown(g) {
    if (g.phase === 'over') return;
    if (g.players.every((p) => p.downed || !p.alive)) endGame(g, null);
  }

  function endGame(g, winner) {
    g.phase = 'over';
    g.winner = winner;
    emit(g, 'over', { w: winner });
  }

  // ---------------------------------------------------------------- bullets
  function updateBullets(g, dt) {
    const keep = [];
    for (const b of g.bullets) {
      b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt;
      let dead = b.life <= 0 || b.x < WALL || b.x > W - WALL || b.y < WALL || b.y > H - WALL;
      if (!dead) {
        for (const r of g.rocks) {
          if ((b.x - r.x) ** 2 + (b.y - r.y) ** 2 < (r.r + b.r) ** 2) {
            dead = true;
            emit(g, 'spark', { x: r1(b.x), y: r1(b.y), s: b.slot });
            break;
          }
        }
      }
      if (!dead) dead = b.own == null ? hitPlayersByEnemy(g, b) : g.mode === 'coop' ? hitEnemies(g, b) : hitPlayersByPlayer(g, b);
      if (!dead) keep.push(b);
    }
    g.bullets = keep;
  }

  function hitEnemies(g, b) {
    for (const e of g.enemies) {
      if (e.hp <= 0 || b.hits.includes(e.id)) continue;
      if ((b.x - e.x) ** 2 + (b.y - e.y) ** 2 > (b.r + e.r) ** 2) continue;
      e.hp -= b.dmg;
      e.flash = 0.1;
      if (e.type !== 'boss') { e.x += b.vx * 0.012; e.y += b.vy * 0.012; }
      b.hits.push(e.id);
      emit(g, 'hit', { x: r1(b.x), y: r1(b.y), d: Math.round(b.dmg), s: b.slot });
      if (e.hp <= 0) killEnemy(g, e, g.players.find((p) => p.id === b.own));
      if (b.pierce > 0) { b.pierce--; continue; }
      return true;
    }
    return false;
  }

  function hitPlayersByPlayer(g, b) {
    for (const p of g.players) {
      if (p.id === b.own || !p.alive || p.inv > 0) continue;
      if ((b.x - p.x) ** 2 + (b.y - p.y) ** 2 > (b.r + p.r) ** 2) continue;
      emit(g, 'hit', { x: r1(b.x), y: r1(b.y), d: Math.round(b.dmg), s: b.slot });
      damagePlayer(g, p, b.dmg, g.players.find((o) => o.id === b.own));
      return true;
    }
    return false;
  }

  function hitPlayersByEnemy(g, b) {
    for (const p of g.players) {
      if (!p.alive || p.downed || p.inv > 0) continue;
      if ((b.x - p.x) ** 2 + (b.y - p.y) ** 2 > (b.r + p.r) ** 2) continue;
      damagePlayer(g, p, b.dmg, null);
      return true;
    }
    return false;
  }

  // ---------------------------------------------------------------- enemies
  function waveScale(g) { const w = g.wave - 1; return 1 + 0.2 * w + 0.015 * w * w; }
  function dmgScale(g) { return 1 + 0.06 * (g.wave - 1); }

  function spawnEnemy(g, type, at) {
    const def = ENEMIES[type];
    let x, y;
    if (at) { x = at.x; y = at.y; }
    else {
      const side = Math.floor(g.rng() * 4), m = WALL + def.r + 4;
      x = side < 2 ? m + g.rng() * (W - 2 * m) : side === 2 ? m : W - m;
      y = side >= 2 ? m + g.rng() * (H - 2 * m) : side === 0 ? m : H - m;
    }
    const np = Math.max(1, g.players.length);
    let hp = def.hp * waveScale(g);
    if (type === 'boss') hp *= 1 + 0.6 * (np - 1) + 0.25 * (g.wave / 5 - 1);
    const e = {
      id: g.nextId++, type, x, y, r: def.r, hp, maxHp: hp,
      cd: 1 + g.rng() * 1.5, t: g.rng() * 10, flash: 0, state: 0, stateT: 0, cx: 0, cy: 0,
      cd2: 6,
    };
    g.enemies.push(e);
    emit(g, 'spawn', { x: r1(x), y: r1(y), e: type });
    return e;
  }

  function killEnemy(g, e, by) {
    const def = ENEMIES[e.type];
    g.score += def.score;
    if (by) { by.kills++; by.score += def.score; }
    emit(g, 'kill', { x: r1(e.x), y: r1(e.y), e: e.type });
    const drops = e.type === 'boss' ? 3 : g.rng() < 0.06 ? 1 : 0;
    for (let i = 0; i < drops; i++) {
      g.pickups.push({ id: g.nextId++, type: 'heal', x: e.x + (i - 1) * 40, y: e.y, life: 15 });
    }
  }

  function enemyShoot(g, e, ang, speed, dmg) {
    g.bullets.push({
      id: g.nextId++, own: null, slot: -1,
      x: e.x + Math.cos(ang) * (e.r + 6), y: e.y + Math.sin(ang) * (e.r + 6),
      vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed, r: 7, dmg, life: 3.2, pierce: 0, hits: [],
    });
  }

  function updateEnemies(g, dt) {
    const targets = g.players.filter((p) => p.alive && !p.downed);
    for (const e of g.enemies) {
      const def = ENEMIES[e.type];
      e.t += dt;
      e.flash = Math.max(0, e.flash - dt);
      let target = null, bd = Infinity;
      for (const p of targets) { const d = dist2(p, e); if (d < bd) { bd = d; target = p; } }
      const [dx, dy, d] = target ? norm(target.x - e.x, target.y - e.y) : [Math.cos(e.t * 0.3), Math.sin(e.t * 0.3), 999];
      let sp = def.speed * (1 + 0.03 * (g.wave - 1));
      let vx = dx, vy = dy;

      if (e.type === 'bat') {
        const wob = Math.sin(e.t * 6) * 0.9;
        vx = dx - dy * wob; vy = dy + dx * wob;
      } else if (e.type === 'archer') {
        if (d < def.range * 0.65) { vx = -dx; vy = -dy; }
        else if (d < def.range) { vx = -dy * Math.sign(Math.sin(e.t * 0.7) || 1); vy = dx * Math.sign(Math.sin(e.t * 0.7) || 1); sp *= 0.6; }
        e.cd -= dt;
        if (target && e.cd <= 0 && d < def.range + 160) {
          enemyShoot(g, e, Math.atan2(dy, dx), 270, def.dmg * dmgScale(g));
          emit(g, 'eshot', { x: r1(e.x), y: r1(e.y) });
          e.cd = 1.7 + g.rng() * 0.8;
        }
      } else if (e.type === 'brute') {
        // 0 = walk, 1 = wind-up (telegraphed), 2 = charge
        e.stateT -= dt;
        if (e.state === 0) {
          e.cd -= dt;
          if (target && e.cd <= 0 && d < 420) { e.state = 1; e.stateT = 0.6; e.cx = dx; e.cy = dy; }
        } else if (e.state === 1) {
          sp = 0;
          if (e.stateT <= 0) { e.state = 2; e.stateT = 0.55; emit(g, 'charge', { x: r1(e.x), y: r1(e.y) }); }
        } else {
          vx = e.cx; vy = e.cy; sp = 430;
          if (e.stateT <= 0) { e.state = 0; e.cd = 3 + g.rng() * 2; }
        }
      } else if (e.type === 'boss') {
        const enraged = e.hp < e.maxHp * 0.5;
        sp *= enraged ? 1.5 : 1;
        e.cd -= dt;
        if (e.cd <= 0) {
          const n = enraged ? 18 : 14, off = e.t;
          for (let i = 0; i < n; i++) enemyShoot(g, e, off + (i / n) * Math.PI * 2, enraged ? 230 : 200, 12 * dmgScale(g));
          emit(g, 'eshot', { x: r1(e.x), y: r1(e.y), big: 1 });
          e.cd = enraged ? 1.8 : 2.6;
        }
        e.cd2 -= dt;
        if (e.cd2 <= 0) {
          for (let i = 0; i < 3; i++) {
            const a = (i / 3) * Math.PI * 2 + e.t;
            const m = spawnEnemy(g, 'slime', { x: e.x + Math.cos(a) * 90, y: e.y + Math.sin(a) * 90 });
            collideWorld(g, m);
          }
          e.cd2 = 7;
        }
      }

      const [nx, ny] = norm(vx, vy);
      e.x += nx * sp * dt; e.y += ny * sp * dt;

      for (const p of targets) {
        if ((p.x - e.x) ** 2 + (p.y - e.y) ** 2 < (p.r + e.r) ** 2) {
          if (p.inv <= 0) {
            damagePlayer(g, p, def.dmg * dmgScale(g), null);
            const [kx, ky] = norm(p.x - e.x, p.y - e.y);
            p.vx += kx * 420; p.vy += ky * 420;
          }
        }
      }
    }

    // Keep enemies from stacking on top of each other.
    const es = g.enemies;
    for (let i = 0; i < es.length; i++) {
      for (let j = i + 1; j < es.length; j++) {
        const a = es[i], b = es[j];
        const dx = b.x - a.x, dy = b.y - a.y, min = a.r + b.r;
        const d2 = dx * dx + dy * dy;
        if (d2 > 0 && d2 < min * min) {
          const d = Math.sqrt(d2), push = (min - d) / 2;
          const wa = a.type === 'boss' ? 0 : 1, wb = b.type === 'boss' ? 0 : 1;
          a.x -= (dx / d) * push * wa; a.y -= (dy / d) * push * wa;
          b.x += (dx / d) * push * wb; b.y += (dy / d) * push * wb;
        }
      }
    }
    for (const e of es) collideWorld(g, e);
    g.enemies = es.filter((e) => e.hp > 0);
  }

  function updateRevives(g, dt) {
    for (const p of g.players) {
      if (!p.downed) continue;
      const helper = g.players.some((o) => o !== p && o.alive && !o.downed && dist2(o, p) < 75 * 75);
      p.reviveT = helper ? p.reviveT + dt : Math.max(0, p.reviveT - dt * 0.5);
      if (p.reviveT >= 2.2) {
        p.downed = false; p.reviveT = 0; p.hp = Math.round(p.maxHp * 0.4); p.inv = 1.2;
        emit(g, 'revive', { x: r1(p.x), y: r1(p.y), s: p.slot });
      }
    }
  }

  // ------------------------------------------------------------------ waves
  function pickType(g) {
    const n = g.wave;
    const weights = [['slime', 5], ['bat', n >= 2 ? 3 : 0], ['archer', n >= 3 ? 2.2 : 0], ['brute', n >= 4 ? 1 + n * 0.08 : 0]];
    let total = weights.reduce((s, w) => s + w[1], 0), r = g.rng() * total;
    for (const [t, w] of weights) { if ((r -= w) <= 0) return t; }
    return 'slime';
  }

  function startWave(g, n) {
    g.wave = n;
    g.phase = 'wave';
    const np = Math.max(1, g.players.length);
    const boss = n % 5 === 0;
    let count = Math.round((5 + n * 3) * (1 + 0.6 * (np - 1)) * (boss ? 0.4 : 1));
    g.spawnQueue = [];
    if (boss) g.spawnQueue.push('boss');
    for (let i = 0; i < count; i++) g.spawnQueue.push(pickType(g));
    g.spawnTimer = 0.5;
    emit(g, 'wave', { n, boss: boss ? 1 : 0 });
  }

  function updateWaves(g, inputs, dt) {
    if (g.phase === 'over') return;
    if (g.phase === 'countdown') {
      g.phaseTimer -= dt;
      if (g.phaseTimer <= 0) startWave(g, 1);
      return;
    }
    if (g.phase === 'wave') {
      g.spawnTimer -= dt;
      if (g.spawnQueue.length && g.spawnTimer <= 0) {
        spawnEnemy(g, g.spawnQueue.shift());
        g.spawnTimer = Math.max(0.18, 0.75 - g.wave * 0.035) * (0.6 + g.rng() * 0.8) / Math.sqrt(Math.max(1, g.players.length));
      }
      if (!g.spawnQueue.length && !g.enemies.length) {
        g.phase = 'intermission';
        g.phaseTimer = 12;
        g.bullets = g.bullets.filter((b) => b.own != null);
        for (const p of g.players) {
          if (p.downed) { p.downed = false; p.hp = Math.round(p.maxHp * 0.3); p.inv = 1; emit(g, 'revive', { x: r1(p.x), y: r1(p.y), s: p.slot }); }
          p.offers = shuffle(g, UPGRADE_KEYS.slice()).slice(0, 3);
        }
        emit(g, 'cleared', { n: g.wave });
      }
      return;
    }
    if (g.phase === 'intermission') {
      g.phaseTimer -= dt;
      const waiting = g.players.filter((p) => p.offers);
      if (!waiting.length || g.phaseTimer <= 0) {
        for (const p of waiting) applyUpgrade(g, p, p.offers[0]);
        startWave(g, g.wave + 1);
      }
    }
  }

  function shuffle(g, a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(g.rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // ----------------------------------------------------------------- versus
  function updateVersus(g, dt) {
    if (g.phase === 'countdown') {
      g.phaseTimer -= dt;
      if (g.phaseTimer <= 0) { g.phase = 'fight'; emit(g, 'fight', {}); }
      for (const p of g.players) { p.fireCd = Math.max(p.fireCd, 0.1); }
      return;
    }
    g.timeLeft -= dt;
    g.pickupTimer -= dt;
    if (g.pickupTimer <= 0) {
      const c = { x: 200 + g.rng() * (W - 400), y: 160 + g.rng() * (H - 320), r: 14 };
      collideWorld(g, c);
      g.pickups.push({ id: g.nextId++, type: 'heal', x: c.x, y: c.y, life: 14 });
      g.pickupTimer = 10 + g.rng() * 6;
    }
    if (g.timeLeft <= 0) {
      const top = g.players.slice().sort((a, b) => b.kills - a.kills);
      endGame(g, top.length && (top.length === 1 || top[0].kills > top[1].kills) ? top[0].slot : null);
    }
  }

  function updatePickups(g, dt) {
    g.pickups = g.pickups.filter((k) => {
      k.life -= dt;
      if (k.life <= 0) return false;
      for (const p of g.players) {
        if (!p.alive || p.downed || p.hp >= p.maxHp) continue;
        if (dist2(p, k) < (p.r + 16) ** 2) {
          p.hp = Math.min(p.maxHp, p.hp + 30);
          emit(g, 'pickup', { x: r1(k.x), y: r1(k.y), s: p.slot });
          return false;
        }
      }
      return true;
    });
  }

  // --------------------------------------------------------------- snapshot
  function snapshot(g) {
    return {
      t: r1(g.t),
      mode: g.mode,
      phase: g.phase,
      timer: r1(Math.max(0, g.phaseTimer)),
      wave: g.wave,
      score: g.score,
      left: g.enemies.length + g.spawnQueue.length,
      winner: g.winner,
      timeLeft: Math.ceil(Math.max(0, g.timeLeft)),
      killTarget: VERSUS_KILLS,
      rocks: g.rocks,
      players: g.players.map((p) => ({
        id: p.id, slot: p.slot, name: p.name,
        x: r1(p.x), y: r1(p.y), dx: Math.round(p.dirX * 100) / 100, dy: Math.round(p.dirY * 100) / 100,
        hp: Math.ceil(p.hp), maxHp: p.maxHp, alive: p.alive, downed: p.downed,
        revive: Math.round((p.reviveT / 2.2) * 100) / 100, respawn: r1(Math.max(0, p.respawn)),
        inv: p.inv > 0, dash: p.dashT > 0, dashReady: Math.round(clamp(1 - p.dashCd / p.stats.dashCd, 0, 1) * 100) / 100,
        kills: p.kills, deaths: p.deaths, score: p.score, offers: p.offers, upgrades: p.upgrades,
      })),
      enemies: g.enemies.map((e) => [e.id, ENEMY_TYPES.indexOf(e.type), Math.round(e.x), Math.round(e.y), Math.round((e.hp / e.maxHp) * 100), e.flash > 0 ? 1 : 0, e.state]),
      bullets: g.bullets.map((b) => [b.id, Math.round(b.x), Math.round(b.y), b.slot, Math.round(b.vx / 10), Math.round(b.vy / 10)]),
      pickups: g.pickups.map((k) => [k.id, Math.round(k.x), Math.round(k.y), k.life < 3 ? 1 : 0]),
    };
  }

  function drainEvents(g) {
    const ev = g.events;
    g.events = [];
    return ev;
  }

  // -------------------------------------------------------------------- bots
  // Simple AI used for the attract-mode demo behind the menus.
  function botInput(g, p) {
    const inp = { mx: 0, my: 0, ax: 0, ay: 0, fire: false, dash: false, pick: p.offers ? 0 : -1 };
    if (!p.alive || p.downed) return inp;
    const downed = g.players.find((o) => o.downed);
    const e = nearestTarget(g, p, 2000);
    let mx = (W / 2 - p.x) * 0.002, my = (H / 2 - p.y) * 0.002;
    if (downed && dist2(downed, p) > 40 * 40) {
      const [dx, dy] = norm(downed.x - p.x, downed.y - p.y);
      mx += dx; my += dy;
    } else if (e) {
      const [dx, dy, d] = norm(e.x - p.x, e.y - p.y);
      const side = p.slot % 2 ? 1 : -1;
      if (d < 230) { mx -= dx; my -= dy; } else if (d > 420) { mx += dx; my += dy; }
      mx += -dy * side * 0.7; my += dx * side * 0.7;
      inp.fire = d < 650;
      inp.dash = d < 90 && g.rng() < 0.1;
    }
    for (const r of g.rocks) {
      const [dx, dy, d] = norm(p.x - r.x, p.y - r.y);
      if (d < r.r + 60) { mx += dx * 1.5; my += dy * 1.5; }
    }
    inp.mx = clamp(mx, -1, 1); inp.my = clamp(my, -1, 1);
    return inp;
  }

  const api = {
    W, H, WALL, COLORS, ENEMIES, ENEMY_TYPES, UPGRADES, VERSUS_KILLS,
    create, step, snapshot, drainEvents, addPlayer, removePlayer, botInput,
  };
  root.EmberSim = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
