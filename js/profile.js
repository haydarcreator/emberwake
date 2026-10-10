/**
 * Player profile: display name and lifetime stats, saved in this browser.
 * Stats are kept per signed-in account (or under "guest").
 */
(function () {
  const read = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
  const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } };

  const uid = () => (window.SiteAuth && SiteAuth.user ? SiteAuth.user.uid : 'guest');

  const Profile = {
    name() {
      if (window.SiteAuth && SiteAuth.user) return SiteAuth.user.name.split(/\s+/)[0].slice(0, 16);
      let n = read('ew.guestName', null);
      if (!n) { n = 'Guest' + Math.floor(100 + Math.random() * 900); write('ew.guestName', n); }
      return n;
    },
    setName(n) {
      n = String(n || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 16);
      if (n) write('ew.guestName', n);
    },
    stats(id = uid()) {
      return Object.assign({ games: 0, bestWave: 0, bestScore: 0, kills: 0, versusWins: 0, versusGames: 0, playSeconds: 0, last: null }, read('ew.stats.' + id, {}));
    },
    record(result) {
      const s = this.stats();
      s.games++;
      s.kills += result.kills || 0;
      s.playSeconds += Math.round(result.seconds || 0);
      if (result.mode === 'coop') {
        s.bestWave = Math.max(s.bestWave, result.wave || 0);
        s.bestScore = Math.max(s.bestScore, result.score || 0);
      } else {
        s.versusGames++;
        if (result.won) s.versusWins++;
      }
      s.last = new Date().toISOString();
      write('ew.stats.' + uid(), s);
      return s;
    },
    clear(id = uid()) { try { localStorage.removeItem('ew.stats.' + id); } catch { /* ignore */ } },
  };

  window.EmberProfile = Profile;
})();
