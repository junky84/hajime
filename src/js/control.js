/* Bedienfenster: hält den Zustand, wertet Eingaben aus und schickt die Ansicht an die Anzeige. */
(function () {
  'use strict';
  const C = window.JudoCore;
  const T = window.JudoTransport;
  const X = window.JudoExcel;
  const S = window.JudoSound;
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
  let lastSoundKey = state.fight.sound ? state.fight.id + ':' + state.fight.sound.id : null;
  const preview = window.JudoBoard.mount($('#preview'), { preview: true });

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

  function nextEntries(max) {
    const q = state.queue;
    const cur = q.findIndex((e) => e.id === state.fight.queueId);
    const order = cur >= 0 ? q.slice(cur + 1).concat(q.slice(0, cur)) : q;
    return order.filter((e) => e.status !== 'done' && e.id !== state.fight.queueId).slice(0, max);
  }

  function view() {
    return {
      fight: state.fight,
      rules: C.getRules(state),
      settings: state.settings,
      screen: state.screen,
      next: nextEntries(6).map((e) => ({ white: e.white, blue: e.blue, ageClass: e.ageClass, category: e.category, no: e.no })),
    };
  }

  function publish() {
    const v = view();
    preview.update(v);
    T.send(v);
  }

  function commit() {
    syncQueueAndLog();
    save();
    publish();
    renderAll();
    checkSound();
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
    const running = C.clockRunning(f.clock) || !!f.osae.side;
    if (f.status === 'running' && !running) f.status = 'paused';
    if ((f.status === 'paused' || f.status === 'ready') && running) f.status = 'running';
    state.fight = f;
    state.activeProfileId = prev.activeProfileId;
    C.reevaluate(state, Date.now());
    commit();
  }

  function checkSound() {
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
        e.result = { fightId: f.id, winner: f.winner, reason: f.reason, white: C.scoreText(f.white, r), blue: C.scoreText(f.blue, r) };
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
        category: f.category,
        white: { name: f.white.name, club: f.white.club },
        blue: { name: f.blue.name, club: f.blue.club },
        whiteScore: C.scoreText(f.white, r),
        blueScore: C.scoreText(f.blue, r),
        winner: f.winner,
        winnerName: f.winner === 'draw' ? 'Unentschieden' : C.displayName(f[f.winner], f.winner),
        reason: f.reason,
        duration: C.formatClock(C.fightTimeMs(f, f.finishedAt), 'golden'),
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
    history = [];
    commit();
  }

  function nextFight() {
    if (fightBusy() && !confirm('Der aktuelle Kampf ist noch nicht beendet. Trotzdem zum nächsten Kampf wechseln?')) return;
    loadEntry(nextEntries(1)[0] || null);
  }

  function resetFight() {
    if (fightBusy() && !confirm('Kampf wirklich zurücksetzen? Wertungen und Zeit gehen verloren.')) return;
    const f = state.fight;
    const entry = {
      id: f.queueId,
      no: f.no,
      ageClass: f.ageClass,
      category: f.category,
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
    if (k === 'Space') act((now) => C.hajimeMate(state, now), true);
    else if (k === 'KeyT') act((now) => C.toketa(state, now), true);
    else if (k === 'KeyA') act((now) => C.startOsae(state, 'white', now), true);
    else if (k === 'KeyL') act((now) => C.startOsae(state, 'blue', now), true);
    else if (KEYS[k]) score(KEYS[k][0], KEYS[k][1], e.shiftKey ? -1 : 1);
    else if (k === 'ArrowUp') act((now) => C.adjustClock(state, 1000, now), false);
    else if (k === 'ArrowDown') act((now) => C.adjustClock(state, -1000, now), false);
    else if (k === 'KeyN') nextFight();
    else if (k === 'KeyB') toggleIdle();
    else handled = false;
    if (handled) e.preventDefault();
  });

  if (T.isElectron && T.bridge.onMenu) {
    T.bridge.onMenu((cmd) => {
      if (cmd === 'undo') {
        const a = document.activeElement;
        if (a && /INPUT|TEXTAREA/.test(a.tagName)) document.execCommand('undo');
        else undo();
      }
    });
  }

  /* ================= Uhren-Takt ================= */

  setInterval(() => {
    if (C.tick(state, Date.now())) commit();
  }, 40);
  setInterval(() => {
    const f = state.fight;
    if (C.clockRunning(f.clock) || f.osae.side) saveNow();
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
    $('.dec.x').style.display = f.manual ? '' : 'none';
    $('#btnUndo').disabled = !history.length;
    $('#btnIdle').classList.toggle('on', state.screen === 'idle');
    const nx = nextEntries(1)[0];
    $('#btnNext').title = nx ? `Nächster: ${nx.white.name || '?'} – ${nx.blue.name || '?'}` : 'Leerer neuer Kampf';
  }

  /* ================= Anzeige-Fenster ================= */

  function toggleIdle() {
    state.screen = state.screen === 'idle' ? 'board' : 'idle';
    commit();
  }
  $('#btnIdle').addEventListener('click', toggleIdle);

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
    displaySelect.style.display = 'none';
    $('#btnBoardFs').style.display = 'none';
    T.setOnNeedView(publish);
    $('#btnBoardShow').addEventListener('click', () => {
      if (!T.openBoardBrowser()) alert('Das Anzeige-Fenster wurde vom Browser blockiert. Bitte Pop-ups für diese Seite erlauben.');
      setTimeout(publish, 300);
    });
    setInterval(() => {
      const open = T.boardOpen();
      const el = $('#boardState');
      el.textContent = open ? '● Anzeige offen (Doppelklick = Vollbild)' : '○ Anzeige geschlossen';
      el.classList.toggle('on', open);
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

  function personCell(p) {
    return `${esc(p.name || '–')}${p.club ? `<br><small>${esc(p.club)}</small>` : ''}`;
  }

  function renderQueue() {
    const tb = $('#queueTable tbody');
    const html = state.queue
      .map((e, i) => {
        const cur = e.id === state.fight.queueId;
        let res = '';
        if (e.result) {
          const wn = e.result.winner === 'draw' ? 'Unentschieden' : e.result.winner === 'white' ? e.white.name || 'Weiß' : e.blue.name || 'Blau';
          res = `<span class="win">${esc(wn)}</span><br><small>${esc(e.result.reason)}</small>`;
        } else if (cur) res = '<small>läuft / geladen</small>';
        return `<tr class="${cur ? 'current' : ''} ${e.status === 'done' ? 'done' : ''}" data-id="${esc(e.id)}">
          <td>${esc(e.no || i + 1)}</td>
          <td>${esc([e.ageClass, e.category].filter(Boolean).join(' '))}</td>
          <td>${personCell(e.white)}</td>
          <td>${personCell(e.blue)}</td>
          <td>${res}</td>
          <td class="acts">
            <button class="load" data-a="load" title="In den Kampf laden">Laden</button>
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
    const open = state.queue.filter((e) => e.status !== 'done').length;
    $('#queueCount').textContent = state.queue.length ? `${open}/${state.queue.length}` : '';
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
      entry.status = 'open';
      entry.result = null;
      loadEntry(entry);
      $('.tabs button[data-tab="fight"]').click();
      return;
    }
    if (a === 'up' && i > 0) state.queue.splice(i - 1, 0, state.queue.splice(i, 1)[0]);
    if (a === 'down' && i < state.queue.length - 1) state.queue.splice(i + 1, 0, state.queue.splice(i, 1)[0]);
    if (a === 'del') state.queue.splice(i, 1);
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

  function groups() {
    const m = new Map();
    state.participants.forEach((p) => {
      const key = [p.ageClass, p.category].filter(Boolean).join(' · ') || 'Ohne Klasse';
      if (!m.has(key)) m.set(key, { key, ageClass: p.ageClass || '', category: p.category || '', people: [] });
      m.get(key).people.push(p);
    });
    return Array.from(m.values()).sort((a, b) => a.key.localeCompare(b.key, 'de', { numeric: true }));
  }

  function renderParticipants() {
    const gs = groups();
    const html =
      (gs.length > 1 ? `<div class="btnrow" style="margin-bottom:8px"><button class="btn" data-rr="*">Alle Gruppen: Jeder gegen jeden</button></div>` : '') +
      gs
        .map((g) => {
          const n = g.people.length;
          const fights = (n * (n - 1)) / 2;
          return `<div class="group"><div class="group-head"><span>${esc(g.key)} <span class="pill">${n}</span></span>
            <button class="btn" data-rr="${esc(g.key)}" ${n < 2 ? 'disabled' : ''}>Jeder gegen jeden (${fights} ${fights === 1 ? 'Kampf' : 'Kämpfe'})</button></div>
            <div class="group-names">${g.people.map((p) => esc(p.name) + (p.club ? ` <small>(${esc(p.club)})</small>` : '')).join(', ')}</div></div>`;
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

  $('#partGroups').addEventListener('click', (e) => {
    const b = e.target.closest('[data-rr]');
    if (!b) return;
    const key = b.dataset.rr;
    const list = groups().filter((g) => key === '*' || g.key === key);
    const exists = list.some((g) => state.queue.some((q) => q.ageClass === g.ageClass && q.category === g.category));
    if (exists && !confirm('Für diese Gruppe(n) stehen schon Kämpfe in der Liste. Trotzdem weitere Paarungen anhängen?')) return;
    let added = 0;
    list.forEach((g) => {
      C.roundRobin(g.people).forEach(([a, b2]) => {
        state.queue.push({
          id: C.uid(),
          no: '',
          ageClass: g.ageClass,
          category: g.category,
          white: { name: a.name, club: a.club || '' },
          blue: { name: b2.name, club: b2.club || '' },
          status: 'open',
          result: null,
        });
        added++;
      });
    });
    importMsg(`${added} Kämpfe zur Kampfliste hinzugefügt.`);
    commit();
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
      if (res.fights.length) {
        const fights = res.fights.map((f) => Object.assign({ id: C.uid(), status: 'open', result: null }, f));
        state.queue = replace ? fights : state.queue.concat(fights);
      }
      if (res.participants.length) state.participants = replace ? res.participants : state.participants.concat(res.participants);
      importMsg(`„${file.name}“ importiert – ${res.sheets.join(', ')}.`);
      commit();
    } catch (err) {
      importMsg('Import fehlgeschlagen: ' + err.message, true);
    }
  });

  $('#btnTemplate').addEventListener('click', () => T.saveFile('Hajime-Import-Vorlage.xlsx', new Uint8Array(X.templateBytes())));
  $('#btnClearQueue').addEventListener('click', () => {
    if (state.queue.length && confirm('Kampfliste komplett leeren?')) {
      state.queue = [];
      commit();
    }
  });
  $('#btnClearParts').addEventListener('click', () => {
    if (state.participants.length && confirm('Teilnehmerliste leeren?')) {
      state.participants = [];
      commit();
    }
  });

  /* ================= Protokoll ================= */

  function renderLog() {
    const tb = $('#logTable tbody');
    const html = state.log
      .slice()
      .reverse()
      .map(
        (l) => `<tr><td>${esc(l.no)}</td><td>${esc(l.time)}</td><td>${esc([l.ageClass, l.category].filter(Boolean).join(' '))}</td>
        <td${l.winner === 'white' ? ' class="win"' : ''}>${esc(l.white.name || 'Weiß')}<br><small>${esc(l.whiteScore)}</small></td>
        <td${l.winner === 'blue' ? ' class="win"' : ''}>${esc(l.blue.name || 'Blau')}<br><small>${esc(l.blueScore)}</small></td>
        <td>${esc(l.winnerName)}</td><td>${esc(l.reason)}</td><td>${esc(l.duration)}</td></tr>`
      )
      .join('');
    if (tb.dataset.h !== html) {
      tb.innerHTML = html;
      tb.dataset.h = html;
    }
    $('#logCount').textContent = state.log.length || '';
  }
  $('#btnExportLog').addEventListener('click', () => {
    const d = new Date();
    const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    T.saveFile(`Hajime-Protokoll-${stamp}.xlsx`, new Uint8Array(X.protocolBytes(state.log)));
  });
  $('#btnClearLog').addEventListener('click', () => {
    if (state.log.length && confirm('Protokoll wirklich leeren? Vorher als Excel speichern!')) {
      state.log = [];
      commit();
    }
  });

  /* ================= Einstellungen ================= */

  const SETTING_INPUTS = {
    sTournament: ['tournament', 'value'],
    sMat: ['mat', 'value'],
    sShowClub: ['showClub', 'checked'],
    sShowNext: ['showNext', 'checked'],
    sFlash: ['flashScores', 'checked'],
    sSwap: ['swap', 'checked'],
    sSound: ['soundOn', 'checked'],
    sSoundTarget: ['soundTarget', 'value'],
  };
  Object.entries(SETTING_INPUTS).forEach(([id, [key, prop]]) => {
    const el = document.getElementById(id);
    el.addEventListener(prop === 'checked' || el.tagName === 'SELECT' ? 'change' : 'input', () => {
      state.settings[key] = el[prop];
      commit();
    });
  });

  function renderSettings() {
    Object.entries(SETTING_INPUTS).forEach(([id, [key, prop]]) => {
      const el = document.getElementById(id);
      if (document.activeElement === el) return;
      if (el[prop] !== state.settings[key]) el[prop] = state.settings[key];
    });
    const img = $('#sLogoPreview');
    const src = state.settings.logo || '';
    if (img.getAttribute('src') !== src) img.setAttribute('src', src);
  }

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
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        // verkleinern, damit Speicher und Übertragung schlank bleiben
        const max = 600;
        const k = Math.min(1, max / Math.max(img.width, img.height));
        const cv = document.createElement('canvas');
        cv.width = Math.round(img.width * k);
        cv.height = Math.round(img.height * k);
        cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
        state.settings.logo = cv.toDataURL('image/png');
        commit();
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
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

  /* ================= Start ================= */

  function renderAll() {
    renderFight();
    renderQueue();
    renderParticipants();
    renderLog();
    renderSettings();
    renderProfiles();
    renderDatalists();
  }

  commit();
  requestAnimationFrame(frame);
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
