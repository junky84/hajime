/* Töne per WebAudio erzeugt – keine Audiodateien nötig. */
(function (root) {
  'use strict';
  let ctx = null;
  function ac() {
    if (!ctx) {
      const AC = root.AudioContext || root.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  }

  function tone(c, freq, start, dur, gain, type) {
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type || 'sine';
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(gain, start + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    o.connect(g).connect(c.destination);
    o.start(start);
    o.stop(start + dur + 0.05);
  }

  // Gong: mehrere unharmonische Teiltöne mit langem Ausklingen
  function gong() {
    const c = ac();
    if (!c) return;
    const t = c.currentTime + 0.02;
    const base = 196;
    [[1, 0.5, 3.2], [2.01, 0.25, 2.4], [2.76, 0.18, 2.0], [4.07, 0.1, 1.4], [5.4, 0.06, 1.0]].forEach(([m, g, d]) =>
      tone(c, base * m, t, d, g)
    );
    // zweiter Schlag
    [[1, 0.35, 2.6], [2.01, 0.18, 2.0], [2.76, 0.12, 1.6]].forEach(([m, g, d]) => tone(c, base * m, t + 0.9, d, g));
  }

  function beep() {
    const c = ac();
    if (!c) return;
    const t = c.currentTime + 0.02;
    tone(c, 880, t, 0.25, 0.3, 'square');
    tone(c, 880, t + 0.35, 0.25, 0.3, 'square');
  }

  // Browser: Ton ist gesperrt, bis jemand ins Fenster geklickt hat
  const locked = () => !ctx || ctx.state !== 'running';

  root.JudoSound = { gong, beep, unlock: ac, locked, play: (kind) => (kind === 'beep' ? beep() : gong()) };
})(typeof self !== 'undefined' ? self : this);
