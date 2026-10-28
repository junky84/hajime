/*
 * Matten im Netz: was eine Matte an die Zentrale meldet und wie die Zentrale Ergebnisse übernimmt.
 * Ohne DOM, in Node testbar (test/net.test.js). Die Verbindung selbst ist ein WebSocket
 * (connect, nur im Browser/Electron-Fenster).
 */
(function (root) {
  'use strict';
  const C = root.JudoCore || (typeof require === 'function' ? require('./core.js') : null);

  // „Matte 2“ und „Mat 2“ sind dieselbe Matte
  const matNo = (s) => {
    const m = C.norm(s).match(/^(?:matte|mat|tapis|tatami|mata|mattan?)\s*(\d+)$/);
    return m ? m[1] : null;
  };
  const sameMat = (a, b) => C.norm(a) === C.norm(b) || (matNo(a) != null && matNo(a) === matNo(b));
  const pick = (p) => ({ name: (p && p.name) || '', club: (p && p.club) || '' });
  const entryOut = (e) => {
    const x = { id: e.id, no: e.no || '', ageClass: e.ageClass || '', category: e.category || '', white: pick(e.white), blue: pick(e.blue), status: e.status || 'open' };
    ['gender', 'mat', 'at', 'round', 'slot', 'bracket', 'pool', 'tiebreak', 'pending', 'whiteFrom', 'blueFrom', 'team', 'leg'].forEach((k) => {
      if (e[k] != null && e[k] !== '' && e[k] !== false) x[k] = e[k];
    });
    if (e.result) x.result = e.result;
    return x;
  };

  /*
   * Stand einer Matte für die Zentrale: laufender Kampf, die nächsten Kämpfe, alle Ergebnisse.
   * upcoming: Liste der nächsten offenen Kämpfe (wie „Nächster Kampf“ sie sieht).
   */
  function matStatus(state, upcoming, now) {
    const f = state.fight;
    const r = C.getRules(state);
    const named = f.white.name || f.blue.name;
    const results = state.queue
      .filter((e) => e.status === 'done' && e.result && !e.result.auto)
      .map((e) => {
        const log = (state.log || []).find((l) => l.fightId === e.result.fightId);
        return Object.assign(entryOut(e), { log: log || null });
      });
    return {
      type: 'status',
      mat: state.settings.mat || '',
      tournament: state.settings.tournament || '',
      current: {
        no: f.no || '',
        cls: C.classLabel(f),
        white: Object.assign(pick(f.white), { score: C.scoreParts(f.white, r) }),
        blue: Object.assign(pick(f.blue), { score: C.scoreParts(f.blue, r) }),
        status: f.status,
        winner: f.winner,
        reason: f.reason,
        clockMs: Math.round(C.clockMs(f.clock, now)),
        golden: f.clock.mode === 'golden',
        running: C.clockRunning(f.clock),
        osae: f.osae.side || '',
        named: !!named,
      },
      next: (upcoming || []).slice(0, 4).map((e) => ({ no: e.no || '', cls: C.classLabel(e), white: pick(e.white), blue: pick(e.blue), at: e.at || '' })),
      open: state.queue.filter((e) => e.status === 'open' && !e.pending && (!e.mat || sameMat(e.mat, state.settings.mat))).length,
      done: results.length,
      results,
      at: now,
    };
  }

  const key = (p) => C.norm(p && p.name);
  // gleicher Kampf, auch wenn die Matte ihn per Excel (mit neuer Id) eingelesen hat
  function sameFight(a, b) {
    if (C.norm(a.ageClass) !== C.norm(b.ageClass) || C.norm(a.category) !== C.norm(b.category)) return false;
    if ((a.gender || '') !== (b.gender || '') && a.gender && b.gender) return false;
    if (a.slot && b.slot) return a.slot === b.slot;
    const aw = key(a.white);
    const ab = key(a.blue);
    const bw = key(b.white);
    const bb = key(b.blue);
    return !!(aw && ab) && ((aw === bw && ab === bb) || (aw === bb && ab === bw));
  }

  /*
   * Ergebnisse einer Matte in die Kampfliste der Zentrale übernehmen.
   * Liefert die Zahl der neuen oder geänderten Ergebnisse.
   */
  function applyResults(state, mat, results) {
    let n = 0;
    (results || []).forEach((r) => {
      if (!r || !r.result) return;
      let e = state.queue.find((q) => q.id === r.id);
      if (!e) e = state.queue.find((q) => q.status !== 'done' && !q.pending && sameFight(q, r)) || state.queue.find((q) => q.status === 'done' && q.result && q.result.fightId === r.result.fightId);
      if (!e) return;
      let res = r.result;
      // Seiten vertauscht eingelesen? Sieger mitdrehen
      if (!r.slot && key(e.white) && key(e.white) === key(r.blue) && key(e.blue) === key(r.white)) {
        const flip = { white: 'blue', blue: 'white' };
        res = Object.assign({}, res, { winner: flip[res.winner] || res.winner, white: res.blue, blue: res.white });
        if (res.scores) res.scores = { white: res.scores.blue, blue: res.scores.white };
      }
      const same = e.status === 'done' && e.result && JSON.stringify(e.result) === JSON.stringify(Object.assign({}, res, { mat }));
      if (same) return;
      e.status = 'done';
      e.result = Object.assign({}, res, { mat });
      n++;
      if (r.log && r.log.fightId) {
        const entry = Object.assign({}, r.log, { mat: r.log.mat || mat });
        const i = state.log.findIndex((l) => l.fightId === entry.fightId);
        if (i >= 0) state.log[i] = entry;
        else state.log.push(entry);
      }
    });
    return n;
  }

  // Kampfliste dieser Matte für den Versand (mit Turniersystemen der Gruppen)
  function fightsFor(state, mat) {
    const entries = state.queue.filter((e) => e.mat && sameMat(e.mat, mat) && e.status !== 'skipped');
    const keys = new Set(entries.map((e) => e.bracket).filter(Boolean));
    return { type: 'fights', mat, tournament: state.settings.tournament || '', entries: entries.map(entryOut), brackets: (state.brackets || []).filter((b) => keys.has(b.key)) };
  }

  /*
   * Kampfliste von der Zentrale an der Matte übernehmen: beendete Kämpfe behalten ihr Ergebnis,
   * offene werden ersetzt. Liefert { added, updated, removed }.
   */
  function mergeFights(state, msg) {
    const incoming = msg.entries || [];
    const ids = new Set(incoming.map((e) => e.id));
    const local = new Map(state.queue.map((e) => [e.id, e]));
    const out = { added: 0, updated: 0, removed: 0 };
    // offene Kämpfe der Matte, die nicht mehr dazugehören, entfernen
    const keep = state.queue.filter((e) => {
      if (ids.has(e.id) || e.status === 'done' || e.team) return true;
      if (e.mat && !sameMat(e.mat, msg.mat)) return true;
      out.removed++;
      return false;
    });
    const merged = [];
    incoming.forEach((inc) => {
      const own = local.get(inc.id);
      if (own && own.status === 'done' && own.result) {
        merged.push(own);
        return;
      }
      const e = Object.assign({}, inc);
      if (e.status === 'done' && !e.result) e.status = 'open';
      if (own) out.updated++;
      else out.added++;
      merged.push(e);
    });
    // Reihenfolge der Zentrale, andere (beendete, fremde) Einträge davor
    const rest = keep.filter((e) => !ids.has(e.id));
    state.queue = rest.concat(merged);
    if (msg.mat) state.settings.mat = msg.mat;
    if (msg.tournament && !state.settings.tournament) state.settings.tournament = msg.tournament;
    (msg.brackets || []).forEach((b) => {
      state.brackets = (state.brackets || []).filter((x) => x.key !== b.key).concat([b]);
    });
    return out;
  }

  // Übersicht für die Zentrale und die Browserseite
  function overview(state, mats, now) {
    return {
      tournament: state.settings.tournament || '',
      mats: mats
        .slice()
        .sort((a, b) => String(a.mat).localeCompare(String(b.mat), 'de', { numeric: true }))
        .map((m) => {
          const s = m.status || {};
          const cur = s.current ? Object.assign({}, s.current) : null;
          // Uhr seit der letzten Meldung weiterrechnen
          if (cur && cur.running && m.receivedAt) cur.clockMs = cur.golden ? cur.clockMs + (now - m.receivedAt) : Math.max(0, cur.clockMs - (now - m.receivedAt));
          return { id: m.id, mat: m.mat || s.mat || '?', address: m.address || '', connected: !!m.connected, seenAt: m.seenAt || 0, current: cur, next: s.next || [], open: s.open || 0, done: s.done || 0 };
        }),
      now,
    };
  }

  /* ---------- Verbindung Matte → Zentrale (WebSocket im Fenster) ---------- */

  /*
   * opts: { url, code, mat, onStatus(state), onMessage(msg) }
   * state: connecting | connected | waiting (Neuversuch) | rejected (falscher Code) | closed
   */
  function connect(opts) {
    let ws = null;
    let timer = 0;
    let watchdog = 0;
    let st = 'connecting';
    let closed = false;
    let lastMsg = 0;
    const set = (s) => {
      if (st === s) return;
      st = s;
      if (opts.onStatus) opts.onStatus(s);
    };
    function open() {
      clearTimeout(timer);
      set(st === 'connected' ? 'waiting' : st === 'waiting' ? 'waiting' : 'connecting');
      try {
        ws = new root.WebSocket(opts.url);
      } catch (err) {
        return retry();
      }
      ws.onopen = () => ws.send(JSON.stringify({ type: 'hello', code: opts.code, mat: opts.mat(), version: opts.version || '' }));
      ws.onmessage = (ev) => {
        let msg;
        try {
          msg = JSON.parse(ev.data);
        } catch (err) {
          return;
        }
        lastMsg = Date.now();
        if (msg.type === 'welcome') {
          set('connected');
          if (opts.onWelcome) opts.onWelcome(msg);
        } else if (msg.type === 'error') {
          set(msg.reason === 'code' ? 'rejected' : 'waiting');
          closed = msg.reason === 'code';
        } else if (msg.type === 'ping') send({ type: 'pong' });
        else if (opts.onMessage) opts.onMessage(msg);
      };
      ws.onclose = () => {
        ws = null;
        if (!closed) retry();
      };
      ws.onerror = () => {};
    }
    function retry() {
      if (closed) return;
      if (st !== 'rejected') set('waiting');
      timer = setTimeout(open, 3000);
    }
    function send(msg) {
      if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify(msg));
        return true;
      }
      return false;
    }
    // Verbindung hängt (WLAN weg, Zentrale im Ruhezustand): neu aufbauen
    watchdog = setInterval(() => {
      if (st === 'connected' && Date.now() - lastMsg > 15000 && ws) {
        try {
          ws.close();
        } catch (err) {
          /* egal */
        }
      }
    }, 5000);
    open();
    return {
      send,
      status: () => st,
      close() {
        closed = true;
        clearTimeout(timer);
        clearInterval(watchdog);
        if (ws) {
          try {
            ws.close();
          } catch (err) {
            /* egal */
          }
        }
        set('closed');
      },
    };
  }

  // „192.168.1.5“, „192.168.1.5:47801“, „http://…“ → ws://…/ws
  function wsUrl(address) {
    let a = String(address || '').trim().replace(/^(https?|wss?):\/\//, '').replace(/\/.*$/, '');
    if (!a) return '';
    if (!/:\d+$/.test(a)) a += ':47801';
    return `ws://${a}/ws`;
  }

  root.JudoNet = { matStatus, applyResults, fightsFor, mergeFights, overview, connect, wsUrl, sameFight };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.JudoNet;
})(typeof globalThis !== 'undefined' ? globalThis : this);
