/* Bedienfenster: hält den Zustand, wertet Eingaben aus und schickt die Ansicht an die Anzeige. */
(function () {
  'use strict';
  const C = window.JudoCore;
  const T = window.JudoTransport;
  const X = window.JudoExcel;
  const S = window.JudoSound;
  const B = window.JudoBrackets;
  const M = window.JudoMats;
  const BV = window.JudoBracketView;
  const TR = window.JudoTraining;
  const TM = window.JudoTeam;
  const N = window.JudoNet;
  const STORE = 'hajime-v1';
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

  /* ================= Zustand ================= */

  function loadState() {
    try {
      const raw = localStorage.getItem(STORE);
      if (raw) return C.restore(JSON.parse(raw), Date.now());
    } catch (e) {
      console.warn('Gespeicherter Stand nicht lesbar', e);
    }
    return C.createState();
  }

  let state = loadState();
  let history = [];
  // Sprache der Bedienung: t('deutscher Text') liefert die Übersetzung
  const I18n = window.HajimeI18n;
  let t = I18n.make(state.settings.langControl);
  const lvl = (min) => C.levelAtLeast(state.settings, min);
  let lastSoundKey = state.fight.sound ? state.fight.id + ':' + state.fight.sound.id : null;
  const preview = window.JudoBoard.mount($('#preview'), { preview: true });
  const trPreview = window.JudoBoard.mount($('#trPreview'), { preview: true });
  initTraining();
  state.team = TM.normTeam(state.team);
  let lastTrainSound = state.training.run.sound ? state.training.run.sound.id : null;

  let saveTimer = 0;
  function saveNow() {
    clearTimeout(saveTimer);
    try {
      state.savedAt = Date.now();
      localStorage.setItem(STORE, JSON.stringify(state));
    } catch (e) {
      console.warn('Speichern fehlgeschlagen', e);
    }
  }
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 200);
  }

  // Offene Kämpfe dieser Matte ab dem aktuellen; Platzhalter-Paarungen nur auf Wunsch
  function upcoming(withPending) {
    const q = state.queue;
    const cur = q.findIndex((e) => e.id === state.fight.queueId);
    const order = cur >= 0 ? q.slice(cur + 1).concat(q.slice(0, cur)) : q;
    return order.filter((e) => B.isOpen(e) && e.id !== state.fight.queueId && M.forMat(e, state.settings.mat) && (withPending || !e.pending));
  }
  function nextEntries(max) {
    return upcoming(false).slice(0, max);
  }
  const bracketOf = (key) => (state.brackets || []).find((b) => b.key === key) || null;
  const hasTree = (b) => !!b && (b.system === 'ko' || b.system === 'pool2');

  // Gruppe für die Gruppentabelle: gewählte, sonst die des aktuellen Kampfes, sonst die erste
  function tableGroupKey() {
    const keys = C.poolGroups(state.queue).map((g) => g.key);
    const own = C.groupKey(state.fight);
    if (state.boardGroup && keys.includes(state.boardGroup)) return state.boardGroup;
    return keys.includes(own) ? own : keys[0] || null;
  }

  function view() {
    // Urkunden-Hintergrund nicht bei jeder Änderung an die Anzeige schicken
    const settings = Object.assign({}, state.settings);
    delete settings.certBg;
    settings.level = state.settings.level || 'tournament';
    settings.langBoard = I18n.resolve(state.settings.langBoard || state.settings.langControl);
    let table = null;
    if (state.screen === 'table') {
      const key = tableGroupKey();
      table = B.allTables(state).find((t) => t.key === key) || null;
      const b = table && bracketOf(key);
      if (hasTree(b)) table = Object.assign({}, table, { tree: B.treeModel(state, b, state.fight.queueId) });
    }
    return {
      fight: state.fight,
      rules: C.getRules(state),
      settings,
      screen: state.screen,
      table,
      training: state.screen === 'training' ? TR.view(state.training, Date.now()) : null,
      next: nextEntries(6).map((e) => ({ white: e.white, blue: e.blue, ageClass: e.ageClass, category: e.category, gender: e.gender || '', no: e.no })),
      call: state.callMessage ? { message: state.callMessage } : null,
      team: TM.view(state),
    };
  }

  function publish() {
    const v = view();
    preview.update(v);
    // Vorschau im Reiter Training zeigt immer die Trainingsuhr
    trPreview.update(v.training ? v : Object.assign({}, v, { screen: 'training', training: TR.view(state.training, Date.now()) }));
    T.send(v);
  }

  function commit() {
    syncQueueAndLog();
    TM.sync(state);
    B.sync(state);
    save();
    publish();
    renderAll();
    checkSound();
    netChanged();
  }

  // Aktion am laufenden Kampf; undoable = für "Rückgängig" merken
  function act(fn, undoable) {
    const before = undoable ? JSON.stringify({ fight: state.fight, activeProfileId: state.activeProfileId }) : null;
    const res = fn(Date.now());
    if (res === false) return false;
    if (undoable) {
      history.push(before);
      if (history.length > 200) history.shift();
    }
    commit();
    return true;
  }

  function undo() {
    const snap = history.pop();
    if (!snap) return;
    const cur = state.fight;
    const prev = JSON.parse(snap);
    if (prev.fight.id !== cur.id) {
      history = [];
      return;
    }
    const f = prev.fight;
    // Uhren und Eingabefelder bleiben wie sie sind – nur Wertungen/Entscheidung zurück
    f.clock = cur.clock;
    f.osae = cur.osae;
    f.seq = cur.seq;
    f.flash = cur.flash;
    f.sound = cur.sound;
    f.started = cur.started || f.started;
    ['white', 'blue'].forEach((s) => {
      f[s].name = cur[s].name;
      f[s].club = cur[s].club;
    });
    f.no = cur.no;
    f.category = cur.category;
    f.ageClass = cur.ageClass;
    // Ereignisprotokoll bleibt vollständig, „Rückgängig“ wird angehängt
    const prevCount = (f.events || []).length;
    const undone = (cur.events || []).slice(prevCount).map((e) => e.text).filter((t) => !/^Rückgängig/.test(t));
    f.events = (cur.events || []).slice();
    C.logEvent(f, Date.now(), 'Rückgängig' + (undone.length ? ': ' + undone.join(', ') : ''));
    const running = C.clockRunning(f.clock) || !!f.osae.side;
    if (f.status === 'running' && !running) f.status = 'paused';
    if ((f.status === 'paused' || f.status === 'ready') && running) f.status = 'running';
    state.fight = f;
    state.activeProfileId = prev.activeProfileId;
    C.reevaluate(state, Date.now());
    commit();
  }

  function checkSound() {
    const ts = state.training.run.sound;
    if (ts && ts.id !== lastTrainSound) {
      lastTrainSound = ts.id;
      const st = state.settings;
      if (state.screen === 'training' && st.soundOn && (st.soundTarget === 'control' || st.soundTarget === 'both') && Date.now() - ts.at < 2500) S.play(ts.kind);
    }
    const f = state.fight;
    const snd = f.sound;
    if (!snd) return;
    const key = f.id + ':' + snd.id;
    if (key === lastSoundKey) return;
    lastSoundKey = key;
    const s = state.settings;
    if (s.soundOn && (s.soundTarget === 'control' || s.soundTarget === 'both') && Date.now() - snd.at < 2500) S.play(snd.kind);
  }

  function fmtClock(ts) {
    const d = new Date(ts);
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }

  function syncQueueAndLog() {
    const f = state.fight;
    const r = C.getRules(state);
    const done = f.status === 'finished';
    const e = f.queueId && state.queue.find((q) => q.id === f.queueId);
    if (e) {
      if (done) {
        e.status = 'done';
        e.result = {
          fightId: f.id,
          winner: f.winner,
          reason: f.reason,
          white: C.scoreText(f.white, r),
          blue: C.scoreText(f.blue, r),
          kind: C.winKind(f.winner, f.reason, { white: f.white, blue: f.blue }),
          scores: { white: C.scoreParts(f.white, r), blue: C.scoreParts(f.blue, r) },
          durationMs: C.fightTimeMs(f, f.finishedAt),
          finishedAt: f.finishedAt,
        };
      } else if (e.status === 'done' && e.result && e.result.fightId === f.id) {
        e.status = 'open';
        e.result = null;
      }
    }
    const i = state.log.findIndex((l) => l.fightId === f.id);
    if (done) {
      const entry = {
        fightId: f.id,
        no: f.no,
        time: fmtClock(f.finishedAt),
        mat: state.settings.mat,
        ageClass: f.ageClass,
        gender: f.gender || '',
        category: f.category,
        white: { name: f.white.name, club: f.white.club },
        blue: { name: f.blue.name, club: f.blue.club },
        whiteScore: C.scoreText(f.white, r),
        blueScore: C.scoreText(f.blue, r),
        whiteScores: C.scoreParts(f.white, r),
        blueScores: C.scoreParts(f.blue, r),
        yuko: !!r.yuko,
        winner: f.winner,
        winnerName: f.winner === 'draw' ? 'Unentschieden' : C.displayName(f[f.winner], f.winner),
        reason: f.reason,
        duration: C.formatClock(C.fightTimeMs(f, f.finishedAt), 'golden'),
        finishedAt: f.finishedAt,
        kind: C.winKind(f.winner, f.reason, { white: f.white, blue: f.blue }),
        events: (f.events || []).slice(),
      };
      if (i >= 0) state.log[i] = entry;
      else state.log.push(entry);
    } else if (i >= 0) state.log.splice(i, 1);
  }

  /* ================= Kampfsteuerung ================= */

  function fightBusy() {
    const f = state.fight;
    return f.started && f.status !== 'finished';
  }

  function loadEntry(e) {
    const idx = e ? state.queue.indexOf(e) : -1;
    C.loadFight(state, e ? Object.assign({}, e, { no: e.no || String(idx + 1) }) : null, Date.now());
    // alter Aufruf soll beim neuen Kampf nicht stehen bleiben
    state.callMessage = '';
    state.callPicks = [];
    history = [];
    commit();
  }

  function nextFight() {
    if (fightBusy() && !confirm(t('Der aktuelle Kampf ist noch nicht beendet. Trotzdem zum nächsten Kampf wechseln?'))) return;
    // Einfach: ohne Kampfliste setzt „Nächster Kampf“ nur die Tafel zurück
    if (!lvl('standard')) return loadEntry(null);
    const e = nextEntries(1)[0];
    if (e) requestLoad(e);
    else loadEntry(null);
  }

  /* ================= Ruhezeit ================= */

  function loadQueued(e) {
    if (e.status === 'done') {
      e.status = 'open';
      e.result = null;
    }
    loadEntry(e);
  }

  // Kampf aus der Kampfliste laden – vorher prüfen, ob alle Kämpfer ihre Mindestpause hatten
  let restPending = null;
  function requestLoad(entry, onLoaded) {
    if (entry.status === 'skipped') {
      alert('Dieser Kampf entfällt (Best of Three ist schon entschieden).');
      return;
    }
    if (entry.pending) {
      alert(`Diese Paarung steht noch nicht fest: ${entry.white.name || entry.whiteFrom || '?'} – ${entry.blue.name || entry.blueFrom || '?'}.\nSie wird automatisch ausgefüllt, sobald die Vorkämpfe beendet sind.`);
      return;
    }
    if (!C.restCheck(state, entry, Date.now()).waits.length) {
      loadQueued(entry);
      if (onLoaded) onLoaded();
      return;
    }
    restPending = { id: entry.id, onLoaded };
    renderRest();
    $('#dlgRest').showModal();
  }

  const entryTitle = (e) => {
    const no = e.no || String(state.queue.indexOf(e) + 1);
    const cls = C.classLabel(e);
    return `Nr. ${esc(no)}${cls ? ' · ' + esc(cls) : ''}`;
  };
  const entryNames = (e) => `${esc(e.white.name || e.whiteFrom || 'Weiß')} – ${esc(e.blue.name || e.blueFrom || 'Blau')}`;

  // Kämpfe, deren Kämpfer schon bereit sind – in Kampflisten-Reihenfolge ab dem gewünschten Kampf
  function restSuggestions(entry, now) {
    const q = state.queue;
    const i = q.indexOf(entry);
    const order = q.slice(i + 1).concat(q.slice(0, Math.max(0, i)));
    return order
      .filter((e) => e !== entry && B.isOpen(e) && !e.pending && M.forMat(e, state.settings.mat) && e.id !== state.fight.queueId && (e.white.name || e.blue.name))
      .filter((e) => !C.restCheck(state, e, now).waits.length)
      .slice(0, 3);
  }

  function renderRest() {
    const dlg = $('#dlgRest');
    const entry = restPending && state.queue.find((q) => q.id === restPending.id);
    if (!entry) {
      if (dlg.open) dlg.close();
      return;
    }
    const now = Date.now();
    const rc = C.restCheck(state, entry, now);
    const ready = !rc.waits.length;
    dlg.classList.toggle('ready', ready);
    $('.rest-head', dlg).textContent = ready ? '✓ Ruhezeit vorbei – alle Kämpfer bereit' : '⚠ Ruhezeit noch nicht vorbei';
    $('.rest-fight', dlg).innerHTML = `Kampf <b>${entryTitle(entry)}</b>: ${entryNames(entry)}`;
    $('.rest-waits', dlg).innerHTML = rc.waits
      .map(
        (w) => `<div class="rest-wait"><div><b>${esc(w.name)}</b><small>letzter Kampf${w.lastNo ? ` (Nr. ${esc(w.lastNo)})` : ''} endete um ${fmtClock(w.lastEnd)} · Mindestpause ${esc(
          rc.profile
        )}: ${fmtSec(rc.restMs / 1000)}</small></div><div class="rest-left"><b>noch ${C.formatClock(w.remainingMs, 'regular')}</b><small>bereit ab ${fmtClock(w.readyAt)}</small></div></div>`
      )
      .join('');
    const sugg = ready ? [] : restSuggestions(entry, now);
    $('.rest-sugg-wrap', dlg).style.display = sugg.length ? '' : 'none';
    const box = $('.rest-sugg', dlg);
    const html = sugg
      .map((e) => `<div class="rest-s"><span><b>${entryTitle(e)}</b> · ${entryNames(e)}</span><button class="btn" data-pull="${esc(e.id)}">Vorziehen</button></div>`)
      .join('');
    if (box.dataset.h !== html) {
      box.innerHTML = html;
      box.dataset.h = html;
    }
    const lb = $('[data-r="load"]', dlg);
    lb.textContent = ready ? 'Laden' : 'Trotzdem laden';
    lb.classList.toggle('primary', ready);
    lb.classList.toggle('warn', !ready);
  }

  $('#dlgRest').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || !restPending) return;
    const pending = restPending;
    const entry = state.queue.find((q) => q.id === pending.id);
    let load = null;
    if (b.dataset.r === 'load') load = entry;
    else if (b.dataset.pull) {
      // vorgezogenen Kampf in der Kampfliste vor den gewünschten setzen
      const pulled = state.queue.find((q) => q.id === b.dataset.pull);
      if (pulled && entry) {
        state.queue.splice(state.queue.indexOf(pulled), 1);
        state.queue.splice(state.queue.indexOf(entry), 0, pulled);
      }
      load = pulled;
    } else if (b.dataset.r !== 'cancel') return;
    restPending = null;
    $('#dlgRest').close();
    if (load) {
      loadQueued(load);
      if (pending.onLoaded) pending.onLoaded();
    }
  });
  $('#dlgRest').addEventListener('close', () => {
    restPending = null;
  });
  setInterval(() => {
    if (restPending) renderRest();
    renderQueue();
  }, 500);

  function resetFight() {
    if (fightBusy() && !confirm('Kampf wirklich zurücksetzen? Wertungen und Zeit gehen verloren.')) return;
    const f = state.fight;
    const entry = {
      id: f.queueId,
      no: f.no,
      ageClass: f.ageClass,
      category: f.category,
      gender: f.gender || '',
      white: { name: f.white.name, club: f.white.club },
      blue: { name: f.blue.name, club: f.blue.club },
    };
    state.fight = C.newFight(C.getRules(state), entry);
    history = [];
    commit();
  }

  function score(side, kind, delta) {
    act((now) => C.addScore(state, side, kind, delta, now), true);
  }

  // Bedienelemente "Kampf"
  $$('.side').forEach((panel) => {
    const side = panel.dataset.side;
    panel.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      const row = b.closest('.srow');
      if (row) score(side, row.dataset.k, b.classList.contains('minus') ? -1 : 1);
      if (b.classList.contains('hsk')) score(side, 'hsk', state.fight[side].hsk ? -1 : 1);
    });
    const name = $('.in-name', panel);
    const club = $('.in-club', panel);
    name.addEventListener('input', () => {
      state.fight[side].name = name.value;
      commit();
    });
    name.addEventListener('change', () => {
      const p = findPerson(name.value);
      if (p && !state.fight[side].club && p.club) {
        state.fight[side].club = p.club;
        commit();
      }
    });
    club.addEventListener('input', () => {
      state.fight[side].club = club.value;
      commit();
    });
  });

  $('#btnHajime').addEventListener('click', () => act((now) => C.hajimeMate(state, now), true));
  $('#btnToketa').addEventListener('click', () => act((now) => C.toketa(state, now), true));
  $$('[data-osae]').forEach((b) => b.addEventListener('click', () => act((now) => C.startOsae(state, b.dataset.osae, now), true)));
  $$('[data-adj]').forEach((b) => b.addEventListener('click', () => act((now) => C.adjustClock(state, Number(b.dataset.adj), now), false)));
  $('#btnUndo').addEventListener('click', undo);
  $('#btnReset').addEventListener('click', resetFight);
  $('#btnNext').addEventListener('click', nextFight);
  $('#btnDecShow').addEventListener('click', () => $('#decision').classList.toggle('shown'));
  $$('.dec').forEach((b) =>
    b.addEventListener('click', () => {
      const w = b.dataset.win;
      if (!w) return act((now) => C.setWinner(state, null, '', now), true);
      const reason = w === 'draw' ? 'Unentschieden' : $('#decReason').value;
      act((now) => C.setWinner(state, w, reason, now), true);
    })
  );

  $('#btnSetClock').addEventListener('click', () => {
    const dlg = $('#dlgClock');
    const inp = $('#dlgClockVal');
    inp.value = C.formatClock(C.clockMs(state.fight.clock, Date.now()), state.fight.clock.mode);
    dlg.showModal();
    inp.select();
  });
  $('#dlgClockVal').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    $('#dlgClock').close('ok');
  });
  $('#dlgClock').addEventListener('close', () => {
    if ($('#dlgClock').returnValue !== 'ok') return;
    const sec = parseTime($('#dlgClockVal').value);
    if (sec != null) act((now) => C.setClock(state, sec * 1000, now), false);
  });

  $('#profileSelect').addEventListener('change', (e) => act((now) => C.applyProfile(state, e.target.value, now), true));
  $('#fNo').addEventListener('input', (e) => {
    state.fight.no = e.target.value;
    commit();
  });
  $('#fCat').addEventListener('input', (e) => {
    state.fight.category = e.target.value;
    commit();
  });
  $('#fAge').addEventListener('input', (e) => {
    state.fight.ageClass = e.target.value;
    commit();
  });
  $('#fAge').addEventListener('change', (e) => {
    const p = C.findProfileFor(state, e.target.value);
    if (p && p.id !== state.activeProfileId && !state.fight.started) act((now) => C.applyProfile(state, p.id, now), true);
  });

  // Klicks auf Aktionsknöpfe sollen den Tastaturfokus nicht klauen (Leertaste!)
  document.addEventListener('mousedown', (e) => {
    if (e.target.closest('.act')) {
      e.preventDefault();
      const a = document.activeElement;
      if (a && /INPUT|SELECT|TEXTAREA/.test(a.tagName)) a.blur();
    }
  });

  /* ================= Tastatur ================= */

  const KEYS = {
    KeyQ: ['white', 'ippon'],
    KeyW: ['white', 'wazaari'],
    KeyE: ['white', 'yuko'],
    KeyR: ['white', 'shido'],
    KeyU: ['blue', 'ippon'],
    KeyI: ['blue', 'wazaari'],
    KeyO: ['blue', 'yuko'],
    KeyP: ['blue', 'shido'],
  };

  document.addEventListener('keydown', (e) => {
    const t = e.target;
    if (t && t.closest && t.closest('input, textarea, select, dialog')) {
      if (e.key === 'Escape' && t.blur) t.blur();
      return;
    }
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.code === 'KeyZ') {
      e.preventDefault();
      undo();
      return;
    }
    if (mod || e.altKey) return;
    if (e.repeat) {
      if (e.code === 'Space') e.preventDefault();
      return;
    }
    const k = e.code;
    let handled = true;
    // Anzeige zeigt die Trainingsuhr: Tasten wirken auf das Training
    if (state.screen === 'training') {
      if (k === 'Space') trainingAct((tr, now) => TR.toggle(tr, now));
      else if (k === 'ArrowRight') trainingAct((tr, now) => TR.skip(tr, 1, now));
      else if (k === 'ArrowLeft') trainingAct((tr, now) => TR.skip(tr, -1, now));
      else handled = false;
      if (handled) e.preventDefault();
      return;
    }
    if (k === 'Space') act((now) => C.hajimeMate(state, now), true);
    else if (k === 'KeyT') act((now) => C.toketa(state, now), true);
    else if (k === 'KeyA') act((now) => C.startOsae(state, 'white', now), true);
    else if (k === 'KeyL') act((now) => C.startOsae(state, 'blue', now), true);
    else if (KEYS[k]) score(KEYS[k][0], KEYS[k][1], e.shiftKey ? -1 : 1);
    else if (k === 'ArrowUp') act((now) => C.adjustClock(state, 1000, now), false);
    else if (k === 'ArrowDown') act((now) => C.adjustClock(state, -1000, now), false);
    else if (k === 'KeyN') nextFight();
    else if (k === 'KeyB') lvl('standard') && toggleIdle();
    else if (k === 'KeyG') lvl('tournament') && toggleTable();
    else if (k === 'KeyK') lvl('tournament') && callKey();
    else handled = false;
    if (handled) e.preventDefault();
  });

  if (T.isElectron && T.bridge.onMenu) {
    T.bridge.onMenu((cmd) => {
      if (cmd === 'undo') {
        const a = document.activeElement;
        if (a && /INPUT|TEXTAREA/.test(a.tagName)) document.execCommand('undo');
        else undo();
      } else if (cmd === 'about' && window.HajimeCredits) window.HajimeCredits.open();
    });
  }

  /* ================= Uhren-Takt ================= */

  setInterval(() => {
    const now = Date.now();
    const a = C.tick(state, now);
    const b = TR.tick(state.training, now);
    if (a || b) commit();
  }, 40);
  setInterval(() => {
    const f = state.fight;
    if (C.clockRunning(f.clock) || f.osae.side || state.training.run.running) saveNow();
  }, 1000);
  window.addEventListener('beforeunload', saveNow);

  function frame() {
    requestAnimationFrame(frame);
    const f = state.fight;
    const now = Date.now();
    const el = $('#ctlClock');
    const t = C.formatClock(C.clockMs(f.clock, now), f.clock.mode);
    const tEl = $('.t', el);
    if (tEl.textContent !== t) tEl.textContent = t;
    el.classList.toggle('running', C.clockRunning(f.clock));
    el.classList.toggle('golden', f.clock.mode === 'golden');
    $$('[data-osae]').forEach((b) => {
      const live = f.osae.side === b.dataset.osae;
      b.classList.toggle('live', live);
      const label = (b.dataset.osae === 'white' ? 'Osaekomi Weiß' : 'Osaekomi Blau') + (live ? ' · ' + Math.floor(C.osaeMs(f.osae, now) / 1000) + ' s' : '');
      const kbd = b.dataset.osae === 'white' ? 'A' : 'L';
      const html = esc(label) + ` <kbd>${kbd}</kbd>`;
      if (b.innerHTML !== html) b.innerHTML = html;
    });
  }

  /* ================= Rendern Kampf ================= */

  function setVal(el, v) {
    if (document.activeElement !== el && el.value !== v) el.value = v;
  }

  function fmtSec(sec) {
    sec = Math.max(0, Math.round(sec || 0));
    return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');
  }
  function parseTime(v) {
    v = String(v || '').trim().replace(',', '.');
    let m = v.match(/^(\d+)[:.](\d{1,2})$/);
    if (m) return Number(m[1]) * 60 + Number(m[2]);
    m = v.match(/^\d+$/);
    if (m) {
      const n = Number(v);
      return n <= 10 ? n * 60 : n; // "4" = 4 Minuten, "90" = 90 Sekunden
    }
    return null;
  }

  function rulesSummary(r) {
    const parts = [fmtSec(r.duration) + ' min'];
    parts.push(r.golden ? 'Golden Score ' + (r.goldenLimit ? 'max. ' + fmtSec(r.goldenLimit) : 'unbegrenzt') : 'kein Golden Score');
    parts.push(r.ipponEnds ? 'Ippon beendet' : 'Ippon beendet nicht');
    if (r.ipponEnds && r.awasete) parts.push('2 W = I');
    parts.push(r.yuko ? 'mit Yuko' : 'ohne Yuko');
    parts.push(r.shidoLimit ? r.shidoLimit + '. Shido = HSK' : 'keine HSK durch Shido');
    return parts.join(' · ');
  }

  function renderFight() {
    const f = state.fight;
    const r = C.getRules(state);
    const ps = $('#profileSelect');
    const opts = state.profiles.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('');
    if (ps.dataset.opts !== opts) {
      ps.innerHTML = opts;
      ps.dataset.opts = opts;
    }
    ps.value = state.activeProfileId;
    setVal($('#fNo'), f.no);
    setVal($('#fAge'), f.ageClass);
    setVal($('#fCat'), f.category);
    $('#rulesSummary').textContent = rulesSummary(r);

    $$('.side').forEach((panel) => {
      const side = panel.dataset.side;
      const c = f[side];
      setVal($('.in-name', panel), c.name);
      setVal($('.in-club', panel), c.club);
      $$('.srow', panel).forEach((row) => {
        const k = row.dataset.k;
        $('.val', row).textContent = c[k];
        row.classList.toggle('off', k === 'yuko' && !r.yuko);
      });
      $('.hsk', panel).classList.toggle('on', C.isHansoku(c, r));
      $('.side-badge', panel).textContent = f.status === 'finished' && f.winner === side ? 'SIEGER' : '';
    });

    const hb = $('#btnHajime');
    hb.classList.remove('mate', 'golden');
    hb.disabled = false;
    let label = 'Hajime';
    if (f.status === 'finished') {
      label = 'Kampf beendet';
      hb.disabled = true;
    } else if (C.clockRunning(f.clock) || f.osae.side) {
      label = 'Mate';
      hb.classList.add('mate');
    } else if (f.status === 'timeup') {
      if (f.clock.mode === 'regular' && r.golden) {
        label = 'Golden Score starten';
        hb.classList.add('golden');
      } else {
        label = 'Kampfrichterentscheid nötig';
        hb.disabled = true;
      }
    }
    hb.innerHTML = esc(label) + ' <kbd>Leertaste</kbd>';

    const st = $('#ctlStatus');
    let text = '';
    let cls = '';
    const needDecision = f.status === 'timeup' && !(f.clock.mode === 'regular' && r.golden);
    if (f.status === 'ready') text = 'Bereit – Hajime startet den Kampf';
    else if (f.status === 'running') text = f.osae.side ? 'Osaekomi ' + C.SIDE_LABEL[f.osae.side] : f.clock.mode === 'golden' ? 'Golden Score läuft' : 'Kampf läuft';
    else if (f.status === 'paused') text = 'Mate – Uhr steht';
    else if (f.status === 'timeup') {
      cls = 'gold';
      text = needDecision ? 'Zeit abgelaufen, Gleichstand – Entscheidung der Kampfrichter wählen' : 'Zeit abgelaufen, Gleichstand – Hajime startet Golden Score';
    } else if (f.status === 'finished') {
      cls = 'win';
      text = f.winner === 'draw' ? 'Unentschieden' : `Sieger: ${C.displayName(f[f.winner], f.winner)} (${C.SIDE_LABEL[f.winner]}) – ${f.reason}`;
    }
    st.textContent = text;
    st.className = 'ctl-status ' + cls;
    $('#decision').classList.toggle('need', needDecision);
    $('#decision').classList.toggle('manual', !!f.manual);
    if (f.status !== 'finished' && !needDecision && f.status === 'ready') $('#decision').classList.remove('shown');
    $('.dec.x').style.display = f.manual ? '' : 'none';
    $('#btnUndo').disabled = !history.length;
    $('#btnIdle').classList.toggle('on', state.screen === 'idle');
    $('#btnTable').classList.toggle('on', state.screen === 'table');
    const nx = nextEntries(1)[0];
    $('#btnNext').title = nx ? `Nächster: ${nx.white.name || '?'} – ${nx.blue.name || '?'}` : 'Leerer neuer Kampf';
  }

  /* ================= Anzeige-Fenster ================= */

  function toggleIdle() {
    state.screen = state.screen === 'idle' ? 'board' : 'idle';
    commit();
  }
  $('#btnIdle').addEventListener('click', toggleIdle);

  // Gruppentabelle an/aus; mit key gezielt diese Gruppe zeigen
  function toggleTable(key) {
    if (state.screen === 'table' && (!key || key === tableGroupKey())) state.screen = 'board';
    else {
      state.boardGroup = key || (C.poolGroups(state.queue).some((g) => g.key === C.groupKey(state.fight)) ? C.groupKey(state.fight) : tableGroupKey());
      state.screen = 'table';
    }
    commit();
  }
  $('#btnTable').addEventListener('click', () => toggleTable());

  const displaySelect = $('#displaySelect');
  async function refreshDisplays() {
    if (!T.isElectron) return;
    const list = await T.bridge.getDisplays();
    const prev = displaySelect.value;
    displaySelect.innerHTML = list.map((d) => `<option value="${d.id}">${esc(d.label)}</option>`).join('');
    const keep = list.find((d) => String(d.id) === prev);
    const pick = keep || list.find((d) => d.isBoard) || list.find((d) => !d.isControl) || list[0];
    if (pick) displaySelect.value = String(pick.id);
  }
  if (T.isElectron) {
    refreshDisplays();
    T.bridge.onDisplaysChanged(refreshDisplays);
    T.bridge.onBoardStatus((s) => {
      const el = $('#boardState');
      el.textContent = s.open ? (s.fullscreen ? '● Anzeige: Vollbild' : '● Anzeige: Fenster') : '○ Anzeige geschlossen';
      el.classList.toggle('on', !!s.open);
      $('#btnBoardShow').textContent = s.open ? 'Anzeige hierhin' : 'Anzeige öffnen';
      $('#btnBoardFs').disabled = !s.open;
      refreshDisplays();
    });
    $('#btnBoardShow').addEventListener('click', () => T.bridge.showBoard({ displayId: Number(displaySelect.value) }));
    $('#btnBoardFs').addEventListener('click', () => T.bridge.toggleBoardFullscreen());
  } else {
    // Browser: Bildschirmauswahl nur, wenn der Browser die Bildschirme verrät (Chrome/Edge)
    displaySelect.style.display = 'none';
    $('#btnBoardFs').style.display = 'none';
    T.setOnNeedView(publish);
    let screens = null;
    let screensWatched = false;
    async function refreshScreens(ask) {
      const list = await T.browserScreens(ask);
      if (!list) return null;
      screens = list;
      if (!screensWatched) {
        screensWatched = true;
        T.onScreensChanged(() => refreshScreens(false));
      }
      const prev = displaySelect.value;
      displaySelect.innerHTML = list.map((d) => `<option value="${esc(d.id)}">${esc(d.label)}</option>`).join('');
      const pick = list.find((d) => d.id === prev) || list.find((d) => !d.isControl) || list[0];
      displaySelect.value = pick.id;
      displaySelect.style.display = list.length > 1 ? '' : 'none';
      return list;
    }
    // Nur bei mehreren Bildschirmen gezielt platzieren, sonst normales Fenster
    const chosen = () => (screens && screens.length > 1 ? (screens.find((d) => d.id === displaySelect.value) || {}).screen : null);
    refreshScreens(false);

    $('#btnBoardShow').addEventListener('click', async () => {
      const wasOpen = T.boardOpen();
      if (!T.openBoardBrowser(chosen())) {
        alert('Das Anzeige-Fenster wurde vom Browser blockiert. Bitte Pop-ups für diese Seite erlauben.');
        return;
      }
      setTimeout(publish, 300);
      if (wasOpen) T.placeBoardBrowser(chosen());
      // Beim ersten Mal fragt der Browser nach der Erlaubnis für die Bildschirme
      if (!screens && (await refreshScreens(true)) && screens.length > 1) T.placeBoardBrowser(chosen());
    });
    displaySelect.addEventListener('change', () => {
      if (T.boardOpen()) T.placeBoardBrowser(chosen());
    });
    setInterval(() => {
      const open = T.boardOpen();
      const el = $('#boardState');
      el.textContent = open ? '● Anzeige offen (Doppelklick = Vollbild)' : '○ Anzeige geschlossen';
      el.classList.toggle('on', open);
      $('#btnBoardShow').textContent = open && screens && screens.length > 1 ? 'Anzeige hierhin' : 'Anzeige öffnen';
    }, 1000);
  }

  /* ================= Tabs ================= */

  $$('.tabs button').forEach((b) =>
    b.addEventListener('click', () => {
      $$('.tabs button').forEach((x) => x.classList.toggle('active', x === b));
      $$('.tab').forEach((t) => t.classList.toggle('active', t.id === 'tab-' + b.dataset.tab));
    })
  );

  /* ================= Kampfliste & Teilnehmer ================= */

  function allPeople() {
    const map = new Map();
    state.participants.forEach((p) => p.name && map.set(p.name, p));
    state.queue.forEach((e) => ['white', 'blue'].forEach((s) => e[s].name && !map.has(e[s].name) && map.set(e[s].name, e[s])));
    return map;
  }
  function findPerson(name) {
    return allPeople().get(String(name || '').trim()) || null;
  }

  function fillDatalist(id, values) {
    const html = Array.from(new Set(values.filter(Boolean)))
      .sort((a, b) => a.localeCompare(b, 'de'))
      .map((v) => `<option value="${esc(v)}"></option>`)
      .join('');
    const el = document.getElementById(id);
    if (el.dataset.h !== html) {
      el.innerHTML = html;
      el.dataset.h = html;
    }
  }

  function renderDatalists() {
    const people = Array.from(allPeople().values());
    fillDatalist('dlNames', people.map((p) => p.name));
    fillDatalist('dlClubs', people.map((p) => p.club));
    const items = state.participants.concat(state.queue);
    fillDatalist('dlAge', items.map((x) => x.ageClass).concat(state.profiles.map((p) => p.name)));
    fillDatalist('dlCat', items.map((x) => x.category));
  }

  function personCell(p, wait, from) {
    if (!p.name && from) return `<i class="from">${esc(from)}</i>`;
    const tag = wait ? ` <span class="rest-tag" title="Mindestpause bis ${fmtClock(wait.readyAt)}">Pause ${C.formatClock(wait.remainingMs, 'regular')}</span>` : '';
    return `${esc(p.name || '–')}${tag}${p.club ? `<br><small>${esc(p.club)}</small>` : ''}`;
  }

  function renderQueue() {
    const tb = $('#queueTable tbody');
    const now = Date.now();
    const html = state.queue
      .map((e, i) => {
        const cur = e.id === state.fight.queueId;
        const other = !M.forMat(e, state.settings.mat);
        const waits = !B.isOpen(e) || cur || e.pending || other ? [] : C.restCheck(state, e, now).waits;
        const wait = (side) => waits.find((w) => w.side === side);
        let res = '';
        if (e.result) {
          const wn = e.result.winner === 'draw' ? 'Unentschieden' : e.result.winner === 'white' ? e.white.name || 'Weiß' : e.blue.name || 'Blau';
          res = `<span class="win">${esc(wn)}</span><br><small>${esc(e.result.reason)}</small>`;
        } else if (cur) res = '<small>läuft / geladen</small>';
        else if (e.status === 'skipped') res = '<small>entfällt</small>';
        else if (e.pending) res = `<small>${e.white.name && e.blue.name ? 'nur falls nötig' : 'steht noch nicht fest'}</small>`;
        const where = e.mat ? `<br><small class="${other ? 'other-mat' : ''}">${esc(e.mat)}${e.at ? ' · ' + esc(e.at) : ''}</small>` : '';
        const round = e.round && !/^Kampf \d+$/.test(e.round) ? `<br><small>${esc(e.round)}</small>` : '';
        const cls = ['current', 'done', 'skipped', 'pending', 'other'].filter((k) => (k === 'current' ? cur : k === 'other' ? other : k === 'pending' ? e.pending : e.status === k));
        return `<tr class="${cls.join(' ')}" data-id="${esc(e.id)}">
          <td>${esc(e.no || i + 1)}${where}</td>
          <td>${esc(C.classLabel(e))}${round}${e.tiebreak ? '<br><span class="tb-tag">Stichkampf</span>' : ''}</td>
          <td>${personCell(e.white, wait('white'), e.whiteFrom)}</td>
          <td>${personCell(e.blue, wait('blue'), e.blueFrom)}</td>
          <td>${res}</td>
          <td class="acts">
            <button class="load" data-a="load" title="In den Kampf laden" ${e.pending || e.status === 'skipped' ? 'disabled' : ''}>Laden</button>
            <button data-a="up" title="nach oben">↑</button>
            <button data-a="down" title="nach unten">↓</button>
            <button data-a="del" title="entfernen">✕</button>
          </td></tr>`;
      })
      .join('');
    if (tb.dataset.h !== html) {
      tb.innerHTML = html;
      tb.dataset.h = html;
    }
    const open = state.queue.filter(B.isOpen).length;
    const all = state.queue.filter((e) => e.status !== 'skipped').length;
    $('#queueCount').textContent = all ? `${open}/${all}` : '';
    const mats = new Set(state.queue.map((e) => e.mat).filter(Boolean));
    const hint = $('#queueMatHint');
    hint.textContent = mats.size > 1 ? `Kampfliste für ${mats.size} Matten. Dieser Rechner ist „${state.settings.mat || '–'}“ (Einstellungen) – Kämpfe anderer Matten werden beim „Nächster Kampf“ übersprungen.` : '';
    hint.style.display = mats.size > 1 ? '' : 'none';
  }

  $('#queueTable tbody').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const id = b.closest('tr').dataset.id;
    const i = state.queue.findIndex((q) => q.id === id);
    if (i < 0) return;
    const a = b.dataset.a;
    if (a === 'load') {
      if (state.fight.queueId !== id && fightBusy() && !confirm('Der aktuelle Kampf ist noch nicht beendet. Trotzdem diesen Kampf laden?')) return;
      const entry = state.queue[i];
      if (entry.status === 'done' && !confirm('Dieser Kampf ist bereits beendet. Erneut laden (Ergebnis wird überschrieben)?')) return;
      requestLoad(entry, () => $('.tabs button[data-tab="fight"]').click());
      return;
    }
    if (a === 'up' && i > 0) state.queue.splice(i - 1, 0, state.queue.splice(i, 1)[0]);
    if (a === 'down' && i < state.queue.length - 1) state.queue.splice(i + 1, 0, state.queue.splice(i, 1)[0]);
    if (a === 'del') {
      const e = state.queue[i];
      if (e.team) return alert(t('Dieser Kampf gehört zum Mannschaftskampf. Die Aufstellung lässt sich unter „Mannschaft“ ändern.'));
      const b = e.bracket && e.slot && bracketOf(e.bracket);
      if (b) {
        // Paarungen eines Turniersystems hängen zusammen: nur die ganze Gruppe entfernen
        if (!confirm(`Dieser Kampf gehört zum Turniersystem „${B.SYSTEMS[b.system]}“ der Gruppe ${C.groupLabel(b)}.\nGanze Gruppe (alle ihre Kämpfe) aus der Kampfliste entfernen?`)) return;
        removeBracket(b.key);
      } else state.queue.splice(i, 1);
    }
    commit();
  });

  $('#addFight').addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const w = String(fd.get('white') || '').trim();
    const b = String(fd.get('blue') || '').trim();
    if (!w && !b) return;
    const pw = findPerson(w);
    const pb = findPerson(b);
    state.queue.push({
      id: C.uid(),
      no: '',
      ageClass: String(fd.get('ageClass') || '').trim(),
      category: String(fd.get('category') || '').trim(),
      ...(state.settings.splitGender && C.normGender(fd.get('gender')) ? { gender: C.normGender(fd.get('gender')) } : {}),
      white: { name: w, club: (pw && pw.club) || '' },
      blue: { name: b, club: (pb && pb.club) || '' },
      status: 'open',
      result: null,
    });
    e.target.elements.white.value = '';
    e.target.elements.blue.value = '';
    e.target.elements.white.focus();
    commit();
  });

  // Teilnehmer nach Alters- und Gewichtsklasse (und ggf. Geschlecht) – Schlüssel wie in der Kampfliste
  function groups() {
    const split = !!state.settings.splitGender;
    const m = new Map();
    state.participants.forEach((p) => {
      const g = { ageClass: p.ageClass || '', category: p.category || '', gender: split ? C.normGender(p.gender) : '' };
      const key = C.groupKey(g);
      if (!m.has(key)) m.set(key, Object.assign(g, { key, label: C.groupLabel(g), people: [] }));
      m.get(key).people.push(p);
    });
    return Array.from(m.values()).sort((a, b) => a.label.localeCompare(b.label, 'de', { numeric: true }));
  }

  const limits = () => B.limitsOf(state.settings.systems);
  // gewähltes System der Gruppe: von Hand gewählt, sonst Vorschlag nach Größe
  function systemFor(g) {
    const n = g.people.length;
    const own = state.groupSystems[g.key];
    return own && B.allowed(own, n) ? own : B.suggest(n, limits());
  }
  const fightWord = (n) => (n === 1 ? 'Kampf' : 'Kämpfe');
  const countText = (sys, n) => (sys === 'bo3' ? '2–3 Kämpfe' : `${B.fightCount(sys, n)} ${fightWord(B.fightCount(sys, n))}`);

  function removeBracket(key) {
    state.queue = state.queue.filter((e) => e.bracket !== key);
    state.brackets = state.brackets.filter((b) => b.key !== key);
  }

  // Kampfliste einer Gruppe nach ihrem System erzeugen (true = erzeugt)
  function generate(g, quiet) {
    const sys = systemFor(g);
    if (!sys) return false;
    const old = state.queue.filter((e) => C.groupKey(e) === g.key);
    if (old.some((e) => e.status === 'done')) {
      if (!quiet) alert(`${g.label}: Es gibt schon beendete Kämpfe – die Kampfliste dieser Gruppe wird nicht neu erzeugt.`);
      return false;
    }
    if (old.length && !quiet && !confirm(`${g.label}: Für diese Gruppe stehen schon ${old.length} Kämpfe in der Liste. Ersetzen?`)) return false;
    state.queue = state.queue.filter((e) => C.groupKey(e) !== g.key);
    state.brackets = state.brackets.filter((b) => b.key !== g.key);
    state.brackets.push(B.newBracket(g, sys, g.people));
    B.sync(state);
    return true;
  }

  function renderParticipants() {
    const gs = groups();
    const L = limits();
    const missingGender = state.settings.splitGender && state.participants.some((p) => !C.normGender(p.gender));
    const open = gs.filter((g) => !bracketOf(g.key) && g.people.length > 1);
    const html =
      (gs.length > 1
        ? `<div class="btnrow" style="margin-bottom:8px"><button class="btn primary" data-gen="*" ${open.length ? '' : 'disabled'}>Kampflisten aller Gruppen erzeugen${open.length ? ` (${open.length})` : ''}</button></div>`
        : '') +
      (missingGender ? '<div class="import-msg err">Einige Teilnehmer haben kein Geschlecht – sie bilden eigene Gruppen ohne Geschlecht.</div>' : '') +
      gs
        .map((g) => {
          const n = g.people.length;
          const b = bracketOf(g.key);
          let ctl;
          if (b) {
            const started = state.queue.some((e) => e.bracket === b.key && e.status === 'done');
            ctl = `<span class="sys-tag">${esc(B.SYSTEMS[b.system])}</span>
              <button class="btn" data-regen="${esc(g.key)}" ${started ? 'disabled title="Es gibt schon Ergebnisse"' : 'title="Neu auslosen"'}>Neu auslosen</button>
              <button class="btn" data-unbr="${esc(g.key)}" title="Gruppe aus der Kampfliste entfernen">✕</button>`;
          } else if (n < 2) ctl = '<span class="muted">zu wenige Kämpfer</span>';
          else {
            const sys = systemFor(g);
            const sug = B.suggest(n, L);
            const opts = B.SYSTEM_IDS.filter((id) => B.allowed(id, n))
              .map((id) => `<option value="${id}" ${id === sys ? 'selected' : ''}>${esc(B.SYSTEMS[id])}${id === sug ? ' (Vorschlag)' : ''}</option>`)
              .join('');
            ctl = `<select data-sys="${esc(g.key)}" title="Turniersystem">${opts}</select>
              <button class="btn" data-gen="${esc(g.key)}">Kampfliste erzeugen (${countText(sys, n)})</button>`;
          }
          return `<div class="group${b ? ' has-br' : ''}"><div class="group-head"><span>${esc(g.label)} <span class="pill">${n}</span></span><span class="group-ctl">${ctl}</span></div>
            <div class="group-names">${(b ? b.players : g.people).map((p) => esc(p.name) + (p.club ? ` <small>(${esc(p.club)})</small>` : '')).join(', ')}</div></div>`;
        })
        .join('');
    const box = $('#partGroups');
    if (box.dataset.h !== html) {
      box.innerHTML = html;
      box.dataset.h = html;
    }
    $('#partEmpty').style.display = state.participants.length ? 'none' : '';
    $('#partCount').textContent = state.participants.length || '';
  }

  $('#partGroups').addEventListener('change', (e) => {
    const sel = e.target.closest('[data-sys]');
    if (!sel) return;
    state.groupSystems[sel.dataset.sys] = sel.value;
    commit();
  });
  $('#partGroups').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.gen) {
      const all = b.dataset.gen === '*';
      const list = groups().filter((g) => (all ? !bracketOf(g.key) && g.people.length > 1 : g.key === b.dataset.gen));
      const withOld = all && list.filter((g) => state.queue.some((q) => C.groupKey(q) === g.key));
      if (withOld && withOld.length && !confirm(`Für ${withOld.length} Gruppe(n) stehen schon Kämpfe in der Liste (ohne Turniersystem). Durch neu erzeugte ersetzen?`)) return;
      let n = 0;
      list.forEach((g) => generate(g, all) && n++);
      importMsg(`${n} ${n === 1 ? 'Gruppe' : 'Gruppen'} erzeugt – Kampfliste hat jetzt ${state.queue.filter((q) => q.status !== 'skipped').length} Kämpfe.`);
      commit();
    } else if (b.dataset.regen) {
      const g = groups().find((x) => x.key === b.dataset.regen);
      const br = bracketOf(b.dataset.regen);
      if (!g || !br) return;
      if (!confirm(`${g.label}: Neu auslosen? Die Paarungen werden neu gemischt.`)) return;
      state.groupSystems[g.key] = br.system;
      removeBracket(g.key);
      generate(g, true);
      commit();
    } else if (b.dataset.unbr) {
      const br = bracketOf(b.dataset.unbr);
      if (!br || !confirm(`${C.groupLabel(br)}: Alle Kämpfe dieser Gruppe aus der Kampfliste entfernen?`)) return;
      removeBracket(br.key);
      commit();
    }
  });

  function importMsg(text, err) {
    const el = $('#importMsg');
    el.textContent = text;
    el.classList.toggle('err', !!err);
  }

  $('#btnImport').addEventListener('click', () => $('#fileImport').click());
  $('#fileImport').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const res = await X.importFile(file);
      if (!res.fights.length && !res.participants.length) {
        importMsg('In der Datei wurden keine Namen erkannt. Tipp: Excel-Vorlage verwenden (Spalten „Weiß Name“/„Blau Name“ oder „Vorname“/„Nachname“).', true);
        return;
      }
      const replace = $('#importReplace').checked;
      // Geschlecht nur, wenn nach Geschlecht getrennt wird (bei Teilnehmern immer merken)
      const split = !!state.settings.splitGender || (res.brackets || []).some((b) => b.gender);
      if (split && !state.settings.splitGender && confirm('Die Datei trennt Gruppen nach Geschlecht. Einstellung „nach Geschlecht trennen“ einschalten?')) state.settings.splitGender = true;
      const keepGender = !!state.settings.splitGender;
      // Turniersysteme aus dem Mattenexport
      const brackets = (res.brackets || [])
        .map((b) => {
          const system = B.systemFromText(b.system);
          const g = { ageClass: b.ageClass, category: b.category, gender: keepGender ? b.gender : '' };
          return system && B.allowed(system, b.players.length) ? Object.assign(g, { key: C.groupKey(g), system, players: b.players }) : null;
        })
        .filter(Boolean);
      if (replace) state.brackets = [];
      brackets.forEach((b) => {
        state.brackets = state.brackets.filter((x) => x.key !== b.key);
        state.brackets.push(b);
      });
      if (res.fights.length) {
        const fights = res.fights.map((f) => {
          const e = Object.assign({ id: C.uid(), status: 'open', result: null }, f);
          if (!keepGender) delete e.gender;
          if (e.slot && brackets.some((b) => b.key === C.groupKey(e))) e.bracket = C.groupKey(e);
          else delete e.slot;
          return e;
        });
        state.queue = replace ? fights : state.queue.concat(fights);
        // Datei für genau eine Matte: diese Matte einstellen
        const mats = new Set(fights.map((f) => f.mat).filter(Boolean));
        if (mats.size === 1 && fights.every((f) => f.mat)) state.settings.mat = Array.from(mats)[0];
      }
      if (res.participants.length) state.participants = replace ? res.participants : state.participants.concat(res.participants);
      if (replace && res.fights.length) state.matPlan = Object.assign({}, state.matPlan, { active: false, assign: {} });
      importMsg(`„${file.name}“ importiert – ${res.sheets.join(', ')}.${res.fights.some((f) => f.mat) && state.settings.mat ? ` Matte: ${state.settings.mat}.` : ''}`);
      commit();
    } catch (err) {
      importMsg('Import fehlgeschlagen: ' + err.message, true);
    }
  });

  $('#btnTemplate').addEventListener('click', () => T.saveFile('Hajime-Import-Vorlage.xlsx', new Uint8Array(X.templateBytes())));
  // Aushang: Kampfreihenfolge pro Matte (App: PDF-Datei, Browser: Druckdialog mit „Als PDF sichern“)
  $('#btnNotice').addEventListener('click', async () => {
    const N = window.JudoNotice;
    const size = $('#noticeSize').value;
    const mats = N.mats(state.queue, state.settings.mat, $('#noticeOpen').checked);
    if (!mats.length) {
      alert('Die Kampfliste ist leer – es gibt nichts auszuhängen.');
      return;
    }
    const html = N.html({ tournament: state.settings.tournament, mats, size });
    const name = `Hajime-Aushang-${fileSafe(mats.length === 1 ? mats[0].name : 'Matten')}.pdf`;
    printDoc(name, html, size, true);
  });

  const fileSafe = (s) => String(s || '').replace(/[^\wäöüÄÖÜß-]+/g, '-').replace(/^-+|-+$/g, '') || 'Hajime';

  // Druckseite ausgeben: App → PDF-Datei, Browser → Druckdialog („Als PDF sichern“)
  async function printDoc(name, html, size, landscape) {
    if (T.isElectron && T.bridge.savePdf) {
      try {
        await T.bridge.savePdf(name, html, size, landscape);
      } catch (err) {
        alert('PDF konnte nicht erstellt werden: ' + err.message);
      }
      return;
    }
    const frame = document.createElement('iframe');
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
    frame.srcdoc = html;
    frame.onload = () => {
      frame.contentWindow.focus();
      frame.contentWindow.print();
      setTimeout(() => frame.remove(), 60000);
    };
    document.body.appendChild(frame);
  }
  $('#btnClearQueue').addEventListener('click', () => {
    if (state.queue.length && confirm('Kampfliste komplett leeren (auch Turnierbäume und Mattenverteilung)?')) {
      state.queue = [];
      state.brackets = [];
      state.matPlan = Object.assign({}, state.matPlan, { active: false, assign: {} });
      commit();
    }
  });
  $('#btnClearParts').addEventListener('click', () => {
    if (state.participants.length && confirm('Teilnehmerliste leeren?')) {
      state.participants = [];
      commit();
    }
  });

  /* ================= Auswertung ================= */

  function tieButtons(t, ties, pool) {
    return ties
      .map(
        (names, i) =>
          `<div class="eval-tie">${pool ? `Pool ${pool} – ` : ''}Gleichstand: ${esc(names.join(', '))} – Stichkampf nötig <button class="btn" data-tb="${esc(t.key)}" data-tie="${i}"${
            pool ? ` data-pool="${pool}"` : ''
          }>Stichkampf anlegen (${(names.length * (names.length - 1)) / 2})</button></div>`
      )
      .join('');
  }

  function renderEval() {
    const tables = B.allTables(state);
    const shown = state.screen === 'table' ? tableGroupKey() : null;
    const html = tables
      .map((t) => {
        const b = bracketOf(t.key);
        const status = t.complete ? '<span class="pill ok">fertig</span>' : `<span class="pill">${t.done} von ${t.total} Kämpfen</span>`;
        const rows = t.rows
          .map(
            (r) => `<tr class="${r.tie ? 'tie' : ''}"><td class="pl p${r.place}">${r.place == null ? '–' : r.place}</td><td><b>${esc(r.name)}</b>${r.club ? ` <small>${esc(r.club)}</small>` : ''}${
              r.tie ? ' <span class="tb-tag">Stichkampf</span>' : ''
            }</td><td>${r.fights}</td><td>${r.wins}</td><td>${r.losses}</td><td>${r.draws}</td><td><b>${r.points}</b></td>${t.scheme === 'ijf' ? `<td>${r.timeMs ? fmtSec(r.timeMs / 1000) : '–'}</td>` : ''}</tr>`
          )
          .join('');
        let ties = tieButtons(t, t.ties);
        if (t.pools) t.pools.forEach((p) => (ties += tieButtons(t, p.ties, p.pool)));
        const open = t.tiebreakOpen ? `<div class="muted">${t.tiebreakOpen} ${t.tiebreakOpen === 1 ? 'Stichkampf' : 'Stichkämpfe'} offen</div>` : '';
        const tree = hasTree(b) ? `<div class="eval-tree">${BV.treeHtml(B.treeModel(state, b, state.fight.queueId), { club: false })}</div>` : '';
        const sys = b ? `<span class="sys-tag">${esc(B.SYSTEMS[b.system])}</span>` : '';
        return `<div class="card eval-card${t.complete ? ' done' : ''}${tree ? ' wide' : ''}">
          <div class="eval-head"><h2>${esc(t.label)}</h2>${sys}${status}<span class="grow"></span>
            ${tree ? `<button class="btn" data-tree="${esc(t.key)}" title="Turnierbaum als PDF (A4 quer)">Baum drucken …</button>` : ''}
            <button class="btn toggle${shown === t.key ? ' on' : ''}" data-show="${esc(t.key)}" title="${tree ? 'Turnierbaum' : 'Diese Tabelle'} auf der Anzeige zeigen">Auf Anzeige</button>
            <button class="btn" data-cert="${esc(t.key)}">Urkunden …</button></div>
          ${tree}
          ${ties}
          <div class="table-wrap"><table class="tbl eval"><thead><tr><th>Platz</th><th>Name</th><th title="Kämpfe">K</th><th title="Siege">S</th><th title="Niederlagen">N</th><th title="Unentschieden">U</th><th title="${t.scheme === 'ijf' ? 'Punkte (IJF)' : t.scheme === 'custom' ? 'Wertungspunkte (eigene Werte)' : 'Wertungspunkte (DJB)'}">Punkte</th>${
            t.scheme === 'ijf' ? '<th title="Gesamtzeit der gewonnenen Kämpfe – bei Gleichstand gewinnt die kürzere">Zeit</th>' : ''
          }</tr></thead><tbody>${rows}</tbody></table></div>
          ${open}
          ${tree ? '<p class="muted">Sieger rücken automatisch weiter, sobald ein Kampf beendet ist. Vereinstrennung: Kämpfer desselben Vereins treffen möglichst spät aufeinander.</p>' : ''}
        </div>`;
      })
      .join('');
    const box = $('#evalGroups');
    if (box.dataset.h !== html) {
      box.innerHTML = html;
      box.dataset.h = html;
    }
    $('#evalEmpty').style.display = tables.length ? 'none' : '';
    const done = tables.filter((t) => t.complete).length;
    $('#evalInfo').textContent = tables.length ? `${done} von ${tables.length} Gruppen fertig` : '';
  }

  function awardTables(onlyKey) {
    const all = B.allTables(state);
    if (onlyKey) return all.filter((t) => t.key === onlyKey);
    return all.filter((t) => (state.settings.awardsDoneOnly ? t.complete : t.done > 0));
  }
  function awardWarnings(tables) {
    const msgs = [];
    const open = tables.filter((t) => !t.complete);
    const ties = tables.filter((t) => t.ties.length);
    if (open.length) msgs.push(`Noch nicht fertig: ${open.map((t) => `${t.label} (${t.done}/${t.total})`).join(', ')}`);
    if (ties.length) msgs.push(`Gleichstand ohne Stichkampf: ${ties.map((t) => t.label).join(', ')}`);
    return !msgs.length || confirm(msgs.join('\n') + '\n\nTrotzdem fortfahren?');
  }
  function noAwards() {
    alert(state.settings.awardsDoneOnly ? 'Noch keine Gruppe ist fertig. Für vorläufige Ergebnisse „nur fertige Gruppen“ ausschalten.' : 'Es sind noch keine Kämpfe beendet.');
  }

  function printCerts(tables, label) {
    const places = state.settings.certPlaces;
    const n = window.JudoAwards.count(tables, places);
    if (!n) return alert('Für diese Auswahl gibt es keine Platzierten.');
    printDoc(`Hajime-Urkunden-${fileSafe(label)}.pdf`, window.JudoAwards.certHtml({ tables, places, settings: state.settings }), 'A4', false);
  }

  $('#evalGroups').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.show) return toggleTable(b.dataset.show);
    if (b.dataset.tree) {
      const br = bracketOf(b.dataset.tree);
      if (!br) return;
      const model = B.treeModel(state, br, null);
      const css = Array.from(document.styleSheets)
        .flatMap((sh) => {
          try {
            return Array.from(sh.cssRules).map((r) => r.cssText);
          } catch (err) {
            return [];
          }
        })
        .filter((t) => /\.bk/.test(t) && !/jb-tb-grid/.test(t))
        .join('\n');
      return printDoc(`Hajime-Turnierbaum-${fileSafe(model.label)}.pdf`, BV.printHtml(model, state.settings, css), 'A4', true);
    }
    if (b.dataset.cert) {
      const tables = awardTables(b.dataset.cert);
      if (!tables.length || !awardWarnings(tables)) return;
      return printCerts(tables, tables[0].label);
    }
    if (b.dataset.tb) {
      // Stichkampf: jeder gegen jeden unter den Gleichplatzierten, direkt nach dem aktuellen Kampf
      const all = B.allTables(state).find((x) => x.key === b.dataset.tb);
      const pool = b.dataset.pool || '';
      const t = pool && all && all.pools ? all.pools.find((p) => p.pool === pool) : all;
      const names = t && t.ties[Number(b.dataset.tie)];
      if (!names) return;
      const people = names.map((n) => t.rows.find((r) => r.name === n));
      const br = bracketOf(all.key);
      const mat = (state.queue.find((q) => C.groupKey(q) === all.key && q.mat) || {}).mat;
      const fights = C.roundRobin(people).map(([a, c]) => ({
        id: C.uid(),
        no: '',
        ageClass: all.ageClass,
        category: all.category,
        ...(all.gender ? { gender: all.gender } : {}),
        ...(br ? { bracket: br.key } : {}),
        ...(pool ? { pool } : {}),
        ...(mat ? { mat } : {}),
        white: { name: a.name, club: a.club || '' },
        blue: { name: c.name, club: c.club || '' },
        status: 'open',
        result: null,
        tiebreak: true,
      }));
      const cur = state.queue.findIndex((q) => q.id === state.fight.queueId);
      state.queue.splice(cur >= 0 ? cur + 1 : state.queue.length, 0, ...fights);
      commit();
      $('#evalMsg').textContent = `${all.label}${pool ? ' Pool ' + pool : ''}: ${fights.length} ${fights.length === 1 ? 'Stichkampf' : 'Stichkämpfe'} als nächste${fights.length === 1 ? 'r Kampf' : ' Kämpfe'} in die Kampfliste eingefügt.`;
    }
  });

  $('#btnWinnersPdf').addEventListener('click', () => {
    const tables = awardTables();
    if (!tables.length) return noAwards();
    const places = state.settings.certPlaces === 'all' ? 'all' : '3';
    printDoc(`Hajime-Siegerliste-${fileSafe(state.settings.tournament)}.pdf`, window.JudoAwards.listHtml({ tables, places, settings: state.settings }), 'A4', false);
  });
  $('#btnWinnersXlsx').addEventListener('click', () => {
    const tables = awardTables();
    if (!tables.length) return noAwards();
    const places = state.settings.certPlaces === 'all' ? 'all' : '3';
    T.saveFile(`Hajime-Siegerliste-${fileSafe(state.settings.tournament)}.xlsx`, new Uint8Array(X.winnersBytes(tables, places, C.awardRows)));
  });
  $('#btnCertsAll').addEventListener('click', () => {
    const tables = awardTables();
    if (!tables.length) return noAwards();
    if (!awardWarnings(tables)) return;
    printCerts(tables, 'alle');
  });

  /* ================= Matten verteilen ================= */

  const minText = (sec) => `${Math.round(sec / 60)} min`;

  function renderMats() {
    const plan = M.planOf(state);
    const groups = M.matGroups(state, plan);
    const people = new Set();
    groups.forEach((g) => g.entries.forEach((e) => ['white', 'blue'].forEach((k) => e[k].name && people.add(C.norm(e[k].name)))));
    const fights = groups.reduce((a, g) => a + g.fights, 0);
    $('#mpInfo').textContent = groups.length ? `${groups.length} Gruppen · ${people.size} Teilnehmer · ${fights} Kämpfe` : '';
    ['mpCount', 'mpStart', 'mpExtra'].forEach((id) => {
      const el = document.getElementById(id);
      if (document.activeElement === el) return;
      const v = id === 'mpCount' ? String(plan.count) : id === 'mpStart' ? plan.start : fmtSec(plan.extra);
      if (el.value !== v) el.value = v;
    });
    $('#mpEmpty').style.display = groups.length ? 'none' : '';
    $('#mpIntro').style.display = groups.length && !plan.active ? '' : 'none';
    $('#btnMpClear').disabled = !plan.active;
    $('#btnMpExport').disabled = !plan.active;
    $('#btnMpNotice').disabled = !plan.active;
    $('#btnMpDistribute').textContent = plan.active ? 'Neu verteilen' : 'Verteilen';
    let html = '';
    if (plan.active && groups.length) {
      const L = M.layout(groups, plan);
      html = L.mats
        .map(
          (m) => `<div class="mat-col" data-mat="${m.index}">
            <div class="mat-head"><b>${esc(m.name)}</b><span>${m.fights} ${fightWord(m.fights)} · ca. ${minText(m.durSec)} · bis ${esc(m.end)}</span></div>
            ${m.gender ? `<div class="mat-sex sex-${m.gender}">${esc(C.GENDER_LABEL[m.gender])}${m.then ? `, danach ${esc(C.GENDER_LABEL[m.then])}` : ''}</div>` : ''}
            <div class="mat-bar"><i style="width:${Math.round(m.share * 100)}%"></i></div>
            ${m.groups
              .map(
                (g) => `<div class="mat-group${g.tooBig ? ' big' : ''}" draggable="true" data-key="${esc(g.key)}" title="Ziehen, um die Gruppe auf eine andere Matte zu legen">
                  <span class="grip">⠿</span>
                  <div class="mg-txt"><b>${esc(g.label)}</b><small>${g.players} Kämpfer · ${g.fights} ${fightWord(g.fights)} · ${esc(g.systemLabel)}${g.open < g.fights ? ` · ${g.fights - g.open} beendet` : ''}</small>${
                  g.tooBig ? '<small class="warn">allein länger als eine Matte im Schnitt</small>' : ''
                }</div>
                  <span class="mg-dur">${minText(g.durSec)}</span></div>`
              )
              .join('')}
            <div class="mat-drop">Gruppe hierher ziehen</div>
          </div>`
        )
        .join('');
    }
    const grid = $('#mpGrid');
    grid.style.setProperty('--mats', plan.count);
    if (grid.dataset.h !== html) {
      grid.innerHTML = html;
      grid.dataset.h = html;
    }
  }

  function applyMats(msg) {
    M.apply(state);
    commit();
    if (msg) $('#mpMsg').textContent = msg;
  }
  function setPlan(patch) {
    state.matPlan = Object.assign(M.planOf(state), patch);
  }

  $('#btnMpDistribute').addEventListener('click', () => {
    const groups = M.matGroups(state);
    if (!groups.length) return;
    if (state.queue.some((e) => e.status === 'done') && !confirm('Es gibt schon beendete Kämpfe. Trotzdem neu verteilen? Reihenfolge und Nummern ändern sich.')) return;
    const plan = M.planOf(state);
    setPlan({ assign: M.distribute(groups, plan.count) });
    applyMats('Gruppen nach erwarteter Dauer verteilt. Mit der Maus lassen sich Gruppen auf eine andere Matte ziehen.');
  });
  $('#btnMpClear').addEventListener('click', () => {
    if (!confirm('Verteilung aufheben? Matte und Uhrzeit werden aus der Kampfliste entfernt.')) return;
    M.clear(state);
    commit();
    $('#mpMsg').textContent = '';
  });
  $('#mpCount').addEventListener('change', (e) => {
    const n = Math.max(1, Math.min(20, Math.round(Number(e.target.value) || 1)));
    const plan = M.planOf(state);
    setPlan({ count: n, assign: plan.active ? M.distribute(M.matGroups(state), n) : {} });
    if (plan.active) applyMats(`Auf ${n} ${n === 1 ? 'Matte' : 'Matten'} neu verteilt.`);
    else commit();
  });
  $('#mpStart').addEventListener('change', (e) => {
    setPlan({ start: e.target.value || '09:00' });
    if (M.planOf(state).active) applyMats();
    else commit();
  });
  $('#mpExtra').addEventListener('change', (e) => {
    const v = parseTime(e.target.value);
    if (v == null) return renderMats();
    setPlan({ extra: v });
    if (M.planOf(state).active) applyMats();
    else commit();
  });

  // Gruppen per Ziehen auf eine andere Matte legen
  let dragKey = null;
  $('#mpGrid').addEventListener('dragstart', (e) => {
    const g = e.target.closest('.mat-group');
    if (!g) return;
    dragKey = g.dataset.key;
    g.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', dragKey);
  });
  $('#mpGrid').addEventListener('dragend', () => {
    dragKey = null;
    $$('.mat-col.over, .mat-group.dragging').forEach((x) => x.classList.remove('over', 'dragging'));
  });
  $('#mpGrid').addEventListener('dragover', (e) => {
    const col = e.target.closest('.mat-col');
    if (!col || dragKey == null) return;
    e.preventDefault();
    $$('.mat-col.over').forEach((x) => x !== col && x.classList.remove('over'));
    col.classList.add('over');
  });
  $('#mpGrid').addEventListener('drop', (e) => {
    const col = e.target.closest('.mat-col');
    if (!col || dragKey == null) return;
    e.preventDefault();
    const plan = M.planOf(state);
    plan.assign[dragKey] = Number(col.dataset.mat);
    state.matPlan = plan;
    dragKey = null;
    applyMats();
  });

  function matEntries(name) {
    return state.queue.filter((e) => e.mat === name && e.status !== 'skipped');
  }
  $('#btnMpExport').addEventListener('click', async () => {
    const plan = M.planOf(state);
    const files = [];
    for (let i = 0; i < plan.count; i++) {
      const name = M.matName(i);
      const entries = matEntries(name);
      if (!entries.length) continue;
      const keys = new Set(entries.map((e) => e.bracket).filter(Boolean));
      const bytes = X.matBytes({
        mat: name,
        tournament: state.settings.tournament,
        entries,
        brackets: state.brackets.filter((b) => keys.has(b.key)),
        systemLabel: (id) => B.SYSTEMS[id],
      });
      files.push({ name: `${fileSafe(name)}.xlsx`, bytes: new Uint8Array(bytes) });
    }
    if (!files.length) return alert('Keine Kämpfe verteilt.');
    const ok = await T.saveFiles(files);
    if (ok) $('#mpMsg').textContent = `${files.length} Dateien gespeichert: ${files.map((f) => f.name).join(', ')}. Am Rechner jeder Matte über „Kampfliste → Excel / CSV importieren“ einlesen.`;
  });
  $('#btnMpNotice').addEventListener('click', () => {
    const N = window.JudoNotice;
    const size = $('#noticeSize').value;
    const mats = N.mats(state.queue, state.settings.mat, false);
    if (!mats.length) return;
    printDoc(`Hajime-Aushang-Matten.pdf`, N.html({ tournament: state.settings.tournament, mats, size }), size, true);
  });

  /* ================= Aufruf (Zeile oben auf der Anzeige) ================= */

  const personLabel = (p) => (p.club ? `${p.name} (${p.club})` : p.name);
  function callText(picks) {
    if (!picks.length) return '';
    const who = picks.length === 1 ? picks[0] : picks.slice(0, -1).join(', ') + ' und ' + picks[picks.length - 1];
    return `${who} bitte zur ${state.settings.mat || 'Matte'}`;
  }
  // Kämpfer zur Auswahl: aktueller Kampf (bzw. der nächste, wenn keiner läuft), dann die nächsten
  function callGroups() {
    const f = state.fight;
    const named = (x) => (x.white && x.white.name) || (x.blue && x.blue.name);
    const groups = [];
    const loaded = named(f) && f.status !== 'finished';
    if (loaded) groups.push({ title: 'Aktueller Kampf', cls: C.classLabel(f), fights: [f], cur: true });
    const next = upcoming(false).filter(named).slice(0, 3);
    if (next.length) groups.push({ title: loaded ? 'Nächster Kampf · bereitmachen' : 'Als Nächstes auf die Matte', cls: C.classLabel(next[0]), fights: [next[0]], cur: !loaded });
    if (next.length > 1) groups.push({ title: 'Danach', cls: '', fights: next.slice(1), cur: false });
    return groups;
  }
  function renderCall() {
    const msg = state.callMessage || '';
    $('#btnCall').classList.toggle('on', !!msg);
    const pop = $('#callPop');
    if (pop.hidden) return;
    const picks = state.callPicks || [];
    const chip = (p, side, cur) => {
      if (!p || !p.name) return '';
      const lbl = personLabel(p);
      const on = picks.includes(lbl);
      return `<button type="button" class="call-chip${cur ? ' cur' : ''}${on ? ' on' : ''}" data-pick="${esc(lbl)}" title="${esc(lbl)}"><i class="dot ${side}"></i>${esc(p.name)}</button>`;
    };
    const groups = callGroups();
    // jeden Kämpfer nur einmal anbieten (z. B. Best of Three: dieselben zwei mehrmals)
    const seen = new Set();
    const once = (p) => {
      const k = p && p.name ? C.norm(p.name) : '';
      if (!k || seen.has(k)) return null;
      seen.add(k);
      return p;
    };
    groups.forEach((g) => (g.people = g.fights.map((x) => [once(x.white), once(x.blue)]).filter((x) => x[0] || x[1])));
    const html = groups.some((g) => g.people.length)
      ? groups
          .filter((g) => g.people.length)
          .map(
            (g) =>
              `<div class="call-grp"><div class="call-gt">${esc(g.title)}${g.cls ? ` · ${esc(g.cls)}` : ''}</div><div class="call-chips">${g.people
                .map((x) => chip(x[0], 'w', g.cur) + chip(x[1], 'b', g.cur))
                .join('')}</div></div>`
          )
          .join('')
      : '<p class="muted">Keine Namen in der Kampfliste – einfach freien Text eingeben.</p>';
    const box = $('#callGroups');
    if (box.dataset.h !== html) {
      box.innerHTML = html;
      box.dataset.h = html;
    }
    // freier Text nur zeigen, wenn er nicht aus der Auswahl stammt
    setVal($('#callMsg'), picks.length ? '' : msg);
    $('#btnCallClear').disabled = !msg;
    updateSend();
  }
  function setCall(picks, text) {
    state.callPicks = picks;
    state.callMessage = text != null ? text : callText(picks);
    commit();
  }
  function openCall(open) {
    const pop = $('#callPop');
    pop.hidden = !open;
    $('#btnCall').setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) renderCall();
  }
  // Taste K: Zeile ausblenden; ist keine da, Auswahl öffnen bzw. schließen
  function callKey() {
    if (state.callMessage) {
      setCall([], '');
      openCall(false);
    } else openCall($('#callPop').hidden);
  }
  $('#btnCall').addEventListener('click', (e) => {
    e.stopPropagation();
    openCall($('#callPop').hidden);
  });
  $('#callGroups').addEventListener('click', (e) => {
    const b = e.target.closest('[data-pick]');
    if (!b) return;
    const lbl = b.dataset.pick;
    const picks = (state.callPicks || []).slice();
    const i = picks.indexOf(lbl);
    if (i >= 0) picks.splice(i, 1);
    else picks.push(lbl);
    setCall(picks);
    b.blur(); // Tastenkürzel (Leertaste) sollen wieder für den Kampf gelten
  });
  // freier Text geht erst nach Bestätigung (Enter / „Anzeigen“) auf die Anzeige, nicht beim Tippen
  function freeText() {
    return $('#callMsg').value.trim();
  }
  function updateSend() {
    $('#btnCallSend').disabled = !freeText() || (freeText() === state.callMessage && !(state.callPicks || []).length);
  }
  function sendFree() {
    if (!freeText()) return;
    setCall([], freeText());
    // Auswahl bleibt offen; Fokus raus aus dem Feld, damit die Tastenkürzel wieder gehen
    $('#callMsg').blur();
    $('#btnCallSend').blur();
  }
  $('#callMsg').addEventListener('input', updateSend);
  $('#callMsg').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      sendFree();
    }
  });
  $('#btnCallSend').addEventListener('click', sendFree);
  $('#btnCallClear').addEventListener('click', () => setCall([], ''));
  $('#btnCallDone').addEventListener('click', () => openCall(false));
  document.addEventListener('mousedown', (e) => {
    const pop = $('#callPop');
    if (!pop.hidden && !pop.contains(e.target) && !e.target.closest('#btnCall')) openCall(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('#callPop').hidden) openCall(false);
  });

  /* ================= Protokoll ================= */

  // Ereignisprotokoll: welche Kämpfe aufgeklappt sind
  const openEvents = new Set();
  function fmtTimeSec(ts) {
    const d = new Date(ts);
    return [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, '0')).join(':');
  }
  function eventsTable(events) {
    if (!events || !events.length) return '<div class="muted">Keine Ereignisse aufgezeichnet.</div>';
    return `<table class="tbl ev"><thead><tr><th>Uhrzeit</th><th>Kampfzeit</th><th>Ereignis</th></tr></thead><tbody>${events
      .map((e) => `<tr><td>${esc(fmtTimeSec(e.at))}</td><td>${esc(e.clock)}</td><td>${esc(e.text)}</td></tr>`)
      .join('')}</tbody></table>`;
  }

  function renderLog() {
    const tb = $('#logTable tbody');
    // Wertungen je Seite in eigenen Spalten; Yuko nur, wenn damit gekämpft wurde
    const yuko = C.logUsesYuko(state.log);
    const kinds = [['ippon', 'I', 'Ippon'], ['wazaari', 'W', 'Waza-ari']].concat(yuko ? [['yuko', 'Y', 'Yuko']] : [], [['shido', 'S', 'Shido']]);
    const headSide = (lbl) => `<th>${lbl}</th>` + kinds.map((k, i) => `<th class="sc-n${i ? '' : ' first'}" title="${k[2]}">${k[1]}</th>`).join('');
    const head = `<tr><th>Nr</th><th>Zeit</th><th>Klasse</th>${headSide('Weiß')}${headSide('Blau')}<th>Sieger</th><th>Entscheidung</th><th>Dauer</th><th></th></tr>`;
    const thead = $('#logTable thead');
    if (thead.dataset.h !== head) {
      thead.innerHTML = head;
      thead.dataset.h = head;
    }
    const cols = 7 + 2 * (kinds.length + 1);
    const side = (l, k) => {
      const sc = C.logScores(l, k);
      const name = `<td${l.winner === k ? ' class="win"' : ''}>${esc(l[k].name || (k === 'white' ? 'Weiß' : 'Blau'))}</td>`;
      return (
        name +
        kinds
          .map(([key], i) => {
            const v = sc[key] || 0;
            const hsk = key === 'shido' && sc.hsk;
            return `<td class="sc-n${i ? '' : ' first'}${v || hsk ? '' : ' z'}${hsk ? ' hsk' : ''}"${hsk ? ' title="Hansoku-make"' : ''}>${v}${hsk ? '<sup>H</sup>' : ''}</td>`;
          })
          .join('')
      );
    };
    const html = state.log
      .slice()
      .reverse()
      .map((l) => {
        const n = (l.events || []).length;
        const open = openEvents.has(l.fightId);
        return `<tr data-fight="${esc(l.fightId)}"><td>${esc(l.no)}</td><td>${esc(l.time)}</td><td>${esc(C.classLabel(l))}</td>
        ${side(l, 'white')}${side(l, 'blue')}
        <td>${esc(l.winnerName)}</td><td>${esc(l.reason)}</td><td>${esc(l.duration)}</td>
        <td><button class="btn ev-toggle" data-ev="${esc(l.fightId)}" ${n ? '' : 'disabled'}>${open ? 'Ereignisse ▴' : 'Ereignisse ▾'}${n ? ` (${n})` : ''}</button></td></tr>${
          open ? `<tr class="ev-row"><td colspan="${cols}">${eventsTable(l.events)}</td></tr>` : ''
        }`;
      })
      .join('');
    if (tb.dataset.h !== html) {
      tb.innerHTML = html;
      tb.dataset.h = html;
    }
    $('#logCount').textContent = state.log.length || '';
  }
  $('#logTable tbody').addEventListener('click', (e) => {
    const b = e.target.closest('[data-ev]');
    if (!b) return;
    const id = b.dataset.ev;
    if (openEvents.has(id)) openEvents.delete(id);
    else openEvents.add(id);
    renderLog();
  });
  $('#btnExportLog').addEventListener('click', () => {
    const d = new Date();
    const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    T.saveFile(`Hajime-Protokoll-${stamp}.xlsx`, new Uint8Array(X.protocolBytes(state.log, B.allTables(state).filter((t) => t.done))));
  });
  $('#btnClearLog').addEventListener('click', () => {
    if (state.log.length && confirm('Protokoll wirklich leeren? Vorher als Excel speichern!')) {
      state.log = [];
      commit();
    }
  });

  /* ================= Einstellungen ================= */

  const SETTING_INPUTS = {
    sLevel: ['level', 'value'],
    sLangControl: ['langControl', 'value'],
    sLangBoard: ['langBoard', 'value'],
    sTournament: ['tournament', 'value'],
    sMat: ['mat', 'value'],
    sShowClub: ['showClub', 'checked'],
    sShowNext: ['showNext', 'checked'],
    sNextSize: ['nextSize', 'value'],
    sFlash: ['flashScores', 'checked'],
    sSwap: ['swap', 'checked'],
    sSound: ['soundOn', 'checked'],
    sSoundTarget: ['soundTarget', 'value'],
    sRankOrder: ['rankOrder', 'value'],
    sDate: ['tournamentDate', 'value'],
    sPlace: ['tournamentPlace', 'value'],
    sSign1: ['certSign1', 'value'],
    sSign2: ['certSign2', 'value'],
    sCertPlaces: ['certPlaces', 'value'],
    sAwardsDoneOnly: ['awardsDoneOnly', 'checked'],
    sSplitGender: ['splitGender', 'checked'],
  };
  Object.entries(SETTING_INPUTS).forEach(([id, [key, prop]]) => {
    const el = document.getElementById(id);
    el.addEventListener(prop === 'checked' || el.tagName === 'SELECT' || el.type === 'date' ? 'change' : 'input', () => {
      state.settings[key] = el[prop];
      commit();
    });
  });

  function renderSettings() {
    fillLangSelects();
    Object.entries(SETTING_INPUTS).forEach(([id, [key, prop]]) => {
      const el = document.getElementById(id);
      if (document.activeElement === el) return;
      if (el[prop] !== state.settings[key]) el[prop] = state.settings[key];
    });
    const img = $('#sLogoPreview');
    const src = state.settings.logo || '';
    if (img.getAttribute('src') !== src) img.setAttribute('src', src);
    const bg = $('#sCertBgPreview');
    const bsrc = state.settings.certBg || '';
    if (bg.getAttribute('src') !== bsrc) bg.setAttribute('src', bsrc);
    $$('[data-wp]').forEach((el) => {
      if (document.activeElement === el) return;
      const v = String(state.settings.winPoints[el.dataset.wp]);
      if (el.value !== v) el.value = v;
    });
    // Yuko-Punkte nur zeigen, wenn ein Regelprofil Yuko verwendet
    $('[data-wp="yuko"]').closest('label').style.display = state.profiles.some((p) => p.yuko) ? '' : 'none';
    const sc = C.scoringOpts(state.settings).scheme;
    setVal($('#sScoring'), sc);
    $('#customScoring').style.display = sc === 'custom' ? '' : 'none';
    $('#scoringInfo').textContent = SCORING_INFO[sc] || '';
    $('.gender-in').style.display = state.settings.splitGender ? '' : 'none';
    const L = B.limitsOf(state.settings.systems);
    $$('[data-sl]').forEach((el) => {
      if (document.activeElement === el) return;
      if (el.type === 'checkbox') el.checked = !!L[el.dataset.sl];
      else if (el.value !== String(L[el.dataset.sl])) el.value = String(L[el.dataset.sl]);
    });
    $('#slInfo').textContent = `Vorschlag: 2 Kämpfer ${B.SYSTEMS[B.suggest(2, L)]} · 3–${L.rrMax} Jeder gegen jeden${L.poolMax > L.rrMax ? ` · ${Math.max(4, L.rrMax + 1)}–${L.poolMax} Doppel-Pool` : ''} · ab ${L.poolMax + 1} K.-o. mit Trostrunde`;
  }

  const SCORING_INFO = {
    djb: 'DJB-Regeln „Platzierungen im Pool“ (2023): je Sieg 1 Siegpunkt; Wertungspunkte nur für den Sieger nach der kampfentscheidenden Wertung – Ippon 10, Waza-ari 7, Hansoku-make / Kiken-gachi / Fusen-gachi 10, Hantei 0. Yuko ist dort nicht geregelt, Hajime rechnet 5. Rangfolge: Siegpunkte → Wertungspunkte → direkter Vergleich → Stichkampf.',
    ijf: 'IJF Sport and Organisation Rules 2025: Punkte für beide Kämpfer – Summe der eigenen Wertungen (Ippon 100, Waza-ari 10, Yuko 1), höchstens 100 je Kampf; Hansoku-make / Kiken-gachi / Fusen-gachi 100 für den Sieger, Hantei 0. Rangfolge: Siege → Punkte → direkter Vergleich → kürzere Gesamtzeit der gewonnenen Kämpfe → Entscheidungskampf.',
    custom: 'Eigene Wertungspunkte je Sieg (nur der Sieger bekommt Punkte) und wählbare Rangfolge.',
  };
  $('#sScoring').addEventListener('change', (e) => {
    const prev = C.scoringOpts(state.settings);
    const next = e.target.value;
    // Wechsel auf „Eigene Werte“: Werte des bisherigen Schemas als Startwerte
    if (next === 'custom' && prev.scheme !== 'custom') {
      state.settings.winPoints = Object.assign({}, prev.winPoints);
      state.settings.rankOrder = prev.rankOrder;
    }
    state.settings.scoring = next;
    commit();
  });

  $$('[data-sl]').forEach((el) =>
    el.addEventListener('change', () => {
      const v = el.type === 'checkbox' ? el.checked : Math.max(2, Math.round(Number(el.value) || 0));
      state.settings.systems = B.limitsOf(Object.assign({}, state.settings.systems, { [el.dataset.sl]: v }));
      commit();
    })
  );

  $$('[data-wp]').forEach((el) =>
    el.addEventListener('change', () => {
      const v = Math.max(0, Math.round(Number(el.value) || 0));
      state.settings.winPoints = Object.assign({}, state.settings.winPoints, { [el.dataset.wp]: v });
      el.value = String(v);
      commit();
    })
  );

  // Bild laden und verkleinern (Logo, Urkunden-Hintergrund)
  function readImage(file, max, type, cb) {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const k = Math.min(1, max / Math.max(img.width, img.height));
        const cv = document.createElement('canvas');
        cv.width = Math.round(img.width * k);
        cv.height = Math.round(img.height * k);
        const ctx = cv.getContext('2d');
        if (type === 'image/jpeg') {
          ctx.fillStyle = '#fff';
          ctx.fillRect(0, 0, cv.width, cv.height);
        }
        ctx.drawImage(img, 0, 0, cv.width, cv.height);
        cb(cv.toDataURL(type, 0.85));
      };
      img.onerror = () => alert('Das Bild konnte nicht gelesen werden.');
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  }
  $('#btnCertBg').addEventListener('click', () => $('#fileCertBg').click());
  $('#btnCertBgRemove').addEventListener('click', () => {
    state.settings.certBg = null;
    commit();
  });
  $('#fileCertBg').addEventListener('change', (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    // A4 mit rund 150 dpi reicht für den Druck und hält den Speicher klein
    readImage(file, 1754, 'image/jpeg', (url) => {
      state.settings.certBg = url;
      commit();
    });
  });

  $('#btnTestSound').addEventListener('click', () => S.gong());
  $('#btnLogo').addEventListener('click', () => $('#fileLogo').click());
  $('#btnLogoRemove').addEventListener('click', () => {
    state.settings.logo = null;
    commit();
  });
  $('#fileLogo').addEventListener('change', (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    // verkleinern, damit Speicher und Übertragung schlank bleiben
    readImage(file, 600, 'image/png', (url) => {
      state.settings.logo = url;
      commit();
    });
  });

  $('#btnBackup').addEventListener('click', () => {
    const d = new Date();
    const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const bytes = new TextEncoder().encode(JSON.stringify(state, null, 1));
    T.saveFile(`Hajime-Sicherung-${stamp}.json`, bytes, 'application/json');
  });
  $('#btnRestore').addEventListener('click', () => $('#fileRestore').click());
  $('#fileRestore').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!data || !data.fight || !data.profiles) throw new Error('keine gültige Sicherung');
      if (!confirm('Aktuellen Stand durch die Sicherung ersetzen?')) return;
      state = C.restore(data, Date.now());
      history = [];
      commit();
    } catch (err) {
      alert('Sicherung konnte nicht geladen werden: ' + err.message);
    }
  });
  $('#btnFactory').addEventListener('click', () => {
    if (!confirm('Wirklich ALLES zurücksetzen (Kampfliste, Teilnehmer, Protokoll, Profile, Einstellungen)?')) return;
    state = C.createState();
    history = [];
    commit();
  });

  // Regelprofile
  let editProfId = state.activeProfileId;
  let seenActive = state.activeProfileId;
  function editProf() {
    if (seenActive !== state.activeProfileId) {
      // aktives Profil hat gewechselt -> Editor folgt
      seenActive = state.activeProfileId;
      editProfId = seenActive;
    }
    return state.profiles.find((p) => p.id === editProfId) || state.profiles[0];
  }
  function renderProfiles() {
    const sel = $('#profEditSelect');
    const opts = state.profiles
      .map((p) => `<option value="${esc(p.id)}">${esc(p.name)}${p.id === state.activeProfileId ? ' (aktiv)' : ''}</option>`)
      .join('');
    if (sel.dataset.h !== opts) {
      sel.innerHTML = opts;
      sel.dataset.h = opts;
    }
    const p = editProf();
    editProfId = p.id;
    sel.value = p.id;
    $$('#profForm [data-p]').forEach((el) => {
      if (document.activeElement === el) return;
      const v = p[el.dataset.p];
      if (el.type === 'checkbox') el.checked = !!v;
      else if ('time' in el.dataset) el.value = fmtSec(v);
      else el.value = v == null ? '' : v;
    });
    $('#btnProfDel').disabled = state.profiles.length < 2;
  }
  $('#profEditSelect').addEventListener('change', (e) => {
    editProfId = e.target.value;
    renderProfiles();
  });
  $$('#profForm [data-p]').forEach((el) =>
    el.addEventListener('change', () => {
      const p = editProf();
      const key = el.dataset.p;
      let v;
      if (el.type === 'checkbox') v = el.checked;
      else if ('time' in el.dataset) {
        v = parseTime(el.value);
        if (v == null) {
          el.value = fmtSec(p[key]);
          return;
        }
        el.value = fmtSec(v);
      } else if (el.type === 'number') v = Math.max(0, Number(el.value) || 0);
      else v = el.value.trim();
      p[key] = v;
      if (key === 'name' && !v) p.name = 'Profil';
      if (p.id === state.activeProfileId) C.applyProfile(state, p.id, Date.now());
      commit();
    })
  );
  $('#btnProfNew').addEventListener('click', () => {
    const p = Object.assign({}, C.BASE_RULES, { id: C.uid(), name: 'Neues Profil', aliases: '' });
    state.profiles.push(p);
    editProfId = p.id;
    commit();
  });
  $('#btnProfDup').addEventListener('click', () => {
    const p = Object.assign(C.clone(editProf()), { id: C.uid() });
    p.name += ' (Kopie)';
    state.profiles.push(p);
    editProfId = p.id;
    commit();
  });
  $('#btnProfDel').addEventListener('click', () => {
    const p = editProf();
    if (state.profiles.length < 2 || !confirm(`Profil „${p.name}“ löschen?`)) return;
    state.profiles = state.profiles.filter((x) => x !== p);
    if (state.activeProfileId === p.id) C.applyProfile(state, state.profiles[0].id, Date.now());
    editProfId = state.activeProfileId;
    commit();
  });
  $('#btnProfReset').addEventListener('click', () => {
    if (!confirm('Alle Regelprofile auf die Standardwerte zurücksetzen?')) return;
    state.profiles = C.clone(C.DEFAULT_PROFILES);
    const keep = state.profiles.some((p) => p.id === state.activeProfileId) ? state.activeProfileId : 'p-adult';
    C.applyProfile(state, keep, Date.now());
    editProfId = keep;
    commit();
  });

  /* ================= Matten im Netz ================= */

  const net = () => state.settings.net;
  let client = null; // Verbindung dieser Matte zur Zentrale
  let clientState = 'off';
  let hubInfo = null; // laufende Zentrale: { port, addresses }
  let hubError = '';
  const hubMats = new Map(); // Zentrale: verbundene Matten
  let foundHubs = [];
  let bannerDismissed = '';
  let sentResults = new Set();
  let statusTimer = 0;
  let lastStatusAt = 0;
  const appVersion = () => window.HAJIME_VERSION || '';

  const newCode = () => String(Math.floor(1000 + Math.random() * 9000));

  // Matte: Stand an die Zentrale (höchstens einmal pro Sekunde, Ergebnisse nur neue)
  function sendStatus(force) {
    if (!client || clientState !== 'connected') return;
    const now = Date.now();
    if (!force && now - lastStatusAt < 1000) {
      clearTimeout(statusTimer);
      statusTimer = setTimeout(() => sendStatus(true), 1000 - (now - lastStatusAt));
      return;
    }
    lastStatusAt = now;
    const st = N.matStatus(state, upcoming(false), now);
    const sig = (r) => r.id + ':' + JSON.stringify(r.result);
    st.results = st.results.filter((r) => !sentResults.has(sig(r)));
    if (client.send(st)) st.results.forEach((r) => sentResults.add(sig(r)));
  }
  function netChanged() {
    if (client) sendStatus(false);
  }
  setInterval(() => sendStatus(true), 5000);

  function onHubMessage(msg) {
    if (msg.type === 'call') {
      state.callMessage = String(msg.message || '');
      state.callPicks = [];
      commit();
    } else if (msg.type === 'fights') {
      const r = N.mergeFights(state, msg);
      commit();
      importMsg(t('Kampfliste von der Zentrale übernommen: {a} neu, {u} aktualisiert, {r} entfernt.', { a: r.added, u: r.updated, r: r.removed }));
    }
  }

  function connectHub() {
    if (client) client.close();
    client = null;
    clientState = 'off';
    const n = net();
    if (n.role !== 'mat' || !n.address || !n.code) return renderNet();
    sentResults = new Set();
    client = N.connect({
      url: N.wsUrl(n.address),
      code: n.code,
      mat: () => state.settings.mat,
      version: appVersion(),
      onStatus: (s) => {
        clientState = s;
        if (s === 'connected') {
          sentResults = new Set();
          sendStatus(true);
        }
        renderNet();
      },
      onMessage: onHubMessage,
    });
    clientState = client.status();
    renderNet();
  }

  // Zentrale starten/stoppen (nur Desktop-App)
  async function startHub() {
    if (!T.isElectron || !T.bridge.hubStart) return;
    const n = net();
    if (!n.code) {
      n.code = newCode();
      save();
    }
    try {
      hubInfo = await T.bridge.hubStart({ code: n.code, tournament: state.settings.tournament });
      hubError = '';
    } catch (err) {
      hubInfo = null;
      hubError = err.message;
    }
    renderNet();
  }
  async function stopHub() {
    if (T.isElectron && T.bridge.hubStop) await T.bridge.hubStop();
    hubInfo = null;
    hubMats.clear();
    renderNet();
  }

  let hubTournament = null;
  function pushOverview() {
    if (!hubInfo) return;
    // Turniername geändert: Zentrale ruft ihn neu ins Netz
    if (hubTournament !== state.settings.tournament) {
      hubTournament = state.settings.tournament;
      T.bridge.hubStart({ code: net().code, tournament: hubTournament });
    }
    T.bridge.hubOverview(N.overview(state, Array.from(hubMats.values()), Date.now()));
  }
  setInterval(() => {
    if (hubInfo) {
      pushOverview();
      renderNetMats();
    }
  }, 1000);

  if (T.isElectron && T.bridge.onHubEvent) {
    T.bridge.onHubEvent((ev) => {
      const now = Date.now();
      if (ev.type === 'hello') {
        // gleiche Matte neu verbunden: alten Eintrag ersetzen
        hubMats.forEach((m, id) => {
          if (!m.connected && m.mat === ev.mat) hubMats.delete(id);
        });
        hubMats.set(ev.id, { id: ev.id, mat: ev.mat, address: ev.address, connected: true, seenAt: now, status: null, receivedAt: 0 });
      } else if (ev.type === 'gone') {
        const m = hubMats.get(ev.id);
        if (m) m.connected = false;
      } else if (ev.type === 'message') {
        const m = hubMats.get(ev.id) || { id: ev.id, connected: true };
        m.mat = ev.mat;
        m.seenAt = now;
        hubMats.set(ev.id, m);
        if (ev.msg.type === 'status') {
          m.status = ev.msg;
          m.receivedAt = now;
          const n = N.applyResults(state, ev.mat, ev.msg.results);
          if (n) commit();
        }
      }
      renderNetMats();
      pushOverview();
    });
    T.bridge.onHubsFound((list) => {
      foundHubs = list || [];
      renderNet();
    });
  }

  function startNet() {
    const n = net();
    if (T.isElectron && T.bridge.finderStart && n.role !== 'hub') T.bridge.finderStart().then((l) => ((foundHubs = l || []), renderNet()));
    if (n.role === 'hub') startHub();
    if (n.role === 'mat') connectHub();
  }

  const STATUS_TEXT = {
    off: 'Nicht verbunden.',
    connecting: 'Verbinde mit der Zentrale …',
    connected: 'Verbunden mit der Zentrale – Ergebnisse werden automatisch gemeldet.',
    waiting: 'Keine Verbindung zur Zentrale – neuer Versuch alle paar Sekunden. Die Matte läuft normal weiter, der Stand wird nachgereicht.',
    rejected: 'Die Zentrale hat die Verbindung abgelehnt: falscher Turniercode.',
    closed: 'Getrennt.',
  };

  function renderNet() {
    const n = net();
    setVal($('#netRole'), n.role);
    $('#netRole option[value="hub"]').disabled = !T.isElectron;
    $('#netMatBox').hidden = n.role !== 'mat';
    $('#netHubBox').hidden = n.role !== 'hub';
    setVal($('#netAddress'), n.address);
    setVal($('#netCode'), n.code);
    // gefundene Zentralen
    const found = n.role === 'mat' && T.isElectron ? foundHubs : [];
    const fh = found
      .map((h) => `<div class="net-hub"><b>${esc(h.name)}${h.tournament ? ' · ' + esc(h.tournament) : ''}</b><small class="muted">${esc(h.address)}:${h.port}</small><button class="btn" data-hub="${esc(h.address + ':' + h.port)}">${esc(t('Übernehmen'))}</button></div>`)
      .join('');
    const fEl = $('#netFound');
    if (fEl.dataset.h !== fh) {
      fEl.innerHTML = fh;
      fEl.dataset.h = fh;
    }
    let text = '';
    let cls = '';
    if (n.role === 'mat') {
      text = !n.address || !n.code ? t('Adresse und Turniercode eingeben (oder eine gefundene Zentrale übernehmen).') : t(STATUS_TEXT[clientState] || '');
      cls = clientState === 'connected' ? 'ok' : clientState === 'rejected' ? 'err' : clientState === 'off' || clientState === 'closed' ? '' : 'warn';
    } else if (n.role === 'hub') {
      if (!T.isElectron) {
        text = t('Die Webversion kann keine Zentrale sein – bitte die Desktop-App verwenden.');
        cls = 'err';
      } else if (hubError) {
        text = t('Zentrale konnte nicht gestartet werden: {msg}', { msg: hubError });
        cls = 'err';
      } else if (hubInfo) {
        const c = Array.from(hubMats.values()).filter((m) => m.connected).length;
        text = t('Zentrale läuft – {n} Matten verbunden.', { n: c });
        cls = 'ok';
      } else text = t('Zentrale startet …');
    }
    $('#netStatus').textContent = text;
    $('#netStatus').className = 'net-status ' + cls;
    $('#btnNetDisconnect').disabled = !client;
    $('#netHubCode').textContent = n.code || '–';
    const addr = hubInfo ? hubInfo.addresses.map((a) => `${a}:${hubInfo.port}`) : [];
    $('#netHubAddr').textContent = hubInfo
      ? addr.length
        ? t('Adresse für die Matten: {addr}. Übersicht im Browser: http://{first}/', { addr: addr.join(', '), first: addr[0] })
        : t('Kein Netzwerk gefunden – Rechner mit dem WLAN oder Router verbinden.')
      : '';
    // Punkt am Reiter „Matten“
    const dot = $('#netDot');
    dot.hidden = !(n.role === 'hub' ? hubInfo : n.role === 'mat');
    dot.className = 'net-dot' + (n.role === 'mat' ? (clientState === 'connected' ? '' : clientState === 'rejected' ? ' err' : ' warn') : '');
    // Hinweis „Zentrale gefunden“
    const cand = foundHubs.find((h) => h.key !== bannerDismissed);
    const showBanner = T.isElectron && lvl('tournament') && n.role !== 'hub' && !(n.role === 'mat' && clientState === 'connected') && !!cand && !(n.role === 'mat' && n.address === cand.address + ':' + cand.port);
    $('#netBanner').hidden = !showBanner;
    if (showBanner) {
      $('#netBannerText').textContent = t('Zentrale „{name}“ im Netz gefunden – diese Matte verbinden?', { name: cand.name + (cand.tournament ? ' · ' + cand.tournament : '') });
      $('#netBanner').dataset.hub = cand.key;
    }
    renderNetMats();
  }

  function renderNetMats() {
    const show = net().role === 'hub';
    $('#netCard').hidden = !show;
    if (!show) return;
    const now = Date.now();
    const list = Array.from(hubMats.values()).sort((a, b) => String(a.mat).localeCompare(String(b.mat), 'de', { numeric: true }));
    const counts = new Map();
    list.forEach((m) => m.connected && counts.set(m.mat, (counts.get(m.mat) || 0) + 1));
    $('#netMatCount').textContent = list.filter((m) => m.connected).length || '';
    $('#netCardInfo').textContent = hubInfo ? t('Turniercode {code}', { code: net().code }) : '';
    $('#btnNetOverview').disabled = !hubInfo;
    const html = list.length
      ? list
          .map((m) => {
            const s = m.status || {};
            const c = s.current;
            const cur = c && c.named ? `${esc(c.cls)}${c.no ? ' · #' + esc(c.no) : ''}: ${esc(c.white.name || t('Weiß'))} – ${esc(c.blue.name || t('Blau'))}` : esc(t('kein Kampf geladen'));
            const nx = (s.next || [])[0];
            const ago = Math.round((now - (m.seenAt || now)) / 1000);
            const dup = counts.get(m.mat) > 1 ? `<small class="warn">${esc(t('Mattenname doppelt!'))}</small>` : '';
            return `<div class="net-mat${m.connected ? '' : ' off'}" data-net="${esc(m.id)}">
              <div class="nm-head"><b>${esc(m.mat || '?')}</b>${dup}<small>${m.connected ? esc(t('{open} offen · {done} beendet', { open: s.open || 0, done: s.done || 0 })) : esc(t('getrennt seit {s} s', { s: ago }))}</small></div>
              <div class="nm-cur">${cur}</div>
              ${nx ? `<div class="nm-next">${esc(t('danach'))}: ${esc(nx.white.name || '?')} – ${esc(nx.blue.name || '?')}</div>` : ''}
              <div class="nm-call"><input placeholder="${esc(t('Aufruf an diese Matte'))}" data-callin="${esc(m.id)}" ${m.connected ? '' : 'disabled'} /><button class="btn" data-callsend="${esc(m.id)}" ${m.connected ? '' : 'disabled'}>${esc(t('Senden'))}</button></div>
              <div class="btnrow"><button class="btn" data-sendfights="${esc(m.id)}" ${m.connected ? '' : 'disabled'} title="${esc(t('Kämpfe dieser Matte aus der Kampfliste der Zentrale übertragen'))}">${esc(t('Kampfliste senden'))}</button>${
                m.connected ? '' : `<button class="btn" data-netdel="${esc(m.id)}">${esc(t('Entfernen'))}</button>`
              }</div>
            </div>`;
          })
          .join('')
      : `<p class="muted">${esc(t('Noch keine Matte verbunden. An den Mattenrechnern unter Einstellungen → Matten im Netz „Matte“ wählen und diesen Turniercode eingeben.'))}</p>`;
    const box = $('#netMats');
    // Eingabe im Aufruffeld nicht durch Neuzeichnen stören
    if (box.contains(document.activeElement) && document.activeElement.tagName === 'INPUT') return;
    if (box.dataset.h !== html) {
      box.innerHTML = html;
      box.dataset.h = html;
    }
  }

  $('#netRole').addEventListener('change', async (e) => {
    const n = net();
    const prev = n.role;
    n.role = e.target.value;
    if (prev === 'hub' && n.role !== 'hub') await stopHub();
    if (prev === 'mat' && n.role !== 'mat' && client) {
      client.close();
      client = null;
      clientState = 'off';
    }
    if (n.role === 'hub') {
      n.code = n.code || newCode();
      startHub();
    }
    if (n.role !== 'hub' && T.isElectron && T.bridge.finderStart) T.bridge.finderStart().then((l) => ((foundHubs = l || []), renderNet()));
    commit();
    if (n.role === 'mat') connectHub();
  });
  $('#netAddress').addEventListener('change', (e) => {
    net().address = e.target.value.trim();
    commit();
  });
  $('#netCode').addEventListener('change', (e) => {
    net().code = e.target.value.trim();
    commit();
  });
  $('#btnNetConnect').addEventListener('click', () => {
    net().address = $('#netAddress').value.trim();
    net().code = $('#netCode').value.trim();
    commit();
    connectHub();
  });
  $('#btnNetDisconnect').addEventListener('click', () => {
    if (client) client.close();
    client = null;
    clientState = 'off';
    renderNet();
  });
  $('#netFound').addEventListener('click', (e) => {
    const b = e.target.closest('[data-hub]');
    if (!b) return;
    net().address = b.dataset.hub;
    commit();
    if (net().code) connectHub();
    else $('#netCode').focus();
  });
  $('#btnNetNewCode').addEventListener('click', () => {
    if (!confirm(t('Neuen Turniercode erzeugen? Verbundene Matten müssen danach den neuen Code eingeben.'))) return;
    net().code = newCode();
    commit();
    startHub();
  });
  $('#btnNetOverview').addEventListener('click', () => {
    if (!hubInfo) return;
    const url = `http://${hubInfo.addresses[0] || '127.0.0.1'}:${hubInfo.port}/`;
    if (T.bridge.openExternal) T.bridge.openExternal(url);
    else window.open(url, '_blank');
  });
  $('#netMats').addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.netdel) {
      hubMats.delete(b.dataset.netdel);
      renderNetMats();
      return pushOverview();
    }
    const id = b.dataset.callsend || b.dataset.sendfights;
    const m = id && hubMats.get(id);
    if (!m) return;
    if (b.dataset.callsend) {
      const inp = $(`[data-callin="${CSS.escape(id)}"]`);
      const msg = inp ? inp.value.trim() : '';
      await T.bridge.hubSend(id, { type: 'call', message: msg });
      if (inp) inp.value = '';
      b.blur();
    } else {
      const msg = N.fightsFor(state, m.mat);
      if (!msg.entries.length) return alert(t('In der Kampfliste der Zentrale gibt es keine Kämpfe für „{mat}“. Erst unter „Matten“ verteilen.', { mat: m.mat }));
      if (!confirm(t('{n} Kämpfe an „{mat}“ senden? Offene Kämpfe dort werden ersetzt, beendete bleiben.', { n: msg.entries.length, mat: m.mat }))) return;
      await T.bridge.hubSend(id, msg);
    }
  });
  $('#netMats').addEventListener('keydown', (e) => {
    const inp = e.target.closest('[data-callin]');
    if (inp && e.key === 'Enter') {
      e.preventDefault();
      $(`[data-callsend="${CSS.escape(inp.dataset.callin)}"]`).click();
    }
  });
  // Banner „Zentrale gefunden – verbinden?“
  $('#btnNetBannerNo').addEventListener('click', () => {
    bannerDismissed = $('#netBanner').dataset.hub;
    renderNet();
  });
  $('#btnNetBannerYes').addEventListener('click', () => {
    const h = foundHubs.find((x) => x.key === $('#netBanner').dataset.hub);
    if (!h) return;
    $('#dlgNetCodeInfo').textContent = `${h.name}${h.tournament ? ' · ' + h.tournament : ''} (${h.address}:${h.port})`;
    $('#dlgNetCodeVal').value = net().code || '';
    $('#dlgNetMat').value = state.settings.mat || '';
    $('#dlgNetCode').dataset.hub = h.address + ':' + h.port;
    $('#dlgNetCode').showModal();
    $('#dlgNetCodeVal').focus();
  });
  $('#dlgNetCode').addEventListener('close', () => {
    const dlg = $('#dlgNetCode');
    if (dlg.returnValue !== 'ok') return;
    const code = $('#dlgNetCodeVal').value.trim();
    if (!code) return;
    const n = net();
    n.role = 'mat';
    n.address = dlg.dataset.hub;
    n.code = code;
    const mat = $('#dlgNetMat').value.trim();
    if (mat) state.settings.mat = mat;
    commit();
    connectHub();
  });

  /* ================= Mannschaftskampf ================= */

  const TEAM_FIELDS = { tmTitle: 'title', tmAge: 'ageClass', tmWhite: 'white.name', tmBlue: 'blue.name' };
  Object.entries(TEAM_FIELDS).forEach(([id, key]) => {
    document.getElementById(id).addEventListener('change', (e) => {
      const [a, b] = key.split('.');
      if (b) state.team[a][b] = e.target.value.trim();
      else state.team[a] = e.target.value.trim();
      commit();
    });
  });
  $('#tmActive').addEventListener('change', (e) => {
    state.team.active = e.target.checked;
    if (!e.target.checked) {
      // Einzelkämpfe ohne Ergebnis aus der Kampfliste nehmen, Ergebnisse bleiben im Protokoll
      const open = state.queue.filter((q) => q.team === state.team.id && (q.status !== 'done' || (q.result && q.result.auto)));
      if (open.length) state.queue = state.queue.filter((q) => !open.includes(q));
    }
    commit();
  });
  $('#tmClasses').addEventListener('change', (e) => {
    const list = e.target.value.split(/[,;\n]/).map((x) => x.trim()).filter(Boolean);
    if (!list.length) return renderTeam(true);
    const cur = order()[0];
    state.team.classes = list;
    state.team.start = Math.max(0, list.indexOf(cur));
    commit();
  });
  const order = () => TM.order(state.team);
  $('#tmStart').addEventListener('change', (e) => {
    state.team.start = Number(e.target.value) || 0;
    commit();
  });
  $('#tmLegs').addEventListener('change', (e) => {
    state.team.legs = e.target.checked ? 2 : 1;
    // Rückrunde: Aufstellung der Hinrunde als Vorschlag übernehmen
    const [l1, l2] = state.team.lineup;
    if (e.target.checked && !Object.keys(l2.white).length && !Object.keys(l2.blue).length) state.team.lineup[1] = C.clone(l1);
    commit();
  });
  $('#tmRule').addEventListener('change', (e) => {
    state.team.rule = e.target.value;
    commit();
  });
  $$('[data-tp]').forEach((el) =>
    el.addEventListener('change', () => {
      state.team.points[el.dataset.tp] = Math.max(0, Math.round(Number(el.value) || 0));
      commit();
    })
  );
  $('#tmTable').addEventListener('change', (e) => {
    const inp = e.target.closest('input[data-leg]');
    if (!inp) return;
    const lu = state.team.lineup[Number(inp.dataset.leg) - 1];
    lu[inp.dataset.side][inp.dataset.cls] = inp.value.trim();
    commit();
  });
  $('#tmTable').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-tmload]');
    if (!b) return;
    const entry = state.queue.find((q) => q.id === b.dataset.tmload);
    if (!entry) return;
    if (state.fight.queueId !== entry.id && fightBusy() && !confirm(t('Der aktuelle Kampf ist noch nicht beendet. Trotzdem diesen Kampf laden?'))) return;
    if (entry.status === 'done' && !confirm(t('Dieser Kampf ist bereits beendet. Erneut laden (Ergebnis wird überschrieben)?'))) return;
    requestLoad(entry, () => $('.tabs button[data-tab="fight"]').click());
  });

  function renderTeam(force) {
    const tm = state.team;
    $('#tmActive').checked = !!tm.active;
    Object.entries(TEAM_FIELDS).forEach(([id, key]) => {
      const [a, b] = key.split('.');
      const v = b ? tm[a][b] : tm[a];
      const el = document.getElementById(id);
      if (force || document.activeElement !== el) el.value = v || '';
    });
    const clsEl = $('#tmClasses');
    if (force || document.activeElement !== clsEl) clsEl.value = tm.classes.join(', ');
    const startOpts = tm.classes.map((c, i) => `<option value="${i}">${esc(c)}</option>`).join('');
    const st = $('#tmStart');
    if (st.dataset.h !== startOpts) {
      st.innerHTML = startOpts;
      st.dataset.h = startOpts;
    }
    st.value = String(tm.start);
    $('#tmLegs').checked = tm.legs === 2;
    $('#tmRule').value = tm.rule;
    $$('[data-tp]').forEach((el) => {
      if (document.activeElement !== el) el.value = String(tm.points[el.dataset.tp]);
    });
    $('#tmHeadW').textContent = tm.white.name || t('Weiß');
    $('#tmHeadB').textContent = tm.blue.name || t('Blau');
    // Stand
    const sc = TM.score(state);
    const res = sc.winner === 'draw' ? t('Unentschieden') : sc.winner ? t('Sieger: {name}', { name: tm[sc.winner].name || t(sc.winner === 'white' ? 'Weiß' : 'Blau') }) : t('{n} von {m} Kämpfen', { n: sc.done, m: sc.total });
    const scoreHtml = `<div class="tm-w">${esc(tm.white.name || t('Weiß'))}<small>${esc(t('{wins} Siege · {points} Wertungspunkte', { wins: sc.white.wins, points: sc.white.points }))}</small></div>
      <div class="tm-mid">${sc.white.wins} : ${sc.blue.wins}<small>${esc(res)}</small></div>
      <div class="tm-b">${esc(tm.blue.name || t('Blau'))}<small>${esc(t('{wins} Siege · {points} Wertungspunkte', { wins: sc.blue.wins, points: sc.blue.points }))}</small></div>`;
    const sEl = $('#tmScore');
    if (sEl.dataset.h !== scoreHtml) {
      sEl.innerHTML = scoreHtml;
      sEl.dataset.h = scoreHtml;
    }
    // Aufstellung: Zeilen in Kampfreihenfolge, Ergebnisse aus der Kampfliste
    const rows = TM.plan(tm);
    const byId = new Map(sc.rows.map((r) => [r.id, r]));
    const html = rows
      .map((p, i) => {
        const r = byId.get(p.id);
        const entry = state.queue.find((q) => q.id === p.id);
        const cur = entry && entry.id === state.fight.queueId;
        const res = r && r.winner ? `<b>${esc(r.winner === 'draw' ? t('Unentschieden') : tm[r.winner].name || t(r.winner === 'white' ? 'Weiß' : 'Blau'))}</b><br><small>${esc(TM.rowResult(r, t))}</small>` : cur ? `<small>${esc(t('läuft / geladen'))}</small>` : r && r.status === 'skipped' ? `<small>${esc(t('entfällt'))}</small>` : '';
        const inp = (side) => `<td class="${p.vacant === side || p.vacant === 'both' ? 'vac' : ''}"><input data-leg="${p.leg}" data-side="${side}" data-cls="${esc(p.category)}" list="dlNames" placeholder="${esc(t('nicht besetzt'))}" autocomplete="off" /></td>`;
        const legStart = i > 0 && rows[i - 1].leg !== p.leg;
        const canLoad = tm.active && entry && !(r && r.auto) && entry.status !== 'skipped';
        return `<tr class="${legStart ? 'leg-start' : ''}${cur ? ' current' : ''}"><td>${esc(p.no)}${p.round ? `<br><small>${esc(t(p.round))}</small>` : ''}</td><td>${esc(p.category)}</td>${inp('white')}${inp('blue')}<td>${res}</td><td class="acts"><button class="load" data-tmload="${esc(p.id)}" ${canLoad ? '' : 'disabled'}>${esc(t('Laden'))}</button></td></tr>`;
      })
      .join('');
    const tb = $('#tmTable tbody');
    if (tb.dataset.h !== html) {
      tb.innerHTML = html;
      tb.dataset.h = html;
    }
    $$('input[data-leg]', tb).forEach((el) => {
      if (!force && document.activeElement === el) return;
      const v = tm.lineup[Number(el.dataset.leg) - 1][el.dataset.side][el.dataset.cls] || '';
      if (el.value !== v) el.value = v;
    });
  }

  $('#btnTmTemplate').addEventListener('click', () => T.saveFile(t('Hajime-Mannschaft-Vorlage') + '.xlsx', new Uint8Array(X.teamTemplateBytes(t))));
  $('#btnTmImport').addEventListener('click', () => $('#fileTm').click());
  $('#fileTm').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const msg = (text, err) => {
      $('#tmMsg').textContent = text;
      $('#tmMsg').classList.toggle('err', !!err);
    };
    try {
      const res = await X.importFile(file);
      const lu = X.teamFromFights(res.fights);
      if (!lu.classes.length) return msg(t('In der Datei wurde keine Aufstellung erkannt (Spalten „Gewichtsklasse“, „Weiß Name“, „Blau Name“).'), true);
      const tm = state.team;
      tm.classes = lu.classes;
      tm.start = 0;
      tm.legs = lu.legs;
      tm.lineup = lu.lineup;
      if (lu.white) tm.white.name = lu.white;
      if (lu.blue) tm.blue.name = lu.blue;
      if (lu.ageClass) tm.ageClass = lu.ageClass;
      commit();
      renderTeam(true);
      msg(t('„{file}“ importiert – {n} Gewichtsklassen.', { file: file.name, n: lu.classes.length }));
    } catch (err) {
      msg(t('Import fehlgeschlagen: {msg}', { msg: err.message }), true);
    }
  });
  const teamFile = () => fileSafe([state.team.white.name, state.team.blue.name].filter(Boolean).join('-') || t('Mannschaftskampf'));
  $('#btnTmPdf').addEventListener('click', () => {
    printDoc(`${t('Hajime-Ergebnisbogen')}-${teamFile()}.pdf`, TM.sheetHtml(state, { t, settings: state.settings }), 'A4', false);
  });
  $('#btnTmXlsx').addEventListener('click', () => {
    const bytes = X.teamBytes({ team: state.team, score: TM.score(state), t, reasonText: (r) => C.reasonText(r, t) });
    T.saveFile(`${t('Hajime-Ergebnisbogen')}-${teamFile()}.xlsx`, new Uint8Array(bytes));
  });
  $('#btnTmNew').addEventListener('click', () => {
    if (!confirm(t('Neue Begegnung anlegen? Aufstellung und offene Einzelkämpfe werden entfernt, Mannschaften, Gewichtsklassen und Wertung bleiben.'))) return;
    const old = state.team;
    state.queue = state.queue.filter((q) => q.team !== old.id || (q.status === 'done' && !(q.result && q.result.auto)));
    const tm = TM.normTeam({ white: old.white, blue: old.blue, classes: old.classes, legs: old.legs, points: old.points, rule: old.rule, ageClass: old.ageClass, active: old.active });
    state.team = tm;
    commit();
    renderTeam(true);
  });

  /* ================= Training ================= */

  function initTraining() {
    if (!state.training || !state.training.current || !Array.isArray(state.training.templates)) state.training = TR.createTraining();
    const tr = state.training;
    tr.current = TR.normTemplate(tr.current);
    tr.templates = tr.templates.map(TR.normTemplate);
    if (!tr.run) tr.run = TR.newRun();
    // nach einem Neustart läuft das Training nicht von selbst weiter
    if (tr.run.running) {
      const at = state.savedAt || Date.now();
      tr.run.leftMs = Math.max(0, tr.run.endsAt - at);
      tr.run.running = false;
    }
    tr.run.sound = null;
  }

  function trainingAct(fn) {
    const now = Date.now();
    if (fn(state.training, now) === false) return;
    if (state.training.run.running || state.training.run.phase !== 'ready') state.screen = 'training';
    commit();
  }

  const TR_FIELDS = {
    trName: ['name', 'text'],
    trRound: ['round', 'time'],
    trPause: ['pause', 'time'],
    trRounds: ['rounds', 'number'],
    trRoundNote: ['roundNote', 'text'],
    trPauseNote: ['pauseNote', 'text'],
    trSignal: ['signalOnly', 'check'],
  };
  Object.entries(TR_FIELDS).forEach(([id, [key, kind]]) => {
    const el = document.getElementById(id);
    el.addEventListener(kind === 'text' ? 'input' : 'change', () => {
      const cur = state.training.current;
      let v;
      if (kind === 'check') v = el.checked;
      else if (kind === 'time') {
        v = parseTime(el.value);
        if (v == null) return renderTraining(true);
      } else if (kind === 'number') v = Number(el.value);
      else v = el.value;
      state.training.current = TR.normTemplate(Object.assign({}, cur, { [key]: v }));
      if (kind !== 'text') renderTraining(true);
      commit();
    });
  });

  function renderTraining(force) {
    const tr = state.training;
    const cur = tr.current;
    const sel = $('#trTplSelect');
    const known = tr.templates.some((x) => x.id === cur.id);
    const opts = (known ? '' : `<option value="">${esc(t('(nicht gespeichert)'))}</option>`) + tr.templates.map((x) => `<option value="${esc(x.id)}">${esc(x.name)} – ${esc(TR.summary(x, t))}</option>`).join('');
    if (sel.dataset.h !== opts) {
      sel.innerHTML = opts;
      sel.dataset.h = opts;
    }
    sel.value = known ? cur.id : '';
    Object.entries(TR_FIELDS).forEach(([id, [key, kind]]) => {
      const el = document.getElementById(id);
      if (!force && document.activeElement === el) return;
      if (kind === 'check') el.checked = !!cur[key];
      else el.value = kind === 'time' ? fmtSec(cur[key]) : String(cur[key]);
    });
    const saved = tr.templates.find((x) => x.id === cur.id);
    $('#btnTrSave').disabled = !!saved && JSON.stringify(saved) === JSON.stringify(cur);
    $('#btnTrDel').disabled = !saved || tr.templates.length < 2;
    const r = tr.run;
    const b = $('#btnTrStart');
    const label = r.running ? t('Pause') : r.phase === 'ready' ? t('Start') : r.phase === 'done' ? t('Neu starten') : t('Weiter');
    const html = `${esc(label)} <kbd>${esc(t('Leertaste'))}</kbd>`;
    if (b.innerHTML !== html) b.innerHTML = html;
    b.classList.toggle('mate', r.running);
    $('#btnTrBoard').classList.toggle('on', state.screen === 'training');
    $('#trainBanner').hidden = state.screen !== 'training';
  }

  $('#trTplSelect').addEventListener('change', (e) => {
    const tpl = state.training.templates.find((x) => x.id === e.target.value);
    if (!tpl) return;
    const r = state.training.run;
    if (r.phase !== 'ready' && r.phase !== 'done' && !confirm(t('Das laufende Training wird zurückgesetzt. Vorlage trotzdem laden?'))) return renderTraining(true);
    state.training.current = TR.normTemplate(tpl);
    TR.reset(state.training);
    commit();
    renderTraining(true);
  });
  $('#btnTrSave').addEventListener('click', () => {
    const tr = state.training;
    const i = tr.templates.findIndex((x) => x.id === tr.current.id);
    if (i >= 0) tr.templates[i] = TR.normTemplate(tr.current);
    else tr.templates.push(TR.normTemplate(tr.current));
    commit();
  });
  $('#btnTrNew').addEventListener('click', () => {
    const tr = state.training;
    const copy = TR.normTemplate(Object.assign({}, tr.current, { id: '' }));
    if (tr.templates.some((x) => x.name === copy.name)) copy.name += ' ' + t('(Kopie)');
    tr.templates.push(copy);
    tr.current = TR.normTemplate(copy);
    commit();
    renderTraining(true);
  });
  $('#btnTrDel').addEventListener('click', () => {
    const tr = state.training;
    if (tr.templates.length < 2 || !confirm(t('Vorlage „{name}“ löschen?', { name: tr.current.name }))) return;
    tr.templates = tr.templates.filter((x) => x.id !== tr.current.id);
    tr.current = TR.normTemplate(Object.assign({}, tr.current, { id: '' }));
    commit();
  });
  $('#btnTrStart').addEventListener('click', () => trainingAct((tr, now) => TR.toggle(tr, now)));
  $('#btnTrPrev').addEventListener('click', () => trainingAct((tr, now) => TR.skip(tr, -1, now)));
  $('#btnTrNext').addEventListener('click', () => trainingAct((tr, now) => TR.skip(tr, 1, now)));
  $('#btnTrReset').addEventListener('click', () => {
    TR.reset(state.training);
    commit();
  });
  $('#btnTrBoard').addEventListener('click', () => {
    state.screen = state.screen === 'training' ? 'board' : 'training';
    commit();
  });
  $('#btnTrBack').addEventListener('click', () => {
    if (state.training.run.running) TR.pause(state.training, Date.now());
    state.screen = 'board';
    commit();
  });

  /* ================= Umfang und Sprache ================= */

  const LEVEL_INFO = {
    simple: 'Nur Anzeigetafel: Uhr, Wertungen, Shido und Osaekomi. Namen, Kampfliste, Protokoll und Turnierfunktionen sind ausgeblendet.',
    standard: 'Kämpfe mit Namen: Kampfliste, Excel-Import, Mannschaftskampf, Aushang und Protokoll. Ohne Turniersysteme, Matten, Auswertung und Aufruf.',
    tournament: 'Alle Funktionen: Turniersysteme, Matten, Vernetzung, Auswertung, Urkunden und Aufruf.',
  };
  function renderLevel() {
    const lv = state.settings.level || 'tournament';
    C.LEVELS.forEach((l) => document.body.classList.toggle('lvl-' + l, l === lv));
    $('#levelInfo').textContent = t(LEVEL_INFO[lv]);
    // ausgeblendeter Reiter offen? Dann zurück zum Kampf
    const active = $('.tabs button.active');
    if (active && active.dataset.min && !lvl(active.dataset.min)) $('.tabs button[data-tab="fight"]').click();
  }

  function langOptions(first) {
    return [`<option value="">${esc(first)}</option>`].concat(I18n.languages().map((l) => `<option value="${esc(l.id)}">${esc(l.name)}</option>`)).join('');
  }
  function fillLangSelects() {
    const sys = I18n.languages().find((l) => l.id === I18n.detect());
    const set = (el, html) => {
      if (el.dataset.h !== html) {
        el.innerHTML = html;
        el.dataset.h = html;
      }
    };
    set($('#sLangControl'), langOptions(t('Automatisch') + (sys ? ` (${sys.name})` : '')));
    set($('#sLangBoard'), langOptions(t('wie die Bedienung')));
    set($('#dlgLevelLang'), langOptions(t('Automatisch') + (sys ? ` (${sys.name})` : '')));
    setVal($('#dlgLevelLang'), state.settings.langControl || '');
  }

  // Sprache gewechselt: feste Texte neu übersetzen, Hauptprozess (Menü, Dialoge) informieren
  let shownLang = null;
  function applyLang() {
    const want = I18n.resolve(state.settings.langControl);
    if (shownLang === want) return;
    shownLang = want;
    t = I18n.make(state.settings.langControl);
    C.setTranslator(t);
    document.documentElement.lang = want;
    I18n.translateDom(document.body, t);
    document.title = t('Hajime – Bedienung');
    if (T.isElectron && T.bridge.setLang) T.bridge.setLang(want);
  }

  // Erster Start: Umfang abfragen
  function askLevel() {
    const dlg = $('#dlgLevel');
    fillLangSelects();
    dlg.addEventListener('cancel', (e) => e.preventDefault());
    $('#dlgLevelLang').addEventListener('change', (e) => {
      state.settings.langControl = e.target.value;
      commit();
    });
    $$('.level-opt', dlg).forEach((b) =>
      b.addEventListener('click', () => {
        state.settings.level = b.dataset.level;
        dlg.close();
        commit();
      })
    );
    dlg.showModal();
  }

  /* ================= Start ================= */

  function renderAll() {
    applyLang();
    renderLevel();
    renderFight();
    renderTraining();
    renderTeam();
    renderNet();
    renderQueue();
    renderParticipants();
    renderMats();
    renderCall();
    renderEval();
    renderLog();
    renderSettings();
    renderProfiles();
    renderDatalists();
  }

  commit();
  requestAnimationFrame(frame);
  if (!state.settings.level) askLevel();
  startNet();
  // für Fehlersuche und das Screenshot-Skript
  window.__judo = {
    get state() {
      return state;
    },
    set state(v) {
      state = v;
      history = [];
    },
    commit,
  };
})();
