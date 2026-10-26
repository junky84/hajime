/*
 * Judo-Anzeigetafel – Wettkampflogik ohne DOM.
 * Wird vom Bedienfenster benutzt und ist in Node testbar (test/core.test.js).
 * Alle Zeiten sind Millisekunden auf Basis von Date.now(), damit Bedien- und
 * Anzeigefenster auf demselben Rechner exakt dieselbe Uhr sehen.
 */
(function (root) {
  'use strict';

  const SIDES = ['white', 'blue'];
  const other = (s) => (s === 'white' ? 'blue' : 'white');
  const SIDE_LABEL = { white: 'Weiß', blue: 'Blau' };
  const SCORE_LABEL = { ippon: 'IPPON', wazaari: 'WAZA-ARI', yuko: 'YUKO', shido: 'SHIDO', hsk: 'HANSOKU-MAKE' };

  const BASE_RULES = {
    duration: 240, // Kampfzeit in Sekunden
    golden: true, // Golden Score bei Gleichstand
    goldenLimit: 0, // max. Golden-Score-Dauer in Sekunden, 0 = unbegrenzt
    ipponEnds: true, // Ippon beendet den Kampf
    awasete: true, // 2x Waza-ari = Ippon (nur wenn Ippon beendet)
    yuko: true, // Yuko-Wertung aktiv (IJF ab 2025)
    shidoLimit: 3, // so viele Shido = Hansoku-make, 0 = aus
    shidoDecides: false, // weniger Shido gewinnt bei Gleichstand
    autoOsae: true, // Haltegriff automatisch werten
    osaeYuko: 5,
    osaeWazaari: 10,
    osaeIppon: 20,
  };

  // Vorschläge – in den Einstellungen frei änderbar.
  const DEFAULT_PROFILES = [
    { ...BASE_RULES, id: 'p-u11', name: 'U11', aliases: 'U10, U11', duration: 120, goldenLimit: 60, ipponEnds: false },
    { ...BASE_RULES, id: 'p-u13', name: 'U13', aliases: 'U12, U13', duration: 180, goldenLimit: 60, ipponEnds: false },
    { ...BASE_RULES, id: 'p-u15', name: 'U15', aliases: 'U14, U15', duration: 180 },
    { ...BASE_RULES, id: 'p-u18', name: 'U18', aliases: 'U16, U17, U18', duration: 240 },
    { ...BASE_RULES, id: 'p-adult', name: 'Erwachsene', aliases: 'U21, Männer, Frauen, Senioren, Aktive', duration: 240 },
    { ...BASE_RULES, id: 'p-masters', name: 'Masters', aliases: 'Ü30, Veteranen, Masters', duration: 180 },
  ];

  function uid() {
    return Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
  }
  const clone = (o) => JSON.parse(JSON.stringify(o));

  function newCompetitor(src) {
    return { name: (src && src.name) || '', club: (src && src.club) || '', ippon: 0, wazaari: 0, yuko: 0, shido: 0, hsk: false };
  }

  function newFight(rules, entry) {
    entry = entry || {};
    const ms = rules.duration * 1000;
    return {
      id: uid(),
      queueId: entry.id || null,
      no: entry.no || '',
      category: entry.category || '',
      ageClass: entry.ageClass || '',
      white: newCompetitor(entry.white),
      blue: newCompetitor(entry.blue),
      regularMs: ms,
      clock: { mode: 'regular', baseMs: ms, startedAt: null, zeroSignalled: false },
      osae: { side: null, baseMs: 0, startedAt: null, lastMs: 0, lastSide: null, lastAt: 0 },
      status: 'ready', // ready | running | paused | timeup | finished
      started: false,
      winner: null, // white | blue | draw
      reason: '',
      manual: false,
      finishedAt: 0,
      flash: null,
      sound: null,
      seq: 0,
    };
  }

  function createState() {
    const profiles = clone(DEFAULT_PROFILES);
    const active = profiles.find((p) => p.id === 'p-adult');
    return {
      version: 1,
      settings: {
        tournament: '',
        mat: 'Matte 1',
        logo: null,
        showClub: true,
        showNext: true,
        flashScores: true,
        soundOn: true,
        soundTarget: 'control', // control | board | both
        swap: false, // Blau oben anzeigen
      },
      profiles,
      activeProfileId: active.id,
      screen: 'board', // board | idle
      fight: newFight(active),
      queue: [],
      participants: [],
      log: [],
      savedAt: 0,
    };
  }

  function getRules(state) {
    return state.profiles.find((p) => p.id === state.activeProfileId) || state.profiles[0] || BASE_RULES;
  }

  /* ---------- Uhren ---------- */

  function clockMs(c, now) {
    const since = c.startedAt != null ? now - c.startedAt : 0;
    return c.mode === 'golden' ? c.baseMs + since : c.baseMs - since;
  }
  const clockRunning = (c) => c.startedAt != null;
  function pauseClock(c, now) {
    if (c.startedAt == null) return;
    let v = clockMs(c, now);
    if (c.mode === 'regular') v = Math.max(0, v);
    c.baseMs = v;
    c.startedAt = null;
  }
  function startClock(c, now) {
    if (c.startedAt == null) c.startedAt = now;
  }
  function osaeMs(o, now) {
    if (!o.side) return o.lastMs;
    return o.baseMs + (o.startedAt != null ? now - o.startedAt : 0);
  }
  function fightTimeMs(f, now) {
    const v = clockMs(f.clock, now);
    return f.clock.mode === 'regular' ? f.regularMs - Math.max(0, v) : f.regularMs + v;
  }
  function goldenLimitReached(f, r, now) {
    return f.clock.mode === 'golden' && r.goldenLimit > 0 && clockMs(f.clock, now) >= r.goldenLimit * 1000;
  }

  /* ---------- Ereignisse für Anzeige ---------- */

  function setSound(f, kind, now) {
    f.seq++;
    f.sound = { id: f.seq, kind, at: now };
  }
  function setFlash(f, side, text, now) {
    f.seq++;
    f.flash = { id: f.seq, side, text, at: now };
  }

  /* ---------- Bewertung ---------- */

  const isHansoku = (c, r) => !!c.hsk || (r.shidoLimit > 0 && c.shido >= r.shidoLimit);

  function compare(f, r) {
    const w = f.white;
    const b = f.blue;
    const keys = [['ippon', 'Ippon'], ['wazaari', 'Waza-ari'], ['yuko', 'Yuko']];
    for (const [k, label] of keys) {
      if (w[k] !== b[k]) return { side: w[k] > b[k] ? 'white' : 'blue', reason: label };
    }
    if (r.shidoDecides && w.shido !== b.shido) return { side: w.shido < b.shido ? 'white' : 'blue', reason: 'weniger Shido' };
    return null;
  }

  function finish(f, side, reason, now, manual) {
    pauseClock(f.clock, now);
    if (f.osae.side) {
      f.osae.lastMs = osaeMs(f.osae, now);
      f.osae.lastSide = f.osae.side;
      f.osae.lastAt = now;
      f.osae.side = null;
      f.osae.startedAt = null;
    }
    f.status = 'finished';
    f.winner = side;
    f.reason = reason;
    f.manual = !!manual;
    f.finishedAt = now;
    f.clock.zeroSignalled = true;
    setSound(f, 'gong', now);
  }

  function timeUp(state, now) {
    const f = state.fight;
    const r = getRules(state);
    pauseClock(f.clock, now);
    const c = compare(f, r);
    if (c) return finish(f, c.side, c.reason, now);
    f.status = 'timeup';
    if (!f.clock.zeroSignalled) {
      f.clock.zeroSignalled = true;
      setSound(f, 'gong', now);
    }
  }

  function checkEnd(state, now) {
    const f = state.fight;
    const r = getRules(state);
    if (f.status === 'finished') return;
    for (const s of SIDES) if (isHansoku(f[s], r)) return finish(f, other(s), 'Hansoku-make', now);
    if (r.ipponEnds) {
      for (const s of SIDES) if (f[s].ippon > 0) return finish(f, s, 'Ippon', now);
      if (r.awasete) for (const s of SIDES) if (f[s].wazaari >= 2) return finish(f, s, 'Waza-ari-awasete-ippon', now);
    }
    if (f.clock.mode === 'golden') {
      const c = compare(f, r);
      if (c) return finish(f, c.side, 'Golden Score – ' + c.reason, now);
      if (goldenLimitReached(f, r, now) && !f.osae.side) {
        pauseClock(f.clock, now);
        f.status = 'timeup';
      }
      return;
    }
    if (f.started && clockMs(f.clock, now) <= 0 && !f.osae.side) timeUp(state, now);
  }

  // Nach Korrekturen: automatisch ermittelten Sieger neu berechnen.
  function reevaluate(state, now) {
    const f = state.fight;
    if (f.status === 'finished') {
      if (f.manual) return;
      f.status = f.started ? 'paused' : 'ready';
      f.winner = null;
      f.reason = '';
      f.finishedAt = 0;
    }
    if (f.status === 'timeup') f.status = 'paused';
    checkEnd(state, now);
  }

  /* ---------- Aktionen ---------- */

  function hajimeMate(state, now) {
    const f = state.fight;
    const r = getRules(state);
    if (f.status === 'finished') return false;
    if (f.osae.side) {
      toketa(state, now);
      if (f.status === 'running') {
        pauseClock(f.clock, now);
        f.status = 'paused';
      }
      return true;
    }
    if (clockRunning(f.clock)) {
      pauseClock(f.clock, now);
      f.status = 'paused';
      return true;
    }
    if (f.status === 'timeup') {
      if (f.clock.mode === 'regular' && r.golden) {
        f.clock = { mode: 'golden', baseMs: 0, startedAt: now, zeroSignalled: true };
        f.status = 'running';
        return true;
      }
      return false; // Kampfrichterentscheid nötig
    }
    if (f.clock.mode === 'regular' && f.clock.baseMs <= 0) return false;
    if (goldenLimitReached(f, r, now)) return false;
    startClock(f.clock, now);
    f.status = 'running';
    f.started = true;
    return true;
  }

  function osaeLimitSec(state) {
    const f = state.fight;
    const r = getRules(state);
    let lim = r.osaeIppon;
    if (r.autoOsae && f.osae.side) {
      if (f.clock.mode === 'golden') lim = r.yuko ? r.osaeYuko : r.osaeWazaari;
      else if (r.ipponEnds && r.awasete && f[f.osae.side].wazaari >= 1) lim = Math.min(lim, r.osaeWazaari);
    }
    return lim;
  }

  function startOsae(state, side, now) {
    const f = state.fight;
    if (f.status === 'finished' || f.status === 'timeup') return false;
    if (f.osae.side === side) return toketa(state, now);
    if (f.osae.side) {
      toketa(state, now);
      if (f.status === 'finished') return true;
    }
    if (f.clock.mode === 'regular' && clockMs(f.clock, now) <= 0) return false;
    f.osae.side = side;
    f.osae.baseMs = 0;
    f.osae.startedAt = now;
    startClock(f.clock, now);
    f.status = 'running';
    f.started = true;
    return true;
  }

  function toketa(state, now) {
    const f = state.fight;
    const r = getRules(state);
    const o = f.osae;
    if (!o.side) return false;
    const ms = osaeMs(o, now);
    const side = o.side;
    o.lastMs = ms;
    o.lastSide = side;
    o.lastAt = now;
    o.side = null;
    o.startedAt = null;
    o.baseMs = 0;
    if (r.autoOsae) {
      const sec = Math.floor(ms / 1000 + 1e-6);
      let k = null;
      if (sec >= r.osaeIppon) k = 'ippon';
      else if (sec >= r.osaeWazaari) k = 'wazaari';
      else if (r.yuko && sec >= r.osaeYuko) k = 'yuko';
      if (k) {
        f[side][k]++;
        setFlash(f, side, SCORE_LABEL[k], now);
      }
    }
    checkEnd(state, now);
    return true;
  }

  function addScore(state, side, kind, delta, now) {
    const f = state.fight;
    const r = getRules(state);
    const c = f[side];
    if (kind === 'hsk') {
      if (c.hsk === delta > 0) return false;
      c.hsk = delta > 0;
    } else {
      const v = Math.max(0, c[kind] + delta);
      if (v === c[kind]) return false;
      c[kind] = v;
    }
    if (delta > 0) {
      const text = kind === 'shido' && isHansoku(c, r) ? SCORE_LABEL.hsk : SCORE_LABEL[kind];
      setFlash(f, side, text, now);
    }
    reevaluate(state, now);
    return true;
  }

  // Manuelle Entscheidung (Hantei, Kiken-gachi, Fusen-gachi …). side = null hebt sie auf.
  function setWinner(state, side, reason, now) {
    const f = state.fight;
    if (side == null) {
      if (!f.manual) return false;
      f.manual = false;
      reevaluate(state, now);
      return true;
    }
    finish(f, side, reason || 'Entscheidung', now, true);
    return true;
  }

  function adjustClock(state, deltaMs, now) {
    const f = state.fight;
    if (f.status === 'finished') return false;
    const c = f.clock;
    const cur = clockMs(c, now);
    let target = cur + deltaMs;
    if (target < 0) target = 0;
    return setClock(state, target, now);
  }

  function setClock(state, ms, now) {
    const f = state.fight;
    if (f.status === 'finished') return false;
    const c = f.clock;
    const running = clockRunning(c);
    c.baseMs = Math.max(0, Math.round(ms));
    c.startedAt = running ? now : null;
    if (c.mode === 'regular' && !f.started) f.regularMs = Math.max(f.regularMs, c.baseMs);
    if (c.mode === 'regular' && c.baseMs > 0) c.zeroSignalled = false;
    if (f.status === 'timeup' && (c.mode === 'regular' ? c.baseMs > 0 : !goldenLimitReached(f, getRules(state), now))) {
      f.status = 'paused';
    }
    return true;
  }

  function applyProfile(state, profileId, now) {
    if (!state.profiles.some((p) => p.id === profileId)) return false;
    state.activeProfileId = profileId;
    const f = state.fight;
    const r = getRules(state);
    if (!f.started) {
      f.regularMs = r.duration * 1000;
      f.clock = { mode: 'regular', baseMs: f.regularMs, startedAt: null, zeroSignalled: false };
    }
    reevaluate(state, now);
    return true;
  }

  function norm(s) {
    return String(s || '')
      .toLowerCase()
      .replace(/ß/g, 'ss')
      .replace(/[^a-z0-9äöü]+/g, ' ')
      .trim();
  }

  function findProfileFor(state, ageClass) {
    const a = norm(ageClass);
    if (!a) return null;
    for (const p of state.profiles) {
      const names = [p.name].concat(String(p.aliases || '').split(',')).map(norm).filter(Boolean);
      if (names.some((n) => n === a)) return p;
    }
    for (const p of state.profiles) {
      const names = [p.name].concat(String(p.aliases || '').split(',')).map(norm).filter(Boolean);
      if (names.some((n) => a.split(' ').includes(n))) return p;
    }
    return null;
  }

  // Neuen Kampf laden (optional aus Kampfliste). Regelprofil passend zur Altersklasse.
  function loadFight(state, entry, now) {
    const prof = entry && findProfileFor(state, entry.ageClass);
    if (prof) state.activeProfileId = prof.id;
    state.fight = newFight(getRules(state), entry);
    return true;
  }

  // Beim Wiederherstellen nach Neustart: lange gestoppte Uhren anhalten.
  function restore(saved, now) {
    const base = createState();
    const s = Object.assign(base, saved || {});
    s.settings = Object.assign(createState().settings, (saved && saved.settings) || {});
    if (!Array.isArray(s.profiles) || !s.profiles.length) s.profiles = clone(DEFAULT_PROFILES);
    s.profiles = s.profiles.map((p) => Object.assign({}, BASE_RULES, p));
    if (!s.profiles.some((p) => p.id === s.activeProfileId)) s.activeProfileId = s.profiles[0].id;
    if (!s.fight || !s.fight.clock) s.fight = newFight(getRules(s));
    const f = s.fight;
    const stale = !s.savedAt || now - s.savedAt > 5000;
    if (stale) {
      const at = s.savedAt || now;
      if (f.osae.side) {
        f.osae.lastMs = osaeMs(f.osae, at);
        f.osae.lastSide = f.osae.side;
        f.osae.side = null;
        f.osae.startedAt = null;
      }
      if (clockRunning(f.clock)) {
        pauseClock(f.clock, at);
        if (f.status === 'running') f.status = 'paused';
      }
    }
    f.flash = null;
    f.sound = null;
    return s;
  }

  function tick(state, now) {
    const f = state.fight;
    const r = getRules(state);
    let changed = false;
    if (f.status === 'finished') return false;
    if (f.osae.side) {
      const limMs = osaeLimitSec(state) * 1000;
      if (osaeMs(f.osae, now) >= limMs) {
        if (r.autoOsae) {
          toketa(state, now);
        } else {
          // ohne Automatik: Haltegriff-Uhr stoppt nur, Wertung gibt die Bedienung
          f.osae.lastMs = limMs;
          f.osae.lastSide = f.osae.side;
          f.osae.lastAt = now;
          f.osae.side = null;
          f.osae.startedAt = null;
          setSound(f, 'beep', now);
          checkEnd(state, now);
        }
        changed = true;
      }
    }
    if (f.status === 'finished') return changed;
    const c = f.clock;
    if (clockRunning(c)) {
      if (c.mode === 'regular' && clockMs(c, now) <= 0) {
        pauseClock(c, now);
        if (f.osae.side) {
          if (!c.zeroSignalled) {
            c.zeroSignalled = true;
            setSound(f, 'gong', now);
          }
        } else {
          timeUp(state, now);
        }
        changed = true;
      } else if (goldenLimitReached(f, r, now)) {
        c.baseMs = r.goldenLimit * 1000;
        c.startedAt = null;
        if (!f.osae.side) f.status = 'timeup';
        setSound(f, 'gong', now);
        changed = true;
      }
    }
    return changed;
  }

  /* ---------- Hilfen ---------- */

  function formatClock(ms, mode) {
    let sec = mode === 'golden' ? Math.floor(ms / 1000) : Math.ceil(Math.max(0, ms) / 1000 - 1e-6);
    if (sec < 0) sec = 0;
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return m + ':' + String(s).padStart(2, '0');
  }

  function scoreText(c, r) {
    const parts = [];
    if (c.ippon) parts.push(c.ippon + ' I');
    parts.push(c.wazaari + ' W');
    if (r.yuko || c.yuko) parts.push(c.yuko + ' Y');
    if (c.shido) parts.push(c.shido + ' S');
    if (isHansoku(c, r)) parts.push('HSK');
    return parts.join(' · ');
  }

  function displayName(c, side) {
    return c.name ? c.name : SIDE_LABEL[side];
  }

  // Jeder-gegen-jeden (Kreis-Methode), möglichst ohne direkt aufeinanderfolgende Kämpfe.
  function roundRobin(players) {
    const p = players.slice();
    if (p.length < 2) return [];
    if (p.length % 2) p.push(null);
    const n = p.length;
    const out = [];
    for (let round = 0; round < n - 1; round++) {
      let pairs = [];
      for (let i = 0; i < n / 2; i++) {
        const a = p[i];
        const b = p[n - 1 - i];
        if (a && b) pairs.push(round % 2 ? [b, a] : [a, b]);
      }
      const last = out[out.length - 1];
      if (last && pairs.length > 1) {
        let guard = pairs.length;
        while (guard-- > 0 && (pairs[0].includes(last[0]) || pairs[0].includes(last[1]))) pairs.push(pairs.shift());
      }
      out.push(...pairs);
      p.splice(1, 0, p.pop());
    }
    return out;
  }

  const api = {
    SIDES,
    SIDE_LABEL,
    SCORE_LABEL,
    BASE_RULES,
    DEFAULT_PROFILES,
    uid,
    clone,
    norm,
    createState,
    newFight,
    getRules,
    clockMs,
    clockRunning,
    osaeMs,
    osaeLimitSec,
    fightTimeMs,
    isHansoku,
    compare,
    reevaluate,
    hajimeMate,
    startOsae,
    toketa,
    addScore,
    setWinner,
    adjustClock,
    setClock,
    applyProfile,
    findProfileFor,
    loadFight,
    restore,
    tick,
    formatClock,
    scoreText,
    displayName,
    roundRobin,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.JudoCore = api;
})(typeof self !== 'undefined' ? self : this);
