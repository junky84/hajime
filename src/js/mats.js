/*
 * Hajime – Kampflisten auf mehrere Matten verteilen (ohne DOM, in Node testbar).
 *
 * - Eine Gruppe (Alters-/Gewichtsklasse, ggf. Geschlecht) bleibt ganz auf einer Matte.
 * - Verteilung nach erwarteter Dauer: Kämpfe × (Kampfzeit aus dem Regelprofil + Zuschlag).
 * - Innerhalb einer Matte: gruppenweise, aber so gemischt, dass niemand zweimal
 *   direkt hintereinander kämpft (möglichst auch nicht mit nur einem Kampf Pause).
 *
 * state.matPlan = { active, count, start: 'HH:MM', extra: Sekunden, assign: { Gruppe: Matte (0-basiert) } }
 */
(function (root) {
  'use strict';
  const node = typeof module !== 'undefined' && module.exports;
  const C = node ? require('./core.js') : root.JudoCore;
  const B = node ? require('./brackets.js') : root.JudoBrackets;

  const DEFAULT_PLAN = { active: false, count: 2, start: '09:00', extra: 60, assign: {} };

  function planOf(state) {
    const p = Object.assign({}, DEFAULT_PLAN, state.matPlan);
    p.count = Math.max(1, Math.min(20, Math.round(Number(p.count) || 1)));
    p.extra = Math.max(0, Math.round(Number(p.extra) || 0));
    p.assign = Object.assign({}, p.assign);
    return p;
  }

  const matName = (i) => 'Matte ' + (i + 1);

  function parseHM(v) {
    const m = String(v || '').match(/^(\d{1,2})[:.](\d{2})/);
    return m ? Number(m[1]) * 60 + Number(m[2]) : 9 * 60;
  }
  function fmtHM(min) {
    min = Math.round(min);
    const h = Math.floor(min / 60) % 24;
    return String(h).padStart(2, '0') + ':' + String(min % 60).padStart(2, '0');
  }

  // Sekunden je Kampf dieser Gruppe (Kampfzeit + Zuschlag)
  function perFight(state, ageClass, extra) {
    const prof = C.findProfileFor(state, ageClass) || C.getRules(state);
    return { sec: (Number(prof.duration) || 0) + extra, duration: Number(prof.duration) || 0, profile: prof.name };
  }

  // Gruppen der Kampfliste mit Kennzahlen für die Planung
  function matGroups(state, plan) {
    plan = plan || planOf(state);
    const brackets = new Map((state.brackets || []).map((b) => [b.key, b]));
    return C.poolGroups(state.queue)
      .map((g) => {
        const b = brackets.get(g.key);
        const fights = g.entries.filter((e) => e.status !== 'skipped');
        const names = new Set();
        g.entries.forEach((e) => ['white', 'blue'].forEach((s) => e[s] && e[s].name && names.add(C.norm(e[s].name))));
        const pf = perFight(state, g.ageClass, plan.extra);
        return {
          key: g.key,
          label: g.label,
          ageClass: g.ageClass,
          category: g.category,
          gender: g.gender || '',
          entries: g.entries,
          players: b ? b.players.length : names.size,
          fights: fights.length,
          open: fights.filter(B.isOpen).length,
          system: b ? b.system : null,
          systemLabel: b ? B.SYSTEMS[b.system] : 'eigene Paarungen',
          perSec: pf.sec,
          durSec: fights.length * pf.sec,
          profile: pf.profile,
        };
      })
      .sort((a, b) => a.label.localeCompare(b.label, 'de', { numeric: true }));
  }

  // Gleichmäßig verteilen: größte Gruppen zuerst auf die am wenigsten belastete Matte
  function distribute(groups, count) {
    const load = new Array(count).fill(0);
    const assign = {};
    groups
      .slice()
      .sort((a, b) => b.durSec - a.durSec || a.label.localeCompare(b.label, 'de', { numeric: true }))
      .forEach((g) => {
        let best = 0;
        for (let i = 1; i < count; i++) if (load[i] < load[best]) best = i;
        assign[g.key] = best;
        load[best] += g.durSec;
      });
    return assign;
  }

  // Matten mit ihren Gruppen; Gruppen ohne (gültige) Zuordnung kommen auf die leerste Matte
  function layout(groups, plan) {
    const mats = Array.from({ length: plan.count }, (_, i) => ({ index: i, name: matName(i), groups: [], durSec: 0, fights: 0 }));
    const assign = {};
    const place = (g, i) => {
      mats[i].groups.push(g);
      mats[i].durSec += g.durSec;
      mats[i].fights += g.fights;
      assign[g.key] = i;
    };
    const rest = [];
    groups.forEach((g) => {
      const i = plan.assign[g.key];
      if (Number.isInteger(i) && i >= 0 && i < plan.count) place(g, i);
      else rest.push(g);
    });
    rest
      .sort((a, b) => b.durSec - a.durSec)
      .forEach((g) => {
        let best = 0;
        for (let i = 1; i < mats.length; i++) if (mats[i].durSec < mats[best].durSec) best = i;
        place(g, best);
      });
    const start = parseHM(plan.start);
    const total = mats.reduce((a, m) => a + m.durSec, 0);
    const avg = total / plan.count;
    mats.forEach((m) => {
      m.endMin = start + m.durSec / 60;
      m.end = fmtHM(m.endMin);
      // Hinweis: eine Gruppe allein dauert deutlich länger als eine Matte im Schnitt
      m.groups.forEach((g) => (g.tooBig = plan.count > 1 && g.durSec > avg * 1.15 && m.groups.length === 1 && g.durSec > 0));
    });
    const maxDur = Math.max(1, ...mats.map((m) => m.durSec));
    mats.forEach((m) => (m.share = m.durSec / maxDur));
    return { mats, assign, start, totalSec: total };
  }

  /*
   * Reihenfolge innerhalb einer Matte. items: [{ id, group, people:Set, deps:[ids] }]
   * Nimmt die Kämpfe in Gruppenreihenfolge, schaut dabei aber auch in die nächste
   * Gruppe, wenn sonst jemand ohne Pause wieder dran wäre.
   */
  function schedule(items) {
    const rest = items.slice();
    const out = [];
    const placed = new Set();
    const known = new Set(items.map((x) => x.id));
    const ready = (x) => x.deps.every((d) => placed.has(d) || !known.has(d));
    const clash = (x, y) => {
      if (!y) return false;
      for (const p of x.people) if (y.people.has(p)) return true;
      return false;
    };
    while (rest.length) {
      const groups = [];
      rest.forEach((x) => groups.length < 2 && !groups.includes(x.group) && groups.push(x.group));
      let cands = rest.filter((x) => groups.includes(x.group) && ready(x));
      if (!cands.length) cands = rest.filter(ready);
      if (!cands.length) cands = [rest[0]];
      const last = out[out.length - 1];
      const prev = out[out.length - 2];
      const wide = rest.filter(ready);
      const pick =
        cands.find((x) => !clash(x, last) && !clash(x, prev)) ||
        cands.find((x) => !clash(x, last)) ||
        // sonst notfalls aus einer späteren Gruppe vorziehen
        wide.find((x) => !clash(x, last)) ||
        cands[0];
      out.push(pick);
      placed.add(pick.id);
      rest.splice(rest.indexOf(pick), 1);
    }
    return repair(out, clash);
  }

  /*
   * Was danach noch direkt hintereinander liegt (typisch: Ende der letzten kleinen
   * Gruppe), durch Verschieben eines anderen Kampfes dazwischen auflösen –
   * ohne neue Doppelungen und ohne einen Kampf vor seine Vorkämpfe zu ziehen.
   */
  function repair(out, clash) {
    const dependsOn = (x, y) => x.deps.includes(y.id);
    for (let guard = 0; guard < out.length * 2; guard++) {
      const i = out.findIndex((x, k) => k > 0 && clash(x, out[k - 1]));
      if (i < 0) break;
      let moved = false;
      // nächstgelegene Kandidaten zuerst
      const order = out.map((_, k) => k).filter((k) => k !== i && k !== i - 1).sort((a, b) => Math.abs(a - i) - Math.abs(b - i));
      for (const k of order) {
        const x = out[k];
        if (clash(x, out[i - 1]) || clash(x, out[i])) continue;
        // Lücke an der alten Stelle darf keine neue Doppelung erzeugen
        if (k > 0 && k < out.length - 1 && clash(out[k - 1], out[k + 1])) continue;
        // Reihenfolge der Abhängigkeiten wahren
        const lo = Math.min(k, i);
        const hi = Math.max(k, i);
        const between = out.slice(lo + (k < i ? 1 : 0), hi);
        if (k < i && between.some((y) => dependsOn(y, x))) continue; // x nach hinten: niemand dazwischen braucht x
        if (k > i && between.some((y) => dependsOn(x, y))) continue; // x nach vorn: keine Vorkämpfe überspringen
        out.splice(k, 1);
        out.splice(k < i ? i - 1 : i, 0, x);
        moved = true;
        break;
      }
      if (!moved) break;
    }
    return out;
  }

  /*
   * Plan auf die Kampfliste anwenden: jede Gruppe auf ihre Matte, Reihenfolge je
   * Matte mit Pausen, Kampfnummern je Matte ab 1 und geplante Uhrzeit (ca.).
   */
  function apply(state) {
    const plan = planOf(state);
    const groups = matGroups(state, plan);
    const L = layout(groups, plan);
    const cache = {};
    const queue = [];
    L.mats.forEach((m) => {
      const entries = m.groups.flatMap((g) => g.entries);
      const done = entries.filter((e) => e.status === 'done');
      const items = entries
        .filter((e) => e.status !== 'done')
        .map((e) => Object.assign({ id: e.id, group: C.groupKey(e), entry: e }, B.entryInfo(state, e, cache)));
      const ordered = done.concat(schedule(items).map((x) => x.entry));
      let t = L.start;
      const per = new Map(m.groups.map((g) => [g.key, g.perSec]));
      ordered.forEach((e, i) => {
        e.mat = m.name;
        e.no = String(i + 1);
        if (e.status === 'skipped') e.at = '';
        else {
          e.at = fmtHM(t);
          t += (per.get(C.groupKey(e)) || 0) / 60;
        }
        queue.push(e);
      });
    });
    // Einträge ohne Gruppe gibt es nicht – sicherheitshalber trotzdem behalten
    state.queue.forEach((e) => !queue.includes(e) && queue.push(e));
    state.queue = queue;
    plan.assign = L.assign;
    plan.active = true;
    state.matPlan = plan;
    return L;
  }

  // Verteilung aufheben: Matte und Uhrzeit aus der Kampfliste entfernen
  function clear(state) {
    state.queue.forEach((e) => {
      delete e.mat;
      delete e.at;
    });
    const plan = planOf(state);
    plan.active = false;
    plan.assign = {};
    state.matPlan = plan;
  }

  const sameMat = (a, b) => C.norm(a) === C.norm(b);
  // Kämpfe einer Matte; ohne Mattenangabe gehören sie zu jeder Matte
  const forMat = (e, mat) => !e.mat || sameMat(e.mat, mat);

  const api = { DEFAULT_PLAN, planOf, matName, parseHM, fmtHM, matGroups, distribute, layout, schedule, apply, clear, sameMat, forMat };
  if (node) module.exports = api;
  else root.JudoMats = api;
})(typeof self !== 'undefined' ? self : this);
