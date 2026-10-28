// Tests der Turniersysteme: node test/brackets.test.js
const assert = require('assert');
const C = require('../src/js/core.js');
const B = require('../src/js/brackets.js');

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('ok  ', name);
  } catch (e) {
    console.error('FAIL', name);
    console.error(e);
    process.exitCode = 1;
  }
}

// reproduzierbarer Zufall
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const people = (n, clubs) => Array.from({ length: n }, (_, i) => ({ name: 'K' + (i + 1), club: clubs ? clubs[i] : 'V' + (i + 1) }));
const group = { ageClass: 'U15', category: '-50 kg' };

function setup(system, n, clubs) {
  const s = C.createState();
  s.brackets = [B.newBracket(group, system, people(n, clubs), rng(7))];
  B.sync(s);
  return s;
}
const mine = (s) => s.queue.filter((e) => e.bracket === s.brackets[0].key);
const slot = (s, id) => s.queue.find((e) => e.slot === id);
// Kampf beenden: Sieger nach Name oder Seite
function win(s, id, who) {
  const e = slot(s, id);
  assert.ok(e, 'Paarung ' + id + ' fehlt');
  assert.ok(!e.pending, 'Paarung ' + id + ' steht noch nicht fest');
  const side = who === 'white' || who === 'blue' ? who : e.white.name === who ? 'white' : 'blue';
  e.status = 'done';
  e.result = { winner: side, reason: 'Ippon', kind: 'ippon' };
  B.sync(s);
  return e[side].name;
}

test('Vorschlag nach Gruppengröße, Grenzen einstellbar', () => {
  assert.strictEqual(B.suggest(1), null);
  assert.strictEqual(B.suggest(2), 'bo3');
  assert.strictEqual(B.suggest(2, { bo3: false }), 'rr');
  assert.strictEqual(B.suggest(5), 'rr');
  assert.strictEqual(B.suggest(6), 'pool2');
  assert.strictEqual(B.suggest(8), 'pool2');
  assert.strictEqual(B.suggest(9), 'ko');
  assert.strictEqual(B.suggest(6, { rrMax: 6 }), 'rr');
  assert.strictEqual(B.suggest(7, { rrMax: 4, poolMax: 4 }), 'ko');
});

test('Setzliste: 1 und 2 in verschiedenen Hälften', () => {
  assert.deepStrictEqual(B.seedOrder(8), [1, 8, 4, 5, 2, 7, 3, 6]);
});

test('Vereinstrennung: Vereinskameraden erst im Finale (K.-o., 8 Kämpfer)', () => {
  for (let seed = 1; seed < 30; seed++) {
    const ps = people(8, ['A', 'A', 'B', 'C', 'D', 'E', 'F', 'G']);
    const order = B.drawOrder(ps, rng(seed));
    const pos = (name) => B.seedOrder(8).indexOf(order.findIndex((p) => p.name === name) + 1);
    assert.notStrictEqual(pos('K1') < 4, pos('K2') < 4, 'Verein A in derselben Hälfte');
  }
});

test('Anzahl Kämpfe je System', () => {
  assert.strictEqual(B.fightCount('rr', 5), 10);
  assert.strictEqual(B.fightCount('bo3', 2), 3);
  assert.strictEqual(B.fightCount('pool2', 6), 3 + 3 + 3);
  assert.strictEqual(B.fightCount('pool2', 7), 6 + 3 + 3);
  assert.strictEqual(B.fightCount('ko', 8), 7 + 2 + 2);
  assert.strictEqual(B.fightCount('ko', 4), 3);
  assert.strictEqual(B.fightCount('ko', 5), 5); // 1 VF, 2 HF, Finale, 1 Kampf um Platz 3
  assert.strictEqual(B.fightCount('ko', 9), 8 + 2 + 2); // ca. Kämpfer + 2
});

