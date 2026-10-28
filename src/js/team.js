/*
 * Mannschaftskampf (Liga, Mannschaftsturnier): zwei Mannschaften, Aufstellung je Gewichtsklasse,
 * Hin- und Rückrunde, Mannschaftsstand. Die Einzelkämpfe stehen als normale Einträge in der
 * Kampfliste (mit team = Id der Begegnung), damit Laden, Uhr, Protokoll und Anzeige wie sonst laufen.
 * Ohne DOM, in Node testbar (test/team.test.js).
 */
(function (root) {
  'use strict';
  const C = root.JudoCore || (typeof require === 'function' ? require('./core.js') : null);

  // Unterbewertungen (Wertungspunkte) je Einzelsieg
  const DEFAULT_POINTS = { ippon: 10, wazaari: 7, yuko: 5, decision: 1, forfeit: 10 };
  const FORFEIT_REASON = 'Fusen-gachi (nicht besetzt)';

  const uid = () => (C ? C.uid() : Math.random().toString(36).slice(2, 11));

  function createTeam() {
    return {
      active: false,
      id: uid(),
      title: '',
      ageClass: '',
      white: { name: '' },
      blue: { name: '' },
      classes: ['-60 kg', '-66 kg', '-73 kg', '-81 kg', '-90 kg', '-100 kg', '+100 kg'],
      start: 0, // Index der Gewichtsklasse, mit der begonnen wird
      legs: 1, // 1 = ein Durchgang, 2 = Hin- und Rückrunde
      lineup: [{ white: {}, blue: {} }, { white: {}, blue: {} }], // je Durchgang: Gewichtsklasse → Name
      points: Object.assign({}, DEFAULT_POINTS),
      rule: 'wins-points', // wins-points: Siege, dann Unterbewertungen | wins: nur Siege
    };
  }

  function normTeam(t) {
    const base = createTeam();
    const x = Object.assign(base, t || {});
    x.white = Object.assign({ name: '' }, x.white);
    x.blue = Object.assign({ name: '' }, x.blue);
    x.classes = (Array.isArray(x.classes) ? x.classes : base.classes).map((c) => String(c || '').trim()).filter(Boolean);
    x.legs = Number(x.legs) === 2 ? 2 : 1;
    x.start = Math.max(0, Math.min(x.classes.length - 1, Math.round(Number(x.start)) || 0));
    if (!Array.isArray(x.lineup)) x.lineup = [];
    for (let i = 0; i < 2; i++) x.lineup[i] = { white: Object.assign({}, x.lineup[i] && x.lineup[i].white), blue: Object.assign({}, x.lineup[i] && x.lineup[i].blue) };
    x.points = Object.assign({}, DEFAULT_POINTS, x.points);
    x.rule = x.rule === 'wins' ? 'wins' : 'wins-points';
    return x;
  }

  // Gewichtsklassen in Kampfreihenfolge (ab der Startklasse, dann reihum)
  function order(team) {
    const cls = team.classes;
    return cls.slice(team.start).concat(cls.slice(0, team.start));
  }

  const entryId = (team, leg, cls) => `${team.id}:${leg}:${cls}`;
  const legLabel = (team, leg) => (team.legs > 1 ? (leg === 1 ? 'Hinrunde' : 'Rückrunde') : '');

  // Einträge der Begegnung für die Kampfliste (unbesetzte Klassen = kampfloser Sieg)
  function plan(team) {
    const out = [];
    for (let leg = 1; leg <= team.legs; leg++) {
      const lu = team.lineup[leg - 1] || { white: {}, blue: {} };
      order(team).forEach((cls) => {
        const w = String(lu.white[cls] || '').trim();
        const b = String(lu.blue[cls] || '').trim();
        out.push({
          id: entryId(team, leg, cls),
          no: String(out.length + 1),
          team: team.id,
          leg,
          round: legLabel(team, leg),
          ageClass: team.ageClass || '',
          category: cls,
          white: { name: w, club: team.white.name || '' },
          blue: { name: b, club: team.blue.name || '' },
          vacant: !w && !b ? 'both' : !w ? 'white' : !b ? 'blue' : '',
        });
      });
    }
    return out;
  }

  /*
   * Kampfliste mit der Aufstellung abgleichen. Beendete Kämpfe behalten ihr Ergebnis,
   * solange beide Namen gleich bleiben. Liefert true bei Änderungen.
   */
  function sync(state) {
    const team = state.team;
    let changed = false;
    if (!team || !team.active) return false;
    const want = plan(team);
    const ids = new Set(want.map((e) => e.id));
    // alte Einträge der Begegnung, die es nicht mehr gibt (unbeendet oder automatisch kampflos)
    for (let i = state.queue.length - 1; i >= 0; i--) {
      const e = state.queue[i];
      if (e.team === team.id && !ids.has(e.id) && (e.status !== 'done' || (e.result && e.result.auto))) {
        state.queue.splice(i, 1);
        changed = true;
      }
    }
    // Einträge der Begegnung stehen zusammen, in Kampfreihenfolge
    const firstIdx = state.queue.findIndex((e) => e.team === team.id);
    const own = new Map(state.queue.filter((e) => e.team === team.id).map((e) => [e.id, e]));
    const list = want.map((w) => {
      let e = own.get(w.id);
      if (!e) {
        e = { id: w.id, status: 'open', result: null };
        changed = true;
      }
      const same = (a, b) => (a && a.name) === b.name && (a && a.club) === b.club;
      if (e.status === 'done' && !(e.result && e.result.auto) && (!same(e.white, w.white) || !same(e.blue, w.blue))) {
        // Aufstellung eines beendeten Kampfes geändert: Ergebnis passt nicht mehr
        e.status = 'open';
        e.result = null;
        changed = true;
      }
      ['no', 'team', 'leg', 'ageClass', 'category'].forEach((k) => {
        if (e[k] !== w[k]) {
          e[k] = w[k];
          changed = true;
        }
      });
      if ((e.round || '') !== w.round) {
        if (w.round) e.round = w.round;
        else delete e.round;
        changed = true;
      }
      ['white', 'blue'].forEach((s) => {
        if (!same(e[s], w[s])) {
          e[s] = Object.assign({}, w[s]);
          changed = true;
        }
      });
      // unbesetzte Klasse: kampfloser Sieg für die andere Seite, beidseitig unbesetzt = entfällt
      if (w.vacant === 'both') {
        if (e.status !== 'skipped') {
          e.status = 'skipped';
          e.result = null;
          changed = true;
        }
      } else if (w.vacant) {
        const winner = w.vacant === 'white' ? 'blue' : 'white';
        if (e.status !== 'done' || !e.result || e.result.winner !== winner || !e.result.auto) {
          e.status = 'done';
          e.result = { winner, reason: FORFEIT_REASON, kind: 'ippon', auto: true, white: '', blue: '', finishedAt: 0 };
          changed = true;
        }
      } else if (e.status === 'skipped' || (e.result && e.result.auto)) {
        e.status = 'open';
        e.result = null;
        changed = true;
      }
      return e;
    });
    const rest = state.queue.filter((e) => e.team !== team.id);
    const at = firstIdx >= 0 ? Math.min(firstIdx, rest.length) : rest.length;
    const next = rest.slice(0, at).concat(list, rest.slice(at));
    if (next.length !== state.queue.length || next.some((e, i) => e !== state.queue[i])) changed = true;
    state.queue.splice(0, state.queue.length, ...next);
    return changed;
  }

  // Unterbewertung eines Einzelsiegs
  function fightPoints(team, res) {
    if (!res || (res.winner !== 'white' && res.winner !== 'blue')) return 0;
    const p = team.points;
    if (res.auto || /fusen|kiken|hansoku|disqual|verletzung/i.test(res.reason || '')) return Number(p.forfeit) || 0;
    const sc = C && C.resultScores ? C.resultScores(res) : null;
    const kind = (C && sc && C.winKind(res.winner, res.reason, sc)) || res.kind || (C && C.winKind(res.winner, res.reason)) || 'decision';
    return Number(p[kind]) || 0;
  }

  // Mannschaftsstand und Zeilen für den Ergebnisbogen
  function score(state) {
    const team = state.team;
    const entries = state.queue.filter((e) => e.team === team.id);
    const tot = { white: { wins: 0, points: 0 }, blue: { wins: 0, points: 0 } };
    let done = 0;
    const rows = entries.map((e) => {
      const res = e.status === 'done' ? e.result : null;
      const pts = fightPoints(team, res);
      if (res && (res.winner === 'white' || res.winner === 'blue')) {
        tot[res.winner].wins++;
        tot[res.winner].points += pts;
      }
      if (res) done++;
      return { id: e.id, no: e.no, leg: e.leg, round: e.round || '', category: e.category, white: e.white, blue: e.blue, status: e.status, winner: res ? res.winner : null, reason: res ? res.reason : '', points: pts, auto: !!(res && res.auto) };
    });
    const total = entries.filter((e) => e.status !== 'skipped').length;
    let winner = null;
    if (total && done === total) {
      const w = tot.white;
      const b = tot.blue;
      if (w.wins !== b.wins) winner = w.wins > b.wins ? 'white' : 'blue';
      else if (team.rule === 'wins-points' && w.points !== b.points) winner = w.points > b.points ? 'white' : 'blue';
      else winner = 'draw';
    }
    return { white: tot.white, blue: tot.blue, done, total, winner, rows };
  }

  // Für die Anzeige: Mannschaftsleiste
  function view(state) {
    const team = state.team;
    if (!team || !team.active) return null;
    const sc = score(state);
    const real = state.queue.filter((e) => e.team === team.id && e.status !== 'skipped');
    const idx = real.findIndex((e) => e.id === state.fight.queueId);
    return {
      title: team.title,
      white: { name: team.white.name, wins: sc.white.wins, points: sc.white.points },
      blue: { name: team.blue.name, wins: sc.blue.wins, points: sc.blue.points },
      current: idx >= 0 ? idx + 1 : 0,
      total: real.length,
      done: sc.done,
      winner: sc.winner,
      rule: team.rule,
    };
  }

  /* ---------- Ergebnisbogen (A4 hoch) zum Ausdrucken und Unterschreiben ---------- */

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

  // Text der Wertung einer Zeile: „Ippon (10)“, „kampflos (10)“
  function rowResult(row, t) {
    if (!row.winner) return row.status === 'skipped' ? t('entfällt') : '';
    if (row.winner === 'draw') return t('Unentschieden');
    const reason = row.auto ? t('kampflos') : C ? C.reasonText(row.reason, t) : row.reason;
    return `${reason} (${row.points})`;
  }

  function sheetHtml(state, opts) {
    opts = opts || {};
    const t = opts.t || ((s, p) => (p ? s.replace(/\{(\w+)\}/g, (m, k) => (p[k] == null ? m : p[k])) : s));
    const team = state.team;
    const sc = score(state);
    const wName = team.white.name || t('Weiß');
    const bName = team.blue.name || t('Blau');
    const winnerText = sc.winner === 'draw' ? t('Unentschieden') : sc.winner ? t('Sieger: {name}', { name: sc.winner === 'white' ? wName : bName }) : t('vorläufig ({n} von {m} Kämpfen)', { n: sc.done, m: sc.total });
    const rows = sc.rows
      .map((r, i) => {
        const prev = sc.rows[i - 1];
        const legHead = r.round && (!prev || prev.round !== r.round) ? `<tr class="leg"><td colspan="6">${esc(t(r.round))}</td></tr>` : '';
        const win = r.winner === 'white' ? wName : r.winner === 'blue' ? bName : '';
        const nm = (p, side) => (p && p.name ? esc(p.name) : `<i>${esc(t('nicht besetzt'))}</i>`) + (r.winner === side ? ' ✓' : '');
        return `${legHead}<tr><td class="no">${esc(r.no)}</td><td>${esc(r.category)}</td><td>${nm(r.white, 'white')}</td><td>${nm(r.blue, 'blue')}</td><td>${esc(win)}</td><td>${esc(rowResult(r, t))}</td></tr>`;
      })
      .join('\n');
    const s = opts.settings || {};
    const date = s.tournamentDate ? new Date(s.tournamentDate + 'T12:00:00').toLocaleDateString(t.lang || 'de') : '';
    return `<!doctype html>
<html lang="${esc(t.lang || 'de')}"><head><meta charset="utf-8"><title>${esc(t('Ergebnisbogen'))}</title>
<style>
  @page { size: A4 portrait; margin: 14mm 14mm 16mm; }
  * { box-sizing: border-box; }
  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { margin: 0; font-family: system-ui, -apple-system, "Segoe UI", "Helvetica Neue", Arial, sans-serif; color: #111; font-size: 10.5pt; }
  .top { display: flex; justify-content: space-between; align-items: flex-end; gap: 10mm; border-bottom: 0.8mm solid #111; padding-bottom: 3mm; }
  .title { font-size: 19pt; font-weight: 800; line-height: 1.15; }
  .sub { color: #444; margin-top: 1mm; }
  .logo { max-height: 18mm; max-width: 45mm; object-fit: contain; }
  .teams { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 6mm; margin: 6mm 0 5mm; }
  .teams .w, .teams .b { font-size: 15pt; font-weight: 800; }
  .teams .b { text-align: right; }
  .teams small { display: block; font-size: 9pt; font-weight: 500; color: #555; }
  .score { text-align: center; font-size: 26pt; font-weight: 900; }
  .score small { display: block; font-size: 9pt; font-weight: 700; color: #333; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; font-size: 8pt; letter-spacing: 0.1em; text-transform: uppercase; color: #444; padding: 2mm 1.5mm; border-bottom: 0.35mm solid #111; }
  td { padding: 2.4mm 1.5mm; border-bottom: 0.25mm solid #bbb; }
  td.no { width: 8%; font-weight: 800; }
  tr.leg td { font-weight: 800; background: #eee; padding: 1.6mm 1.5mm; }
  tr.sum td { font-weight: 800; border-top: 0.5mm solid #111; border-bottom: none; }
  i { color: #777; }
  .sign { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10mm; margin-top: 22mm; }
  .sign div { border-top: 0.3mm solid #111; padding-top: 1.5mm; font-size: 9pt; color: #333; }
  .note { margin-top: 6mm; font-size: 8.5pt; color: #555; }
</style></head>
<body>
  <div class="top">
    <div><div class="title">${esc(team.title || s.tournament || t('Mannschaftskampf'))}</div><div class="sub">${esc(t('Ergebnisbogen'))}${team.ageClass ? ' · ' + esc(team.ageClass) : ''}${date ? ' · ' + esc(date) : ''}${s.tournamentPlace ? ' · ' + esc(s.tournamentPlace) : ''}</div></div>
    ${s.logo ? `<img class="logo" src="${esc(s.logo)}" alt="">` : ''}
  </div>
  <div class="teams">
    <div class="w">${esc(wName)}<small>${esc(t('Weiß'))}</small></div>
    <div class="score">${sc.white.wins} : ${sc.blue.wins}<small>${esc(winnerText)}</small></div>
    <div class="b">${esc(bName)}<small>${esc(t('Blau'))}</small></div>
  </div>
  <table>
    <thead><tr><th>${esc(t('Kampf'))}</th><th>${esc(t('Klasse'))}</th><th>${esc(wName)}</th><th>${esc(bName)}</th><th>${esc(t('Sieger'))}</th><th>${esc(t('Wertung'))}</th></tr></thead>
    <tbody>
${rows}
      <tr class="sum"><td colspan="2">${esc(t('Stand'))}</td><td>${esc(t('{wins} Siege · {points}', { wins: sc.white.wins, points: sc.white.points }))}</td><td>${esc(t('{wins} Siege · {points}', { wins: sc.blue.wins, points: sc.blue.points }))}</td><td colspan="2">${esc(winnerText)}</td></tr>
    </tbody>
  </table>
  <div class="note">${esc(
    t('Wertung je Sieg: Ippon {i} · Waza-ari {w} · Yuko {y} · Entscheidung {d} · kampflos {f}.', { i: team.points.ippon, w: team.points.wazaari, y: team.points.yuko, d: team.points.decision, f: team.points.forfeit })
  )} ${esc(team.rule === 'wins' ? t('Bei gleich vielen Siegen endet die Begegnung unentschieden.') : t('Bei gleich vielen Siegen entscheiden die Unterbewertungen.'))}</div>
  <div class="sign"><div>${esc(t('Mannschaftsführer {name}', { name: wName }))}</div><div>${esc(t('Kampfrichter'))}</div><div>${esc(t('Mannschaftsführer {name}', { name: bName }))}</div></div>
</body></html>`;
  }

  root.JudoTeam = { DEFAULT_POINTS, FORFEIT_REASON, createTeam, normTeam, order, plan, sync, score, view, fightPoints, rowResult, sheetHtml };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.JudoTeam;
})(typeof globalThis !== 'undefined' ? globalThis : this);
