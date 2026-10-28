/*
 * Trainingsmodus: Randori-Timer mit Runden und Pausen (ohne Wertungen).
 * Ohne DOM, in Node testbar (test/training.test.js). Zeiten in Millisekunden auf Basis von Date.now().
 */
(function (root) {
  'use strict';

  // Vorlagen – in der Bedienung änderbar, eigene lassen sich speichern
  const DEFAULT_TEMPLATES = [
    { id: 't-kids', name: 'Randori Kinder', round: 120, pause: 60, rounds: 5, roundNote: '', pauseNote: 'Partnerwechsel', signalOnly: false },
    { id: 't-adults', name: 'Randori Erwachsene', round: 240, pause: 60, rounds: 6, roundNote: '', pauseNote: '', signalOnly: false },
    { id: 't-newaza', name: 'Ne-waza', round: 90, pause: 30, rounds: 8, roundNote: 'Start in Bodenlage', pauseNote: '', signalOnly: false },
    { id: 't-uchikomi', name: 'Uchi-komi Intervall', round: 20, pause: 10, rounds: 10, roundNote: '', pauseNote: '', signalOnly: true },
  ];
  const WARN_MS = 10000; // Signalton 10 s vor Rundenende

  const clone = (o) => JSON.parse(JSON.stringify(o));

  function normTemplate(t) {
    const n = (v, d, min, max) => Math.max(min, Math.min(max, Math.round(Number(v)) || d));
    return {
      id: String((t && t.id) || 't-' + Math.random().toString(36).slice(2, 9)),
      name: String((t && t.name) || 'Training').trim() || 'Training',
      round: n(t && t.round, 120, 5, 3600),
      pause: Math.max(0, Math.min(3600, Math.round(Number(t && t.pause)) || 0)),
      rounds: n(t && t.rounds, 1, 1, 99),
      roundNote: String((t && t.roundNote) || ''),
      pauseNote: String((t && t.pauseNote) || ''),
      signalOnly: !!(t && t.signalOnly),
    };
  }

  function createTraining() {
    const templates = clone(DEFAULT_TEMPLATES);
    return { templates, current: clone(templates[0]), run: newRun() };
  }

  // phase: ready | round | pause | done
  function newRun() {
    return { phase: 'ready', round: 1, running: false, endsAt: 0, leftMs: 0, warned: false, sound: null, seq: 0 };
  }

  const phaseMs = (tpl, phase) => (phase === 'pause' ? tpl.pause : tpl.round) * 1000;

  function remaining(run, tpl, now) {
    if (run.phase === 'ready') return phaseMs(tpl, 'round');
    if (run.phase === 'done') return 0;
    return run.running ? Math.max(0, run.endsAt - now) : run.leftMs;
  }

  function sound(run, kind, now) {
    run.seq++;
    run.sound = { id: run.seq, kind, at: now };
  }
  // Rundenbeginn/-ende: Gong, bei „nur Signalton“ ein kurzes Signal
  const bell = (tpl) => (tpl.signalOnly ? 'beep' : 'gong');

  function start(tr, now) {
    const run = tr.run;
    const tpl = tr.current;
    if (run.running) return false;
    if (run.phase === 'done') tr.run = newRun();
    const r = tr.run;
    if (r.phase === 'ready') {
      r.phase = 'round';
      r.round = 1;
      r.endsAt = now + phaseMs(tpl, 'round');
      r.warned = false;
      sound(r, bell(tpl), now);
    } else r.endsAt = now + r.leftMs;
    r.running = true;
    return true;
  }

  function pause(tr, now) {
    const r = tr.run;
    if (!r.running) return false;
    r.leftMs = Math.max(0, r.endsAt - now);
    r.running = false;
    return true;
  }

  const toggle = (tr, now) => (tr.run.running ? pause(tr, now) : start(tr, now));

  function reset(tr) {
    tr.run = newRun();
    return true;
  }

  // in die nächste Phase wechseln; at = Zeitpunkt des Phasenendes (ohne Verzögerung durch den Takt)
  function advance(tr, at, now) {
    const r = tr.run;
    const tpl = tr.current;
    if (r.phase === 'round') {
      if (r.round >= tpl.rounds) {
        r.phase = 'done';
        r.running = false;
        r.leftMs = 0;
        sound(r, bell(tpl), now);
        return;
      }
      if (tpl.pause > 0) {
        r.phase = 'pause';
        r.endsAt = at + phaseMs(tpl, 'pause');
        sound(r, bell(tpl), now);
        return;
      }
    }
    // nach der Pause (oder ohne Pause): nächste Runde
    r.phase = 'round';
    r.round++;
    r.endsAt = at + phaseMs(tpl, 'round');
    r.warned = false;
    sound(r, bell(tpl), now);
  }

  // Takt: Phasen weiterschalten, Signalton vor Rundenende. true = etwas geändert
  function tick(tr, now) {
    const r = tr.run;
    if (!r.running) return false;
    let changed = false;
    let guard = 200;
    while (r.running && now >= r.endsAt && guard-- > 0) {
      advance(tr, r.endsAt, now);
      changed = true;
    }
    if (r.running && r.phase === 'round' && !r.warned && tr.current.round * 1000 > 2 * WARN_MS && r.endsAt - now <= WARN_MS) {
      r.warned = true;
      sound(r, 'beep', now);
      changed = true;
    }
    return changed;
  }

  // Runde vor/zurück (Bedienung), läuft danach weiter wie vorher
  function skip(tr, dir, now) {
    const r = tr.run;
    const tpl = tr.current;
    if (r.phase === 'ready' || r.phase === 'done') {
      if (dir > 0 && r.phase === 'ready') start(tr, now);
      return true;
    }
    const running = r.running;
    if (dir > 0) advance(tr, now, now);
    else {
      if (r.phase === 'pause') r.phase = 'round';
      else if (r.round > 1) r.round--;
      r.endsAt = now + phaseMs(tpl, 'round');
      r.warned = false;
    }
    if (tr.run.phase !== 'done') {
      tr.run.running = running;
      if (!running) tr.run.leftMs = Math.max(0, tr.run.endsAt - now);
    }
    return true;
  }

  // Kurzbeschreibung: „6 × 3:00 · Pause 1:00“
  const fmt = (sec) => Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');
  function summary(tpl, t) {
    t = t || ((s, p) => s.replace(/\{(\w+)\}/g, (m, k) => p[k]));
    return `${tpl.rounds} × ${fmt(tpl.round)}` + (tpl.pause ? ' · ' + t('Pause {t}', { t: fmt(tpl.pause) }) : '');
  }

  // Daten für die Anzeige (die Uhr läuft dort mit endsAt selbst weiter)
  function view(tr, now) {
    const r = tr.run;
    const tpl = tr.current;
    const total = phaseMs(tpl, r.phase === 'pause' ? 'pause' : 'round');
    return {
      name: tpl.name,
      rounds: tpl.rounds,
      round: r.round,
      phase: r.phase,
      running: r.running,
      endsAt: r.endsAt,
      leftMs: remaining(r, tpl, now),
      totalMs: total,
      roundSec: tpl.round,
      pauseSec: tpl.pause,
      roundNote: tpl.roundNote,
      pauseNote: tpl.pauseNote,
      sound: r.sound,
    };
  }

  root.JudoTraining = { DEFAULT_TEMPLATES, WARN_MS, createTraining, normTemplate, newRun, remaining, start, pause, toggle, reset, tick, skip, summary, view, fmt };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.JudoTraining;
})(typeof globalThis !== 'undefined' ? globalThis : this);
