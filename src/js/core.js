/*
 * Hajime – Wettkampflogik ohne DOM.
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
    restTime: 0, // Mindestpause zwischen zwei Kämpfen eines Kämpfers in Sekunden, 0 = aus
  };

  // Vorschläge – in den Einstellungen frei änderbar.
  const DEFAULT_PROFILES = [
    { ...BASE_RULES, id: 'p-u11', name: 'U11', aliases: 'U10, U11', duration: 120, goldenLimit: 60, ipponEnds: false, restTime: 300 },
    { ...BASE_RULES, id: 'p-u13', name: 'U13', aliases: 'U12, U13', duration: 180, goldenLimit: 60, ipponEnds: false, restTime: 300 },
    { ...BASE_RULES, id: 'p-u15', name: 'U15', aliases: 'U14, U15', duration: 180, restTime: 600 },
    { ...BASE_RULES, id: 'p-u18', name: 'U18', aliases: 'U16, U17, U18', duration: 240, restTime: 600 },
    { ...BASE_RULES, id: 'p-adult', name: 'Erwachsene', aliases: 'U21, Männer, Frauen, Senioren, Aktive', duration: 240, restTime: 600 },
    { ...BASE_RULES, id: 'p-masters', name: 'Masters', aliases: 'Ü30, Veteranen, Masters', duration: 180, restTime: 600 },
  ];

  // Wertungspunkte je Sieg für Gruppentabellen (in den Einstellungen änderbar)
  const DEFAULT_WIN_POINTS = { ippon: 10, wazaari: 7, yuko: 5, decision: 1 };

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
      events: [], // Ereignisprotokoll: { at, clock, text }
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
        nextSize: 'large', // small | large | xlarge
        flashScores: true,
        soundOn: true,
        soundTarget: 'control', // control | board | both
        swap: false, // Blau oben anzeigen
        // Auswertung
        winPoints: { ...DEFAULT_WIN_POINTS },
        rankOrder: 'points', // points: Siege → Wertungspunkte → direkter Vergleich | direct: Siege → direkter Vergleich → Wertungspunkte
        // Urkunden
        tournamentDate: '',
        tournamentPlace: '',
        certBg: null,
        certSign1: 'Turnierleitung',
        certSign2: 'Kampfrichterobmann',
        certPlaces: '3', // '3' = Plätze 1–3, 'all' = alle Platzierten
        awardsDoneOnly: true, // Siegerliste / alle Urkunden nur mit fertigen Gruppen
      },
      profiles,
      activeProfileId: active.id,
      screen: 'board', // board | idle | table
      boardGroup: null, // Gruppe für die Gruppentabelle auf der Anzeige
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

  /* ---------- Ereignisprotokoll ---------- */

  const KIND_LABEL = { ippon: 'Ippon', wazaari: 'Waza-ari', yuko: 'Yuko', shido: 'Shido', hsk: 'Hansoku-make' };

  function clockLabel(f, now) {
    const c = f.clock;
    return (c.mode === 'golden' ? 'GS ' : '') + formatClock(clockMs(c, now), c.mode);
  }

  // kind: Art des Eintrags; 'clock' fasst schnell aufeinanderfolgende Uhr-Korrekturen zusammen
  function logEvent(f, now, text, kind) {
    if (!Array.isArray(f.events)) f.events = [];
    const ev = { at: now, clock: clockLabel(f, now), text };
    if (kind) ev.kind = kind;
    const last = f.events[f.events.length - 1];
    if (kind === 'clock' && last && last.kind === 'clock' && now - last.at < 4000) f.events[f.events.length - 1] = ev;
    else f.events.push(ev);
    if (f.events.length > 400) f.events.splice(0, f.events.length - 400);
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
    logEvent(f, now, side === 'draw' ? 'Kampfende · Unentschieden' : `Kampfende · Sieger ${SIDE_LABEL[side]} (${reason})`);
  }

  function timeUp(state, now) {
    const f = state.fight;
    const r = getRules(state);
    pauseClock(f.clock, now);
    const c = compare(f, r);
    if (c) return finish(f, c.side, c.reason, now);
    f.status = 'timeup';
    logEvent(f, now, 'Zeit abgelaufen · Gleichstand');
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
        logEvent(f, now, 'Mate');
      }
      return true;
    }
    if (clockRunning(f.clock)) {
      pauseClock(f.clock, now);
      f.status = 'paused';
      logEvent(f, now, 'Mate');
      return true;
    }
    if (f.status === 'timeup') {
      if (f.clock.mode === 'regular' && r.golden) {
        f.clock = { mode: 'golden', baseMs: 0, startedAt: now, zeroSignalled: true };
        f.status = 'running';
        logEvent(f, now, 'Golden Score · Hajime');
        return true;
      }
      return false; // Kampfrichterentscheid nötig
    }
    if (f.clock.mode === 'regular' && f.clock.baseMs <= 0) return false;
    if (goldenLimitReached(f, r, now)) return false;
    logEvent(f, now, 'Hajime');
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
    logEvent(f, now, 'Osaekomi ' + SIDE_LABEL[side]);
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
    const sec = Math.floor(ms / 1000 + 1e-6);
    let k = null;
    if (r.autoOsae) {
      if (sec >= r.osaeIppon) k = 'ippon';
      else if (sec >= r.osaeWazaari) k = 'wazaari';
      else if (r.yuko && sec >= r.osaeYuko) k = 'yuko';
      if (k) {
        f[side][k]++;
        setFlash(f, side, SCORE_LABEL[k], now);
      }
    }
    logEvent(f, now, k ? `Osaekomi ${sec} s → ${KIND_LABEL[k]} ${SIDE_LABEL[side]} (automatisch)` : `Toketa ${SIDE_LABEL[side]} nach ${sec} s`);
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
      logEvent(f, now, `${KIND_LABEL[kind]} ${SIDE_LABEL[side]}` + (kind === 'shido' && isHansoku(c, r) ? ' → Hansoku-make' : ''));
    } else {
      logEvent(f, now, `Korrektur: ${KIND_LABEL[kind]} ${SIDE_LABEL[side]} zurückgenommen`);
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
      logEvent(f, now, 'Entscheidung aufgehoben');
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
    logEvent(f, now, 'Uhr gestellt auf ' + clockLabel(f, now), 'clock');
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
    s.settings.winPoints = Object.assign({}, DEFAULT_WIN_POINTS, s.settings.winPoints);
    if (!Array.isArray(s.profiles) || !s.profiles.length) s.profiles = clone(DEFAULT_PROFILES);
    // Profile aus älteren Versionen: fehlende Felder ergänzen, Ruhezeit der Standardprofile übernehmen
    s.profiles = s.profiles.map((p) => {
      const def = DEFAULT_PROFILES.find((d) => d.id === p.id);
      return Object.assign({}, BASE_RULES, def && p.restTime == null ? { restTime: def.restTime } : {}, p);
    });
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
    if (!Array.isArray(f.events)) f.events = [];
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
          checkEnd(state, now);
        }
        // Haltegriff voll ausgehalten, Kampf geht weiter (z. B. Jugend): automatisch Mate + Gong
        if (f.status !== 'finished' && f.status !== 'timeup') {
          pauseClock(f.clock, now);
          f.status = 'paused';
          setSound(f, 'gong', now);
          logEvent(f, now, 'Mate (Haltegriff ausgehalten)');
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
        logEvent(f, now, 'Golden Score: Höchstdauer erreicht');
        setSound(f, 'gong', now);
        changed = true;
      }
    }
    return changed;
  }

  /* ---------- Auswertung: Gruppentabellen ---------- */

  // Wie wurde der Kampf gewonnen? ippon | wazaari | yuko | decision (Hantei, Shido …)
  function winKind(winner, reason, scores) {
    if (winner !== 'white' && winner !== 'blue') return null;
    const r = String(reason || '');
    if (/hantei/i.test(r)) return 'decision';
    if (/ippon|hansoku|kiken|fusen|disqual|verletzung/i.test(r)) return 'ippon';
    if (scores && scores.white && scores.blue) {
      const w = scores[winner];
      const l = scores[other(winner)];
      for (const k of ['ippon', 'wazaari', 'yuko']) if ((w[k] || 0) > (l[k] || 0)) return k;
      return 'decision';
    }
    if (/waza-ari/i.test(r)) return 'wazaari';
    if (/yuko/i.test(r)) return 'yuko';
    return 'decision';
  }

  const groupLabel = (e) => [e.ageClass, e.category].map((x) => String(x || '').trim()).filter(Boolean).join(' ') || 'Ohne Klasse';
  const groupKey = (e) => norm(e.ageClass) + '|' + norm(e.category);

  // Kampfliste nach Alters-/Gewichtsklasse gruppieren (Reihenfolge wie in der Kampfliste)
  function poolGroups(queue) {
    const m = new Map();
    (queue || []).forEach((e) => {
      const key = groupKey(e);
      if (!m.has(key)) m.set(key, { key, ageClass: e.ageClass || '', category: e.category || '', label: groupLabel(e), entries: [] });
      m.get(key).entries.push(e);
    });
    return Array.from(m.values());
  }

  /*
   * Tabelle einer „Jeder gegen jeden“-Gruppe.
   * Reihenfolge: Siege → Wertungspunkte → direkter Vergleich (rankOrder 'points')
   *          oder Siege → direkter Vergleich → Wertungspunkte (rankOrder 'direct').
   * Danach entscheiden Stichkämpfe (Einträge mit tiebreak: true, zählen nicht als Siege).
   * Was dann noch gleich ist, bekommt denselben Platz und tie: true.
   */
  function standings(group, opts) {
    opts = opts || {};
    const pts = Object.assign({}, DEFAULT_WIN_POINTS, opts.winPoints);
    const players = new Map();
    const person = (p) => {
      const id = norm(p && p.name);
      if (!id) return null;
      if (!players.has(id)) {
        players.set(id, { id, name: String(p.name).trim(), club: p.club || '', wins: 0, losses: 0, draws: 0, fights: 0, points: 0, ippon: 0, wazaari: 0, yuko: 0, decision: 0 });
      }
      const pl = players.get(id);
      if (!pl.club && p.club) pl.club = p.club;
      return pl;
    };
    const regular = [];
    const extra = [];
    let total = 0;
    let done = 0;
    let tiebreakOpen = 0;
    group.entries.forEach((e) => {
      const a = person(e.white);
      const b = person(e.blue);
      if (!a || !b || a === b) return;
      const finished = e.status === 'done' && e.result && e.result.winner;
      if (e.tiebreak) {
        if (finished) extra.push({ a, b, winner: e.result.winner });
        else tiebreakOpen++;
        return;
      }
      total++;
      if (!finished) return;
      done++;
      const res = e.result;
      regular.push({ a, b, winner: res.winner });
      a.fights++;
      b.fights++;
      if (res.winner === 'draw') {
        a.draws++;
        b.draws++;
        return;
      }
      const win = res.winner === 'white' ? a : b;
      const lose = win === a ? b : a;
      const kind = res.kind || winKind(res.winner, res.reason, res.scores) || 'decision';
      win.wins++;
      lose.losses++;
      win[kind]++;
      win.points += Number(pts[kind]) || 0;
    });

    const winnerOf = (f) => (f.winner === 'white' ? f.a : f.winner === 'blue' ? f.b : null);
    function split(list, crit) {
      let val;
      if (crit === 'wins') val = (p) => p.wins;
      else if (crit === 'points') val = (p) => p.points;
      else {
        // direkter Vergleich / Stichkampf: Siege gegen die anderen Gleichplatzierten
        const fights = crit === 'tiebreak' ? extra : regular;
        const ids = new Set(list.map((p) => p.id));
        val = (p) => fights.filter((f) => ids.has(f.a.id) && ids.has(f.b.id) && winnerOf(f) === p).length;
      }
      const sorted = list.map((p) => ({ p, v: val(p) })).sort((x, y) => y.v - x.v);
      const parts = [];
      sorted.forEach((x, i) => {
        if (i && x.v === sorted[i - 1].v) parts[parts.length - 1].push(x.p);
        else parts.push([x.p]);
      });
      return parts;
    }
    // nach den Punkten nochmal direkter Vergleich für die verbliebenen Gleichen, zuletzt Stichkämpfe
    const crits = opts.rankOrder === 'direct' ? ['wins', 'direct', 'points', 'direct', 'tiebreak'] : ['wins', 'points', 'direct', 'tiebreak'];
    function rank(list, cs) {
      if (list.length < 2 || !cs.length) return [list];
      const parts = split(list, cs[0]);
      if (parts.length === 1) return rank(list, cs.slice(1));
      const headToHead = cs[0] === 'direct' || cs[0] === 'tiebreak';
      // beim direkten Vergleich die kleinere Restgruppe erneut nur untereinander vergleichen
      return parts.flatMap((part) => rank(part, headToHead ? cs : cs.slice(1)));
    }

    const complete = total > 0 && done === total;
    const rows = [];
    const ties = [];
    rank(Array.from(players.values()), crits).forEach((tier) => {
      const place = rows.length + 1;
      const tie = tier.length > 1 && complete;
      if (tie) ties.push(tier.map((p) => p.name).sort((x, y) => x.localeCompare(y, 'de')));
      tier
        .slice()
        .sort((x, y) => x.name.localeCompare(y.name, 'de'))
        .forEach((p) => rows.push(Object.assign({}, p, { place: done ? place : null, tie })));
    });
    return {
      key: group.key,
      label: group.label,
      ageClass: group.ageClass,
      category: group.category,
      total,
      done,
      complete,
      tiebreakOpen,
      rows,
      ties,
      winPoints: pts,
      rankOrder: opts.rankOrder === 'direct' ? 'direct' : 'points',
    };
  }

  function allStandings(state) {
    const opts = { winPoints: state.settings.winPoints, rankOrder: state.settings.rankOrder };
    return poolGroups(state.queue).map((g) => standings(g, opts));
  }

  // Platzierte für Siegerliste und Urkunden: Plätze 1–3 oder alle
  function awardRows(table, places) {
    const max = places === 'all' ? Infinity : Number(places) || 3;
    return table.rows.filter((r) => r.place != null && r.place <= max && (r.fights > 0 || table.complete));
  }

  /* ---------- Ruhezeit zwischen zwei Kämpfen ---------- */

  // Ende des letzten Kampfes eines Kämpfers laut Protokoll
  function lastFightEnd(state, name, exceptFightId) {
    const id = norm(name);
    if (!id) return null;
    let best = null;
    (state.log || []).forEach((l) => {
      if (!l.finishedAt || l.fightId === exceptFightId) return;
      SIDES.forEach((s) => {
        if (norm(l[s] && l[s].name) === id && (!best || l.finishedAt > best.at)) best = { at: l.finishedAt, no: l.no, ageClass: l.ageClass };
      });
    });
    return best;
  }

  // Wer aus diesem Kampf hat seine Mindestpause noch nicht gehabt?
  function restCheck(state, entry, now) {
    const prof = findProfileFor(state, entry && entry.ageClass) || getRules(state);
    const restMs = (Number(prof.restTime) || 0) * 1000;
    const res = { restMs, profile: prof.name, waits: [] };
    if (!restMs || !entry) return res;
    const own = entry.result && entry.result.fightId;
    SIDES.forEach((side) => {
      const p = entry[side];
      const last = lastFightEnd(state, p && p.name, own);
      if (!last) return;
      const readyAt = last.at + restMs;
      if (readyAt > now) res.waits.push({ side, name: p.name, lastNo: last.no, lastEnd: last.at, readyAt, remainingMs: readyAt - now });
    });
    return res;
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
    DEFAULT_WIN_POINTS,
    uid,
    clone,
    norm,
    createState,
    newFight,
    getRules,
    clockMs,
    clockRunning,
    clockLabel,
    logEvent,
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
    winKind,
    groupKey,
    groupLabel,
    poolGroups,
    standings,
    allStandings,
    awardRows,
    lastFightEnd,
    restCheck,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.JudoCore = api;
})(typeof self !== 'undefined' ? self : this);