test('K.-o. mit 8: Kampfliste mit Platzhaltern, Sieger rücken nach', () => {
  const s = setup('ko', 8);
  const list = mine(s);
  assert.strictEqual(list.length, 11);
  assert.deepStrictEqual(list.map((e) => e.slot), ['VF1', 'VF2', 'VF3', 'VF4', 'TRA', 'TRB', 'HF1', 'HF2', 'P3A', 'P3B', 'F']);
  const hf1 = slot(s, 'HF1');
  assert.ok(hf1.pending);
  assert.strictEqual(hf1.whiteFrom, 'Sieger VF 1');
  assert.strictEqual(slot(s, 'P3A').blueFrom, 'Verlierer HF 2');
  const w1 = win(s, 'VF1', 'white');
  assert.strictEqual(slot(s, 'HF1').white.name, w1);
  assert.ok(slot(s, 'HF1').pending, 'Gegner fehlt noch');
  win(s, 'VF2', 'blue');
  assert.ok(!slot(s, 'HF1').pending);
  // Ergebnis zurücknehmen: Platzhalter kommt zurück
  const vf1 = slot(s, 'VF1');
  vf1.status = 'open';
  vf1.result = null;
  B.sync(s);
  assert.strictEqual(slot(s, 'HF1').white.name, '');
  assert.ok(slot(s, 'HF1').pending);
});

test('K.-o. mit 8: Platzierungen 1, 2, 3, 3, 5, 5, 7, 7', () => {
  const s = setup('ko', 8);
  ['VF1', 'VF2', 'VF3', 'VF4', 'TRA', 'TRB', 'HF1', 'HF2', 'P3A', 'P3B', 'F'].forEach((id) => win(s, id, 'white'));
  const t = B.allTables(s)[0];
  assert.ok(t.complete);
  assert.strictEqual(t.total, 11);
  assert.deepStrictEqual(t.rows.map((r) => r.place), [1, 2, 3, 3, 5, 5, 7, 7]);
  const f = slot(s, 'F');
  assert.strictEqual(t.rows[0].name, f.white.name);
  assert.strictEqual(t.rows[1].name, f.blue.name);
  assert.strictEqual(C.awardRows(t, '3').length, 4);
});

test('K.-o. mit 5: Freilose ohne Kampf, Trostrunde fällt aus', () => {
  const s = setup('ko', 5);
  const list = mine(s);
  assert.strictEqual(list.length, 5);
  assert.deepStrictEqual(list.map((e) => e.slot).sort(), ['F', 'HF1', 'HF2', 'P3A', 'VF2'].sort());
  // HF2: beide Kämpfer haben ein Freilos und stehen sofort fest
  assert.ok(!slot(s, 'HF2').pending);
  assert.ok(slot(s, 'HF1').white.name, 'Setzplatz 1 steht fest');
  assert.strictEqual(slot(s, 'HF1').blueFrom, 'Sieger VF 2');
  const loserVf2 = slot(s, 'VF2').blue.name;
  win(s, 'VF2', 'white');
  // Verlierer VF 2 kommt über das Freilos der Trostrunde direkt in den Kampf um Platz 3
  assert.strictEqual(slot(s, 'P3A').white.name, loserVf2);
  win(s, 'HF1', 'white');
  win(s, 'HF2', 'white');
  win(s, 'P3A', 'white');
  win(s, 'F', 'white');
  const t = B.allTables(s)[0];
  assert.ok(t.complete);
  assert.deepStrictEqual(t.rows.map((r) => r.place), [1, 2, 3, 3, 5]);
});

test('K.-o. mit 12: Achtelfinale, Verlierer davor Platz 9', () => {
  const s = setup('ko', 12);
  assert.strictEqual(mine(s).length, B.fightCount('ko', 12));
  const order = mine(s).map((e) => e.slot);
  order.forEach((id) => slot(s, id) && slot(s, id).status !== 'done' && win(s, id, 'white'));
  const t = B.allTables(s)[0];
  assert.ok(t.complete);
  assert.deepStrictEqual(t.rows.map((r) => r.place), [1, 2, 3, 3, 5, 5, 7, 7, 9, 9, 9, 9]);
});

