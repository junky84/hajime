/*
 * Hajime – Turniersysteme ohne DOM (in Node testbar: test/brackets.test.js).
 *
 * Eine Gruppe (Alters- + Gewichtsklasse) bekommt ein System:
 *   bo3   Best of Three (genau zwei Kämpfer)
 *   rr    Jeder gegen jeden
 *   pool2 Doppel-Pool: zwei Pools, Überkreuz-Halbfinale, Finale
 *   ko    K.-o.-System mit Trostrunde (IJF: Verlierer der Viertelfinals)
 *
 * Gespeichert wird nur { key, ageClass, category, system, players } – players in
 * Setzreihenfolge (Auslosung). Alles andere – Paarungen, Freilose, wer weiterkommt,
 * Platzierungen – ergibt sich daraus und aus den Ergebnissen in der Kampfliste.
 * Jede Paarung („Slot“) steht als Eintrag mit bracket + slot in der Kampfliste,
 * auch wenn die Kämpfer noch nicht feststehen (pending, Platzhalter „Sieger VF 1“).
 */
(function (root) {
  'use strict';
  const C = typeof module !== 'undefined' && module.exports ? require('./core.js') : root.JudoCore;

  const SYSTEMS = { bo3: 'Best of Three', rr: 'Jeder gegen jeden', pool2: 'Doppel-Pool', ko: 'K.-o. mit Trostrunde' };
  const SYSTEM_IDS = ['bo3', 'rr', 'pool2', 'ko'];
  const DEFAULT_LIMITS = { bo3: true, rrMax: 5, poolMax: 8 };
  const BYE = Object.freeze({ bye: true });

  const isOpen = (e) => !!e && e.status !== 'done' && e.status !== 'skipped';

  function limitsOf(l) {
    const x = Object.assign({}, DEFAULT_LIMITS, l);
    x.rrMax = Math.max(2, Math.round(Number(x.rrMax) || 0));
    x.poolMax = Math.max(x.rrMax, Math.round(Number(x.poolMax) || 0));
    x.bo3 = x.bo3 !== false;
    return x;
  }

  function allowed(system, n) {
    if (system === 'bo3') return n === 2;
    if (system === 'rr') return n >= 2;
    if (system === 'pool2') return n >= 4;
    if (system === 'ko') return n >= 3;
    return false;
  }

  // Vorschlag nach Gruppengröße (Grenzen in den Einstellungen)
  function suggest(n, limits) {
    const l = limitsOf(limits);
    if (n < 2) return null;
    if (n === 2) return l.bo3 ? 'bo3' : 'rr';
    if (n <= l.rrMax) return 'rr';
    if (n <= l.poolMax && n >= 4) return 'pool2';
    return 'ko';
  }

  function shuffle(a, rng) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  /*
   * Auslosung mit Vereinstrennung: Kämpfer eines Vereins bekommen aufeinanderfolgende
   * Setzplätze. Die Setzliste verteilt aufeinanderfolgende Plätze auf verschiedene
   * Hälften/Viertel (K.-o.) bzw. abwechselnd auf Pool A und B – so treffen
   * Vereinskameraden möglichst spät aufeinander. Große Vereine zuerst, sonst Zufall.
   */
  function drawOrder(players, rng) {
    rng = rng || Math.random;
    const clubs = new Map();
    players.forEach((p, i) => {
      const k = C.norm(p.club) || '#' + i;
      if (!clubs.has(k)) clubs.set(k, []);
      clubs.get(k).push({ name: String(p.name || '').trim(), club: p.club || '' });
    });
    const list = shuffle(Array.from(clubs.values()), rng).map((g) => shuffle(g, rng));
    list.sort((a, b) => b.length - a.length);
    return list.flat();
  }

  function newBracket(group, system, players, rng) {
    return {
      key: C.groupKey(group),
      ageClass: group.ageClass || '',
      category: group.category || '',
      gender: group.gender || '',
      system,
      players: drawOrder(players, rng),
    };
  }

  /* ---------- Pläne: welche Paarungen gibt es? ---------- */

  // Setzliste für ein Feld der Größe P: 1, 8, 4, 5, 2, 7, 3, 6 …
  function seedOrder(P) {
    let s = [1];
    while (s.length < P) {
      const n = s.length * 2;
      s = s.flatMap((x) => [x, n + 1 - x]);
    }
    return s;
  }

  const ROUND = [
    ['F', 'Finale', 'Finale'],
    ['HF', 'Halbfinale', 'HF'],
    ['VF', 'Viertelfinale', 'VF'],
    ['AF', 'Achtelfinale', 'AF'],
    ['SF', 'Sechzehntelfinale', '1/16'],
  ];

  function koPlan(n) {
    let P = 2;
    while (P < n) P *= 2;
    const rounds = Math.round(Math.log2(P));
    const order = seedOrder(P);
    const ids = [];
    const main = [];
    for (let r = 0; r < rounds; r++) {
      const k = P >> (r + 1);
      const fromEnd = rounds - 1 - r;
      const def = ROUND[fromEnd];
      ids.push([]);
      for (let i = 0; i < k; i++) {
        const id = fromEnd === 0 ? 'F' : def ? def[0] + (i + 1) : `R${r + 1}-${i + 1}`;
        const label = fromEnd === 0 ? 'Finale' : def ? `${def[1]} ${i + 1}` : `Runde ${r + 1} – Kampf ${i + 1}`;
        const short = fromEnd === 0 ? 'Finale' : def ? `${def[2]} ${i + 1}` : `R${r + 1}/${i + 1}`;
        const seed = (pos) => (order[pos] - 1 < n ? { seed: order[pos] - 1 } : { bye: true });
        const slot = {
          id,
          label,
          short,
          phase: 'main',
          col: r,
          fromEnd,
          roundFights: k,
          roundName: fromEnd === 0 ? 'Finale' : def ? def[1] : `Runde ${r + 1}`,
          white: r === 0 ? seed(2 * i) : { win: ids[r - 1][2 * i] },
          blue: r === 0 ? seed(2 * i + 1) : { win: ids[r - 1][2 * i + 1] },
        };
        ids[r].push(id);
        main.push(slot);
      }
    }
    const rep = P >= 8;
    let slots = main;
    if (rep) {
      const qf = ids[rounds - 3];
      const sf = ids[rounds - 2];
      const repSlots = [
        { id: 'TRA', label: 'Trostrunde A', short: 'Trostrunde A', phase: 'rep', white: { lose: qf[0] }, blue: { lose: qf[1] } },
        { id: 'TRB', label: 'Trostrunde B', short: 'Trostrunde B', phase: 'rep', white: { lose: qf[2] }, blue: { lose: qf[3] } },
      ];
      const bronze = [
        { id: 'P3A', label: 'Kampf um Platz 3 (A)', short: 'Platz 3 A', phase: 'bronze', white: { win: 'TRA' }, blue: { lose: sf[1] } },
        { id: 'P3B', label: 'Kampf um Platz 3 (B)', short: 'Platz 3 B', phase: 'bronze', white: { win: 'TRB' }, blue: { lose: sf[0] } },
      ];
      // Reihenfolge wie im Turnier: Vorrunden, Trostrunde, Halbfinale, Platz 3, Finale
      const before = main.filter((s) => s.fromEnd >= 2);
      slots = before.concat(repSlots, main.filter((s) => s.fromEnd === 1), bronze, main.filter((s) => s.fromEnd === 0));
    }
    return { system: 'ko', size: P, rounds, rep, slots };
  }

  function rrPairs(idx) {
    return C.roundRobin(idx.map((i) => ({ i }))).map(([a, b]) => [a.i, b.i]);
  }

  function rrPlan(n) {
    const all = Array.from({ length: n }, (_, i) => i);
    const slots = rrPairs(all).map(([a, b], i) => ({ id: 'R' + (i + 1), label: `Kampf ${i + 1}`, short: `Kampf ${i + 1}`, phase: 'rr', white: { seed: a }, blue: { seed: b } }));
    return { system: 'rr', slots };
  }

  function pool2Plan(n) {
    const pools = { A: [], B: [] };
    for (let i = 0; i < n; i++) pools[i % 2 ? 'B' : 'A'].push(i);
    const fa = rrPairs(pools.A);
    const fb = rrPairs(pools.B);
    const slots = [];
    const counter = { A: 0, B: 0 };
    const add = (p, pair) => {
      counter[p]++;
      slots.push({ id: p + counter[p], label: `Pool ${p} – Kampf ${counter[p]}`, short: `Pool ${p}/${counter[p]}`, phase: 'pool', pool: p, white: { seed: pair[0] }, blue: { seed: pair[1] } });
    };
    // Kämpfe der beiden Pools abwechselnd – gibt den Kämpfern Pausen
    for (let i = 0; i < Math.max(fa.length, fb.length); i++) {
      if (fa[i]) add('A', fa[i]);
      if (fb[i]) add('B', fb[i]);
    }
    slots.push(
      { id: 'HF1', label: 'Halbfinale 1', short: 'HF 1', phase: 'main', col: 0, white: { pool: 'A', place: 1 }, blue: { pool: 'B', place: 2 } },
      { id: 'HF2', label: 'Halbfinale 2', short: 'HF 2', phase: 'main', col: 0, white: { pool: 'B', place: 1 }, blue: { pool: 'A', place: 2 } },
      { id: 'F', label: 'Finale', short: 'Finale', phase: 'main', col: 1, white: { win: 'HF1' }, blue: { win: 'HF2' } }
    );
    return { system: 'pool2', pools, slots };
  }

  function bo3Plan() {
    return {
      system: 'bo3',
      slots: [
        { id: 'G1', label: 'Kampf 1', short: 'Kampf 1', phase: 'bo3', white: { seed: 0 }, blue: { seed: 1 } },
        { id: 'G2', label: 'Kampf 2', short: 'Kampf 2', phase: 'bo3', white: { seed: 1 }, blue: { seed: 0 } },
        { id: 'G3', label: 'Kampf 3 (falls nötig)', short: 'Kampf 3', phase: 'bo3', optional: true, white: { seed: 0 }, blue: { seed: 1 } },
      ],
    };
  }

  function plan(b) {
    const n = (b.players || []).length;
    if (b.system === 'ko') return koPlan(n);
    if (b.system === 'pool2') return pool2Plan(n);
    if (b.system === 'bo3') return bo3Plan();
    return rrPlan(n);
  }

  /* ---------- Auflösen: wer kämpft, wer hat gewonnen? ---------- */

  const person = (p) => ({ name: String((p && p.name) || ''), club: (p && p.club) || '' });

  function resolver(b, pl, entries, opts) {
    const bySlot = new Map();
    (entries || []).forEach((e) => {
      if (e.slot && !bySlot.has(e.slot)) bySlot.set(e.slot, e);
    });
    const slotMap = new Map(pl.slots.map((s) => [s.id, s]));
    const memo = new Map();
    const pools = {};

    function poolTable(p) {
      if (pools[p]) return pools[p];
      const list = (entries || []).filter((e) => e.status !== 'skipped' && ((e.slot && slotMap.get(e.slot) && slotMap.get(e.slot).pool === p) || (e.tiebreak && e.pool === p)));
      pools[p] = C.standings({ key: b.key + '#' + p, label: 'Pool ' + p, ageClass: b.ageClass, category: b.category, gender: b.gender || '', entries: list }, opts);
      // Kämpfer ohne Kampf trotzdem aufführen (Tabelle vor dem ersten Kampf)
      const have = new Set(pools[p].rows.map((r) => r.id));
      (pl.pools[p] || []).forEach((i) => {
        const pp = b.players[i];
        if (pp && !have.has(C.norm(pp.name))) pools[p].rows.push({ id: C.norm(pp.name), name: pp.name, club: pp.club || '', wins: 0, losses: 0, draws: 0, fights: 0, points: 0, ippon: 0, wazaari: 0, yuko: 0, decision: 0, place: null, tie: false });
      });
      return pools[p];
    }

    function who(src) {
      if (!src || src.bye) return BYE;
      if (src.seed != null) return b.players[src.seed] ? person(b.players[src.seed]) : BYE;
      if (src.win) return outcome(src.win).winner;
      if (src.lose) return outcome(src.lose).loser;
      if (src.pool) {
        const t = poolTable(src.pool);
        if (!t.complete) return null;
        const rows = t.rows.filter((r) => r.place === src.place);
        if (rows.length !== 1 || rows[0].tie) return null;
        return person(rows[0]);
      }
      return null;
    }

    function outcome(id) {
      if (memo.has(id)) return memo.get(id);
      const s = slotMap.get(id);
      memo.set(id, { winner: null, loser: null }); // gegen Zyklen
      const w = who(s.white);
      const bl = who(s.blue);
      let o;
      if (w === BYE && bl === BYE) o = { winner: BYE, loser: BYE, walkover: true };
      else if (w === BYE) o = { winner: bl, loser: BYE, walkover: true };
      else if (bl === BYE) o = { winner: w, loser: BYE, walkover: true };
      else {
        const e = bySlot.get(id);
        const r = e && e.status === 'done' && e.result;
        if (r && (r.winner === 'white' || r.winner === 'blue')) {
          o = { winner: person(e[r.winner]), loser: person(e[r.winner === 'white' ? 'blue' : 'white']), side: r.winner, entry: e };
        } else o = { winner: null, loser: null, entry: e, draw: !!(r && r.winner === 'draw') };
      }
      o.white = w;
      o.blue = bl;
      memo.set(id, o);
      return o;
    }

    // Kampf 3 bei Best of Three: true = nötig, false = entfällt, null = noch offen
    function needed(id) {
      const s = slotMap.get(id);
      if (!s || !s.optional) return true;
      const g1 = outcome('G1');
      const g2 = outcome('G2');
      const done = (o) => o.entry && o.entry.status === 'done';
      const w1 = g1.winner && g1.winner !== BYE ? C.norm(g1.winner.name) : null;
      const w2 = g2.winner && g2.winner !== BYE ? C.norm(g2.winner.name) : null;
      if (done(g1) && done(g2)) return !(w1 && w1 === w2);
      return null;
    }

    function label(src) {
      if (!src || src.bye) return 'Freilos';
      if (src.seed != null) return (b.players[src.seed] && b.players[src.seed].name) || '?';
      if (src.pool) return `${src.place}. Pool ${src.pool}`;
      const id = src.win || src.lose;
      const s = slotMap.get(id);
      if (!s) return '?';
      if (src.win) {
        // Freilos-Kampf: der Platzhalter ist der Kämpfer, der dort automatisch weiterkommt
        const o = outcome(id);
        if (o.walkover) {
          if (o.white === BYE && o.blue === BYE) return 'Freilos';
          return label(o.white === BYE ? s.blue : s.white);
        }
        return 'Sieger ' + s.short;
      }
      return 'Verlierer ' + s.short;
    }

    return { outcome, needed, label, poolTable, slotMap, bySlot, who };
  }

  /* ---------- Kampfliste mit dem Turnierbaum abgleichen ---------- */

  function sameP(a, b) {
    return (a.name || '') === (b.name || '') && (a.club || '') === (b.club || '');
  }

  /*
   * Legt fehlende Paarungen in der Kampfliste an und trägt Kämpfer nach, sobald
   * sie feststehen. Beendete Kämpfe bleiben unangetastet. Liefert true bei Änderungen.
   */
  function sync(state, opts) {
    let changed = false;
    opts = opts || { winPoints: state.settings && state.settings.winPoints, rankOrder: state.settings && state.settings.rankOrder };
    (state.brackets || []).forEach((b) => {
      const pl = plan(b);
      const mine = state.queue.filter((e) => e.bracket === b.key);
      const R = resolver(b, pl, mine, opts);
      let anchor = mine.length ? state.queue.lastIndexOf(mine[mine.length - 1]) : state.queue.length - 1;
      pl.slots.forEach((s) => {
        const o = R.outcome(s.id);
        let e = R.bySlot.get(s.id);
        if (o.walkover) {
          // Freilos: kein Kampf. Ein (alter) offener Eintrag dafür fliegt raus.
          if (e && e.status !== 'done') {
            state.queue.splice(state.queue.indexOf(e), 1);
            changed = true;
          }
          return;
        }
        if (!e) {
          e = { id: C.uid(), no: '', ageClass: b.ageClass, category: b.category, white: person(), blue: person(), status: 'open', result: null, bracket: b.key, slot: s.id };
          if (b.gender) e.gender = b.gender;
          const prev = state.queue[anchor];
          if (prev && prev.mat) e.mat = prev.mat;
          state.queue.splice(anchor + 1, 0, e);
          anchor = state.queue.indexOf(e);
          R.bySlot.set(s.id, e);
          changed = true;
        }
        if (e.round !== s.label) {
          e.round = s.label;
          changed = true;
        }
        if (e.status === 'done') return;
        const need = R.needed(s.id);
        ['white', 'blue'].forEach((side) => {
          const p = o[side];
          const want = p && p !== BYE ? person(p) : person();
          const from = p && p !== BYE ? '' : R.label(s[side]);
          if (!sameP(e[side] || {}, want)) {
            e[side] = want;
            changed = true;
          }
          const key = side + 'From';
          if ((e[key] || '') !== from) {
            if (from) e[key] = from;
            else delete e[key];
            changed = true;
          }
        });
        const pending = !o.white || !o.blue || need === null;
        if (!!e.pending !== pending) {
          if (pending) e.pending = true;
          else delete e.pending;
          changed = true;
        }
        const status = need === false ? 'skipped' : 'open';
        if (e.status !== status) {
          e.status = status;
          changed = true;
        }
      });
      // Einträge zu Paarungen, die es im Plan nicht (mehr) gibt
      state.queue
        .filter((e) => e.bracket === b.key && e.slot && !R.slotMap.has(e.slot) && e.status !== 'done')
        .forEach((e) => {
          state.queue.splice(state.queue.indexOf(e), 1);
          changed = true;
        });
    });
    return changed;
  }

  /* ---------- Platzierungen ---------- */

  function placesKo(pl, R) {
    const places = new Map();
    const set = (p, place) => {
      if (p && p !== BYE && p.name) places.set(C.norm(p.name), place);
    };
    pl.slots.forEach((s) => {
      const o = R.outcome(s.id);
      if (s.phase === 'main') {
        if (s.fromEnd === 0) {
          set(o.winner, 1);
          set(o.loser, 2);
        } else if (pl.rep && s.fromEnd <= 2) {
          // Halbfinal-Verlierer kämpfen um Platz 3, Viertelfinal-Verlierer in der Trostrunde
        } else set(o.loser, s.roundFights + 1);
      } else if (s.phase === 'rep') set(o.loser, 7);
      else if (s.phase === 'bronze') {
        set(o.winner, 3);
        set(o.loser, 5);
      }
    });
    return places;
  }

  function placesPool2(pl, R) {
    const places = new Map();
    const set = (p, place) => {
      if (p && p !== BYE && p.name) places.set(C.norm(p.name), place);
    };
    ['A', 'B'].forEach((p) => {
      const t = R.poolTable(p);
      if (!t.complete) return;
      t.rows.forEach((r) => {
        if (r.place >= 3) places.set(r.id, 2 * r.place - 1);
      });
    });
    ['HF1', 'HF2'].forEach((id) => set(R.outcome(id).loser, 3));
    const f = R.outcome('F');
    set(f.winner, 1);
    set(f.loser, 2);
    return places;
  }

  // Wie viele echte Kämpfe (ohne Freilose, ohne entfallene) hat der Plan?
  function realSlots(pl, R) {
    return pl.slots.filter((s) => !R.outcome(s.id).walkover && R.needed(s.id) !== false);
  }

  /*
   * Tabelle einer Gruppe mit Turniersystem – gleiche Form wie C.standings(),
   * damit Auswertung, Siegerliste und Urkunden unverändert funktionieren.
   */
  function table(b, group, opts) {
    const entries = group.entries.filter((e) => e.status !== 'skipped');
    const base = C.standings(Object.assign({}, group, { entries }), opts);
    base.system = b.system;
    base.systemLabel = SYSTEMS[b.system];
    if (b.system === 'rr' || b.system === 'bo3') return base;
    const pl = plan(b);
    const R = resolver(b, pl, group.entries, opts);
    const places = b.system === 'ko' ? placesKo(pl, R) : placesPool2(pl, R);
    const real = realSlots(pl, R);
    const done = real.filter((s) => {
      const e = R.bySlot.get(s.id);
      return e && e.status === 'done';
    }).length;
    const stats = new Map(base.rows.map((r) => [r.id, r]));
    const rows = b.players.map((p) => {
      const id = C.norm(p.name);
      const st = stats.get(id) || { id, name: p.name, club: p.club || '', wins: 0, losses: 0, draws: 0, fights: 0, points: 0, ippon: 0, wazaari: 0, yuko: 0, decision: 0 };
      return Object.assign({}, st, { place: places.has(id) ? places.get(id) : null, tie: false });
    });
    rows.sort((x, y) => (x.place == null ? 999 : x.place) - (y.place == null ? 999 : y.place) || x.name.localeCompare(y.name, 'de'));
    base.rows = rows;
    base.total = real.length;
    base.done = done;
    base.complete = real.length > 0 && done === real.length;
    base.ties = [];
    if (b.system === 'pool2') base.pools = ['A', 'B'].map((p) => Object.assign(R.poolTable(p), { pool: p }));
    return base;
  }

  // Alle Gruppen der Kampfliste – mit Turniersystem, sonst „Jeder gegen jeden“ wie bisher
  function allTables(state) {
    const opts = { winPoints: state.settings.winPoints, rankOrder: state.settings.rankOrder };
    const brackets = new Map((state.brackets || []).map((b) => [b.key, b]));
    return C.poolGroups(state.queue).map((g) => (brackets.has(g.key) ? table(brackets.get(g.key), g, opts) : C.standings(g, opts)));
  }

  /* ---------- Turnierbaum als Daten für die Darstellung ---------- */

  function treeModel(state, b, liveId) {
    const pl = plan(b);
    const entries = state.queue.filter((e) => e.bracket === b.key);
    const opts = { winPoints: state.settings.winPoints, rankOrder: state.settings.rankOrder };
    const R = resolver(b, pl, entries, opts);
    const fight = state.fight;
    const match = (s) => {
      const o = R.outcome(s.id);
      const e = R.bySlot.get(s.id);
      const done = !!(e && e.status === 'done');
      const side = (k) => {
        const p = o[k];
        const known = p && p !== BYE;
        const win = !!(o.winner && o.winner !== BYE && known && C.norm(o.winner.name) === C.norm(p.name) && (done || o.walkover));
        return { name: known ? p.name : '', club: known ? p.club : '', from: known ? '' : R.label(s[k]), bye: p === BYE, win };
      };
      const res = done && e.result ? e.result : null;
      return {
        id: s.id,
        label: s.label,
        white: side('white'),
        blue: side('blue'),
        done,
        walkover: !!o.walkover,
        empty: o.white === BYE && o.blue === BYE,
        reason: res && res.winner !== 'draw' ? res.kind ? { ippon: 'Ippon', wazaari: 'Waza-ari', yuko: 'Yuko', decision: 'Entscheidung' }[res.kind] : res.reason : '',
        live: !!(e && e.id === liveId && fight && fight.status !== 'finished'),
        liveText: e && e.id === liveId && fight ? (fight.started ? 'läuft' : 'geladen') + (e.mat ? ' · ' + e.mat : '') : '',
      };
    };
    const t = table(b, { key: b.key, label: C.groupLabel(b), ageClass: b.ageClass, category: b.category, gender: b.gender || '', entries }, opts);
    const podium = [1, 2, 3, 3].map((place, i) => {
      const rows = t.rows.filter((r) => r.place === place);
      const r = place === 3 ? rows[i - 2] : rows[0];
      return { place, name: r ? r.name : '', club: r ? r.club : '' };
    });
    const model = { system: b.system, systemLabel: SYSTEMS[b.system], label: C.groupLabel(b), players: b.players.length, columns: [], extra: [], podium, pools: null };
    if (b.system === 'ko') {
      for (let r = 0; r < pl.rounds; r++) {
        const slots = pl.slots.filter((s) => s.phase === 'main' && s.col === r);
        model.columns.push({ title: slots[0].roundName, matches: slots.map(match) });
      }
      if (pl.rep) {
        model.extra = [
          { title: 'Trostrunde A', matches: [match(R.slotMap.get('TRA'))] },
          { title: 'Trostrunde B', matches: [match(R.slotMap.get('TRB'))] },
          { title: 'Kampf um Platz 3', matches: [match(R.slotMap.get('P3A')), match(R.slotMap.get('P3B'))] },
        ];
      }
    } else if (b.system === 'pool2') {
      model.pools = ['A', 'B'].map((p) => {
        const pt = R.poolTable(p);
        return { title: 'Pool ' + p, complete: pt.complete, rows: pt.rows.map((r) => ({ place: r.place, name: r.name, club: r.club, wins: r.wins, points: r.points, tie: r.tie })) };
      });
      model.columns = [
        { title: 'Halbfinale', matches: ['HF1', 'HF2'].map((id) => match(R.slotMap.get(id))) },
        { title: 'Finale', matches: [match(R.slotMap.get('F'))] },
      ];
    }
    return model;
  }

  /* ---------- Hilfen für Planung und Anzeige ---------- */

  // Anzahl Kämpfe eines Systems für n Kämpfer (ohne Freilose); Best of Three: 2–3
  function fightCount(system, n) {
    if (!allowed(system, n)) return 0;
    if (system === 'bo3') return 3;
    const b = { key: 'x', system, players: Array.from({ length: n }, (_, i) => ({ name: 'P' + i })) };
    const pl = plan(b);
    const R = resolver(b, pl, [], {});
    return realSlots(pl, R).length;
  }

  /*
   * Wer könnte in diesem Kampf stehen (für Pausen zwischen Kämpfen), und von welchen
   * Kämpfen hängt er ab? Für Einträge ohne Turniersystem: nur die beiden Namen.
   */
  function entryInfo(state, e, cache) {
    const people = new Set();
    const deps = [];
    ['white', 'blue'].forEach((s) => e[s] && e[s].name && people.add(C.norm(e[s].name)));
    const b = e.bracket && (state.brackets || []).find((x) => x.key === e.bracket);
    if (!b || !e.slot) return { people, deps };
    cache = cache || {};
    if (!cache[b.key]) {
      const pl = plan(b);
      cache[b.key] = { pl, map: new Map(pl.slots.map((s) => [s.id, s])), bySlot: new Map(state.queue.filter((x) => x.bracket === b.key && x.slot).map((x) => [x.slot, x])) };
    }
    const { pl, map, bySlot } = cache[b.key];
    const seen = new Set();
    const walk = (src) => {
      if (!src || src.bye) return;
      if (src.seed != null) {
        if (b.players[src.seed]) people.add(C.norm(b.players[src.seed].name));
        return;
      }
      if (src.pool) {
        (pl.pools[src.pool] || []).forEach((i) => b.players[i] && people.add(C.norm(b.players[i].name)));
        pl.slots.filter((s) => s.pool === src.pool).forEach((s) => bySlot.has(s.id) && deps.push(bySlot.get(s.id).id));
        return;
      }
      const id = src.win || src.lose;
      if (seen.has(id)) return;
      seen.add(id);
      const s = map.get(id);
      if (!s) return;
      if (bySlot.has(id)) deps.push(bySlot.get(id).id);
      walk(s.white);
      walk(s.blue);
    };
    const s = map.get(e.slot);
    if (s) {
      if (!e.white.name) walk(s.white);
      if (!e.blue.name) walk(s.blue);
      // Paarungen, deren Kämpfer schon feststehen, hängen trotzdem an ihren Vorkämpfen
      ['white', 'blue'].forEach((k) => {
        const src = s[k];
        if (src && (src.win || src.lose) && bySlot.has(src.win || src.lose)) deps.push(bySlot.get(src.win || src.lose).id);
        if (src && src.pool) pl.slots.filter((x) => x.pool === src.pool).forEach((x) => bySlot.has(x.id) && deps.push(bySlot.get(x.id).id));
      });
      if (s.optional) ['G1', 'G2'].forEach((id) => bySlot.has(id) && deps.push(bySlot.get(id).id));
    }
    return { people, deps: Array.from(new Set(deps)) };
  }

  // Systemname aus Excel-Text erkennen
  function systemFromText(t) {
    const s = String(t || '').toLowerCase();
    if (/best|bo3|drei/.test(s)) return 'bo3';
    if (/pool/.test(s)) return 'pool2';
    if (/k\.?\s*-?\s*o|knock|trost|ko-/.test(s)) return 'ko';
    if (/jeder|round|rr|liga/.test(s)) return 'rr';
    return SYSTEM_IDS.includes(s) ? s : null;
  }

  const api = {
    SYSTEMS,
    SYSTEM_IDS,
    DEFAULT_LIMITS,
    BYE,
    isOpen,
    limitsOf,
    allowed,
    suggest,
    drawOrder,
    newBracket,
    seedOrder,
    plan,
    resolver,
    sync,
    table,
    allTables,
    treeModel,
    fightCount,
    entryInfo,
    systemFromText,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.JudoBrackets = api;
})(typeof self !== 'undefined' ? self : this);
