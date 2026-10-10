/**
 * Live game demo behind the landing page hero: bots playing a real round.
 */
(function () {
  const canvas = document.getElementById('heroCanvas');
  if (!canvas || !window.EmberSim) return;
  const S = EmberSim;
  const renderer = new EmberRenderer(canvas, { hud: false, cover: true });
  window.addEventListener('resize', () => renderer.resize());

  let game, acc = 0, last = performance.now(), visible = true;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  function reset() {
    game = S.create({ mode: 'coop', seed: (Math.random() * 1e9) | 0, players: [{ id: 'a', name: 'Ash' }, { id: 'b', name: 'Brin' }, { id: 'c', name: 'Cinder' }] });
    for (let i = 0; i < 60 * 6; i++) tick();
  }
  function tick() {
    const inputs = {};
    for (const p of game.players) inputs[p.id] = S.botInput(game, p);
    S.step(game, inputs, 1 / 60);
    return S.drainEvents(game);
  }

  new IntersectionObserver(([e]) => { visible = e.isIntersecting; }).observe(canvas);
  document.addEventListener('visibilitychange', () => { last = performance.now(); });

  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (visible && !document.hidden) {
      const events = [];
      if (!reduce) {
        acc += dt;
        while (acc >= 1 / 60) { acc -= 1 / 60; events.push(...tick()); }
        if (game.phase === 'over') reset();
      }
      renderer.draw(S.snapshot(game), reduce ? 0 : dt);
      renderer.applyEvents(events.filter((e) => e.k !== 'wave' && e.k !== 'cleared'), null, []);
      renderer.shake = 0;
    }
    requestAnimationFrame(frame);
  }
  reset();
  requestAnimationFrame(frame);
})();