test('Doppel-Pool mit 6: Überkreuz-Halbfinale, Plätze', () => {
  const s = setup('pool2', 6);
  const list = mine(s);
  assert.strictEqual(list.length, 9);
  assert.strictEqual(slot(s, 'HF1').whiteFrom, '1. Pool A');
  assert.strictEqual(slot(s, 'HF1').blueFrom, '2. Pool B');
  // Pools: immer gewinnt Weiß
  list.filter((e) => /^[AB]\d/.test(e.slot)).forEach((e) => win(s, e.slot, 'white'));
  const t0 = B.allTables(s)[0];
  // 3er-Pool, immer Weiß gewinnt: kann einen Kreis ergeben → Stichkampf nötig oder klar
  t0.pools.forEach((p) => assert.ok(p.complete));
  const clear = t0.pools.every((p) => !p.ties.length);
  if (clear) {
    assert.ok(!slot(s, 'HF1').pending);
    win(s, 'HF1', 'white');
    win(s, 'HF2', 'white');
    win(s, 'F', 'white');
    const t = B.allTables(s)[0];
    assert.ok(t.complete);
    assert.deepStrictEqual(t.rows.map((r) => r.place), [1, 2, 3, 3, 5, 5]);
  } else assert.ok(slot(s, 'HF1').pending, 'bei Gleichstand bleibt das Halbfinale offen');
});

test('Doppel-Pool: Kämpfe der Pools wechseln sich ab', () => {
  const s = setup('pool2', 8);
  const slots = mine(s).map((e) => e.slot);
  assert.deepStrictEqual(slots.slice(0, 4), ['A1', 'B1', 'A2', 'B2']);
  assert.strictEqual(slots.length, 6 + 6 + 3);
});

test('Best of Three: 2:0 → dritter Kampf entfällt, 1:1 → dritter Kampf', () => {
  let s = setup('bo3', 2);
  assert.strictEqual(mine(s).length, 3);
  assert.ok(slot(s, 'G3').pending);
  const a = slot(s, 'G1').white.name;
  win(s, 'G1', a);
  assert.ok(slot(s, 'G3').pending);
  win(s, 'G2', a);
  assert.strictEqual(slot(s, 'G3').status, 'skipped');
  let t = B.allTables(s)[0];
  assert.ok(t.complete);
  assert.strictEqual(t.rows[0].name, a);
  assert.strictEqual(t.rows[0].place, 1);

  s = setup('bo3', 2);
  const x = slot(s, 'G1').white.name;
  win(s, 'G1', x);
  const y = win(s, 'G2', slot(s, 'G2').white.name === x ? 'blue' : 'white');
  assert.notStrictEqual(x, y);
  assert.strictEqual(slot(s, 'G3').status, 'open');
  assert.ok(!slot(s, 'G3').pending);
  win(s, 'G3', y);
  t = B.allTables(s)[0];
  assert.ok(t.complete);
  assert.strictEqual(t.rows[0].name, y);
});

test('Jeder gegen jeden als System: gleiche Tabelle wie bisher', () => {
  const s = setup('rr', 4);
  assert.strictEqual(mine(s).length, 6);
  assert.ok(mine(s).every((e) => !e.pending && e.white.name && e.blue.name));
  mine(s).forEach((e) => win(s, e.slot, 'white'));
  const t = B.allTables(s)[0];
  assert.ok(t.complete);
  assert.strictEqual(t.system, 'rr');
});

test('Turnierbaum-Daten: Spalten, Trostrunde, Podest', () => {
  const s = setup('ko', 8);
  win(s, 'VF1', 'white');
  const m = B.treeModel(s, s.brackets[0], slot(s, 'VF2').id);
  assert.deepStrictEqual(m.columns.map((c) => c.title), ['Viertelfinale', 'Halbfinale', 'Finale']);
  assert.strictEqual(m.columns[0].matches[0].white.win, true);
  assert.strictEqual(m.columns[0].matches[0].reason, 'Ippon');
  assert.strictEqual(m.extra.length, 3);
  assert.strictEqual(m.podium.length, 4);
  assert.strictEqual(m.podium[0].name, '');
});

test('Abhängigkeiten und mögliche Kämpfer eines Platzhalters', () => {
  const s = setup('ko', 8);
  const hf1 = slot(s, 'HF1');
  const info = B.entryInfo(s, hf1);
  assert.deepStrictEqual(info.deps.sort(), [slot(s, 'VF1').id, slot(s, 'VF2').id].sort());
  assert.strictEqual(info.people.size, 4);
});

console.log(`\n${passed} Tests bestanden`);
