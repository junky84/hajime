// Tests der Wettkampflogik: node test/core.test.js
const assert = require('assert');
const C = require('../src/js/core.js');

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

function fresh(profileId) {
  const s = C.createState();
  if (profileId) C.applyProfile(s, profileId, 0);
  return s;
}

test('Hajime startet, Mate stoppt die Uhr', () => {
  const s = fresh();
  C.hajimeMate(s, 1000);
  assert.strictEqual(s.fight.status, 'running');
  C.hajimeMate(s, 11000);
  assert.strictEqual(s.fight.status, 'paused');
  assert.strictEqual(C.clockMs(s.fight.clock, 99999), 230000);
});

test('Ippon beendet den Kampf (Erwachsene)', () => {
  const s = fresh();
  C.hajimeMate(s, 0);
  C.addScore(s, 'blue', 'ippon', 1, 5000);
  assert.strictEqual(s.fight.status, 'finished');
  assert.strictEqual(s.fight.winner, 'blue');
  assert.strictEqual(s.fight.reason, 'Ippon');
});

test('2x Waza-ari = Ippon', () => {
  const s = fresh();
  C.hajimeMate(s, 0);
  C.addScore(s, 'white', 'wazaari', 1, 1000);
  assert.strictEqual(s.fight.status, 'running');
  C.addScore(s, 'white', 'wazaari', 1, 2000);
  assert.strictEqual(s.fight.winner, 'white');
  assert.strictEqual(s.fight.reason, 'Waza-ari-awasete-ippon');
});

test('U11: Ippon beendet nicht, Sieger nach Zeit über Anzahl', () => {
  const s = fresh('p-u11');
  assert.strictEqual(s.fight.clock.baseMs, 120000);
  C.hajimeMate(s, 0);
  C.addScore(s, 'white', 'ippon', 1, 1000);
  C.addScore(s, 'blue', 'ippon', 1, 2000);
  C.addScore(s, 'blue', 'wazaari', 1, 3000);
  assert.strictEqual(s.fight.status, 'running');
  C.tick(s, 120000);
  assert.strictEqual(s.fight.status, 'finished');
  assert.strictEqual(s.fight.winner, 'blue');
  assert.strictEqual(s.fight.reason, 'Waza-ari');
});

test('Gleichstand -> Golden Score -> erste Wertung gewinnt', () => {
  const s = fresh();
  C.hajimeMate(s, 0);
  C.addScore(s, 'white', 'shido', 1, 1000);
  C.tick(s, 240000);
  assert.strictEqual(s.fight.status, 'timeup');
  assert.ok(s.fight.sound && s.fight.sound.kind === 'gong');
  C.hajimeMate(s, 250000);
  assert.strictEqual(s.fight.clock.mode, 'golden');
  C.tick(s, 290000);
  assert.strictEqual(C.formatClock(C.clockMs(s.fight.clock, 290000), 'golden'), '0:40');
  C.addScore(s, 'blue', 'yuko', 1, 291000);
  assert.strictEqual(s.fight.winner, 'blue');
  assert.ok(s.fight.reason.startsWith('Golden Score'));
});

test('Golden-Score-Limit -> Kampfrichterentscheid', () => {
  const s = fresh('p-u13');
  C.hajimeMate(s, 0);
  C.tick(s, 180000);
  assert.strictEqual(s.fight.status, 'timeup');
  C.hajimeMate(s, 181000);
  C.tick(s, 241000);
  assert.strictEqual(s.fight.status, 'timeup');
  assert.strictEqual(C.hajimeMate(s, 242000), false);
  C.setWinner(s, 'white', 'Hantei', 243000);
  assert.strictEqual(s.fight.winner, 'white');
  assert.ok(s.fight.manual);
});

test('3. Shido = Hansoku-make', () => {
  const s = fresh();
  C.hajimeMate(s, 0);
  C.addScore(s, 'white', 'shido', 1, 1);
  C.addScore(s, 'white', 'shido', 1, 2);
  assert.strictEqual(s.fight.status, 'running');
  C.addScore(s, 'white', 'shido', 1, 3);
  assert.strictEqual(s.fight.winner, 'blue');
  assert.strictEqual(s.fight.reason, 'Hansoku-make');
  assert.strictEqual(s.fight.flash.text, 'HANSOKU-MAKE');
});

test('Osaekomi: Toketa nach 7 s = Yuko, nach 12 s = Waza-ari', () => {
  const s = fresh();
  C.startOsae(s, 'blue', 0);
  assert.strictEqual(s.fight.status, 'running');
  C.toketa(s, 7400);
  assert.strictEqual(s.fight.blue.yuko, 1);
  C.startOsae(s, 'white', 10000);
  C.toketa(s, 22000);
  assert.strictEqual(s.fight.white.wazaari, 1);
  assert.strictEqual(s.fight.status, 'running');
});

test('Osaekomi 20 s = automatisch Ippon', () => {
  const s = fresh();
  C.startOsae(s, 'white', 0);
  C.tick(s, 19900);
  assert.strictEqual(s.fight.status, 'running');
  C.tick(s, 20000);
  assert.strictEqual(s.fight.winner, 'white');
  assert.strictEqual(s.fight.reason, 'Ippon');
});

test('Jugend: Osaekomi 20 s -> Ippon gezählt, automatisch Mate + Gong', () => {
  const s = fresh('p-u11');
  C.hajimeMate(s, 0);
  C.startOsae(s, 'blue', 10000);
  C.tick(s, 30000);
  assert.strictEqual(s.fight.blue.ippon, 1);
  assert.strictEqual(s.fight.status, 'paused');
  assert.strictEqual(C.clockRunning(s.fight.clock), false);
  assert.strictEqual(C.clockMs(s.fight.clock, 99999), 90000);
  assert.strictEqual(s.fight.sound.kind, 'gong');
  C.hajimeMate(s, 40000); // weiter mit Hajime
  assert.strictEqual(s.fight.status, 'running');
});

test('Ohne Osaekomi-Automatik: nach 20 s Mate + Gong, keine Wertung', () => {
  const s = fresh();
  C.getRules(s).autoOsae = false;
  C.hajimeMate(s, 0);
  C.startOsae(s, 'white', 1000);
  C.tick(s, 21000);
  assert.strictEqual(s.fight.white.ippon, 0);
  assert.strictEqual(s.fight.status, 'paused');
  assert.strictEqual(s.fight.sound.kind, 'gong');
});

test('Osaekomi mit Waza-ari endet nach 10 s (awasete)', () => {
  const s = fresh();
  C.hajimeMate(s, 0);
  C.addScore(s, 'blue', 'wazaari', 1, 100);
  C.startOsae(s, 'blue', 1000);
  C.tick(s, 11000);
  assert.strictEqual(s.fight.winner, 'blue');
  assert.strictEqual(s.fight.reason, 'Waza-ari-awasete-ippon');
});

test('Zeitende während Osaekomi: Haltegriff läuft weiter', () => {
  const s = fresh();
  C.hajimeMate(s, 0);
  C.startOsae(s, 'white', 235000);
  C.tick(s, 240000);
  assert.strictEqual(s.fight.status, 'running');
  assert.strictEqual(C.clockMs(s.fight.clock, 241000), 0);
  C.toketa(s, 242000); // 7 s -> Yuko, danach Zeitende-Wertung
  assert.strictEqual(s.fight.winner, 'white');
  assert.strictEqual(s.fight.reason, 'Yuko');
});

test('Korrektur nimmt automatischen Sieg zurück', () => {
  const s = fresh();
  C.hajimeMate(s, 0);
  C.addScore(s, 'white', 'ippon', 1, 30000);
  assert.strictEqual(s.fight.status, 'finished');
  C.addScore(s, 'white', 'ippon', -1, 31000);
  assert.strictEqual(s.fight.status, 'paused');
  assert.strictEqual(s.fight.winner, null);
});

test('Profil per Altersklasse finden', () => {
  const s = fresh();
  assert.strictEqual(C.findProfileFor(s, 'u13').id, 'p-u13');
  assert.strictEqual(C.findProfileFor(s, 'Männer').id, 'p-adult');
  assert.strictEqual(C.findProfileFor(s, 'U21 weiblich').id, 'p-adult');
  assert.strictEqual(C.findProfileFor(s, 'xyz'), null);
});

test('Jeder-gegen-jeden: alle Paarungen genau einmal', () => {
  for (let n = 2; n <= 7; n++) {
    const pl = Array.from({ length: n }, (_, i) => 'P' + i);
    const pairs = C.roundRobin(pl);
    assert.strictEqual(pairs.length, (n * (n - 1)) / 2);
    const set = new Set(pairs.map((p) => p.slice().sort().join('-')));
    assert.strictEqual(set.size, pairs.length);
  }
});

test('Wiederherstellen pausiert alte laufende Uhr', () => {
  const s = fresh();
  C.hajimeMate(s, 1000);
  s.savedAt = 11000;
  const r = C.restore(JSON.parse(JSON.stringify(s)), 500000);
  assert.strictEqual(r.fight.status, 'paused');
  assert.strictEqual(C.clockMs(r.fight.clock, 999999), 230000);
});

test('Zeitanzeige', () => {
  assert.strictEqual(C.formatClock(240000, 'regular'), '4:00');
  assert.strictEqual(C.formatClock(239001, 'regular'), '4:00');
  assert.strictEqual(C.formatClock(500, 'regular'), '0:01');
  assert.strictEqual(C.formatClock(0, 'regular'), '0:00');
  assert.strictEqual(C.formatClock(61999, 'golden'), '1:01');
});

test('Ereignisprotokoll: Aktionen mit Kampfzeit', () => {
  const s = fresh('p-u11');
  C.hajimeMate(s, 0);
  C.addScore(s, 'blue', 'shido', 1, 26000);
  C.addScore(s, 'blue', 'shido', -1, 30000);
  C.addScore(s, 'white', 'wazaari', 1, 47000);
  C.hajimeMate(s, 53000);
  C.hajimeMate(s, 60000);
  C.startOsae(s, 'blue', 74000);
  C.tick(s, 84100); // 10 s: noch kein Ende (U11: Ippon beendet nicht)
  C.tick(s, 94100); // 20 s: Haltegriff voll → Ippon, Mate
  const texts = s.fight.events.map((e) => e.text);
  assert.deepStrictEqual(texts, [
    'Hajime',
    'Shido Blau',
    'Korrektur: Shido Blau zurückgenommen',
    'Waza-ari Weiß',
    'Mate',
    'Hajime',
    'Osaekomi Blau',
    'Osaekomi 20 s → Ippon Blau (automatisch)',
    'Mate (Haltegriff ausgehalten)',
  ]);
  assert.strictEqual(s.fight.events[0].clock, '2:00');
  assert.strictEqual(s.fight.events[1].clock, '1:34');
  assert.ok(s.fight.events.every((e) => typeof e.at === 'number'));
});

test('Ereignisprotokoll: Uhr-Korrekturen werden zusammengefasst', () => {
  const s = fresh();
  C.adjustClock(s, -1000, 1000);
  C.adjustClock(s, -1000, 1500);
  C.adjustClock(s, -1000, 2000);
  assert.strictEqual(s.fight.events.length, 1);
  assert.strictEqual(s.fight.events[0].text, 'Uhr gestellt auf 3:57');
});

/* ---------- Auswertung ---------- */

function fight(a, b, winner, reason, extra) {
  return Object.assign(
    { id: C.uid(), ageClass: 'U11', category: '-28 kg', white: { name: a, club: 'Verein ' + a }, blue: { name: b }, status: winner ? 'done' : 'open', result: winner ? { winner, reason } : null },
    extra || {}
  );
}
const poolOf = (entries) => C.poolGroups(entries)[0];

test('Siegart aus Entscheidung und Wertungen', () => {
  assert.strictEqual(C.winKind('white', 'Ippon'), 'ippon');
  assert.strictEqual(C.winKind('white', 'Waza-ari-awasete-ippon'), 'ippon');
  assert.strictEqual(C.winKind('blue', 'Hansoku-make'), 'ippon');
  assert.strictEqual(C.winKind('blue', 'Fusen-gachi (nicht angetreten)'), 'ippon');
  assert.strictEqual(C.winKind('white', 'Golden Score – Waza-ari'), 'wazaari');
  assert.strictEqual(C.winKind('white', 'Yuko'), 'yuko');
  assert.strictEqual(C.winKind('white', 'Hantei'), 'decision');
  assert.strictEqual(C.winKind('white', 'weniger Shido'), 'decision');
  assert.strictEqual(C.winKind('draw', 'Unentschieden'), null);
  const sc = { white: { ippon: 0, wazaari: 1, yuko: 2 }, blue: { ippon: 0, wazaari: 1, yuko: 0 } };
  assert.strictEqual(C.winKind('white', 'Entscheidung', sc), 'yuko');
});

test('Gruppentabelle: Beispiel aus dem Issue (10/7/5)', () => {
  const t = C.standings(
    poolOf([
      fight('Mia Kaltenbach', 'Noah Fischbach', 'white', 'Waza-ari'),
      fight('Lukas Brenner', 'Mia Kaltenbach', 'blue', 'Ippon'),
      fight('Mia Kaltenbach', 'Emma Rothmund', 'white', 'Ippon'),
      fight('Lukas Brenner', 'Noah Fischbach', 'white', 'Waza-ari'),
      fight('Emma Rothmund', 'Lukas Brenner', 'blue', 'Ippon'),
      fight('Noah Fischbach', 'Emma Rothmund', 'white', 'Ippon'),
    ])
  );
  assert.strictEqual(t.complete, true);
  assert.strictEqual(t.done, 6);
  assert.deepStrictEqual(
    t.rows.map((r) => [r.place, r.name, r.wins, r.points, `${r.ippon}·${r.wazaari}·${r.yuko}`]),
    [
      [1, 'Mia Kaltenbach', 3, 27, '2·1·0'],
      [2, 'Lukas Brenner', 2, 17, '1·1·0'],
      [3, 'Noah Fischbach', 1, 10, '1·0·0'],
      [4, 'Emma Rothmund', 0, 0, '0·0·0'],
    ]
  );
  assert.strictEqual(t.rows[0].club, 'Verein Mia Kaltenbach');
  assert.strictEqual(t.ties.length, 0);
});

test('Gruppentabelle: gleiche Siege, Wertungspunkte entscheiden', () => {
  const t = C.standings(poolOf([fight('A', 'B', 'white', 'Yuko'), fight('B', 'C', 'white', 'Ippon'), fight('C', 'A', 'white', 'Waza-ari')]));
  // alle 1 Sieg: B 10, C 7, A 5
  assert.deepStrictEqual(t.rows.map((r) => r.name + r.place), ['B1', 'C2', 'A3']);
});

test('Gruppentabelle: gleiche Siege und Punkte → direkter Vergleich', () => {
  const entries = [fight('A', 'B', 'blue', 'Ippon'), fight('A', 'C', 'white', 'Ippon'), fight('B', 'C', 'blue', 'Ippon'), fight('A', 'D', 'white', 'Ippon'), fight('B', 'D', 'white', 'Ippon'), fight('C', 'D', 'white', 'Ippon')];
  // A, B, C je 2 Siege und 20 Punkte → Kreis: A>C, C>B, B>A → Stichkampf nötig
  let t = C.standings(poolOf(entries));
  assert.deepStrictEqual(t.rows.map((r) => [r.name, r.place, r.tie]), [['A', 1, true], ['B', 1, true], ['C', 1, true], ['D', 4, false]]);
  assert.deepStrictEqual(t.ties, [['A', 'B', 'C']]);
  // Zwei gleich: D schlägt C statt umgekehrt → A und B je 2 Siege, B hat A geschlagen
  entries[5] = fight('C', 'D', 'blue', 'Ippon');
  t = C.standings(poolOf(entries));
  assert.deepStrictEqual(t.rows.slice(0, 2).map((r) => [r.name, r.place, r.tie]), [['B', 1, false], ['A', 2, false]]);
});

test('Gruppentabelle: Stichkampf löst Kreis-Gleichstand auf, zählt aber nicht als Sieg', () => {
  const entries = [fight('A', 'B', 'white', 'Ippon'), fight('B', 'C', 'white', 'Ippon'), fight('C', 'A', 'white', 'Ippon')];
  assert.strictEqual(C.standings(poolOf(entries)).ties.length, 1);
  entries.push(fight('A', 'B', 'white', 'Waza-ari', { tiebreak: true }));
  entries.push(fight('B', 'C', 'white', 'Waza-ari', { tiebreak: true }));
  entries.push(fight('C', 'A', 'blue', 'Waza-ari', { tiebreak: true }));
  const t = C.standings(poolOf(entries));
  assert.deepStrictEqual(t.rows.map((r) => [r.name, r.place, r.wins]), [['A', 1, 1], ['B', 2, 1], ['C', 3, 1]]);
  assert.strictEqual(t.ties.length, 0);
  assert.strictEqual(t.total, 3);
});

test('Gruppentabelle: Reihenfolge „direkter Vergleich vor Punkten“', () => {
  // A und B je 2 Siege: A 20 Punkte, B 10 Punkte, aber B hat A geschlagen. C und D je 1 Sieg (5), D hat C geschlagen.
  const entries = [fight('A', 'B', 'blue', 'Yuko'), fight('A', 'C', 'white', 'Ippon'), fight('A', 'D', 'white', 'Ippon'), fight('B', 'C', 'blue', 'Yuko'), fight('B', 'D', 'white', 'Yuko'), fight('C', 'D', 'blue', 'Yuko')];
  let t = C.standings(poolOf(entries));
  assert.deepStrictEqual(t.rows.map((r) => r.name), ['A', 'B', 'D', 'C']);
  t = C.standings(poolOf(entries), { rankOrder: 'direct' });
  assert.deepStrictEqual(t.rows.map((r) => r.name), ['B', 'A', 'D', 'C']);
  assert.strictEqual(t.ties.length, 0);
});

test('Gruppentabelle: nach Kreis und Punkten entscheidet der direkte Vergleich der letzten zwei', () => {
  // A, B, C je 1 Sieg im Kreis; A 10 Punkte, B und C je 5 → C hat B geschlagen
  const entries = [fight('A', 'B', 'blue', 'Yuko'), fight('A', 'C', 'white', 'Ippon'), fight('B', 'C', 'blue', 'Yuko')];
  assert.deepStrictEqual(C.standings(poolOf(entries), { rankOrder: 'direct' }).rows.map((r) => r.name), ['A', 'C', 'B']);
  assert.deepStrictEqual(C.standings(poolOf(entries)).rows.map((r) => r.name), ['A', 'C', 'B']);
});

test('Gruppentabelle: unvollständige Gruppe, Unentschieden, eigene Wertungspunkte', () => {
  const t = C.standings(poolOf([fight('A', 'B', 'white', 'Waza-ari'), fight('A', 'C', 'draw', 'Unentschieden'), fight('B', 'C')]), { winPoints: { wazaari: 1 } });
  assert.strictEqual(t.complete, false);
  assert.strictEqual(t.done, 2);
  assert.strictEqual(t.total, 3);
  const a = t.rows.find((r) => r.name === 'A');
  assert.strictEqual(a.points, 1);
  assert.strictEqual(a.draws, 1);
  assert.strictEqual(a.place, 1);
  // B und C gleich, aber Gruppe nicht fertig → noch kein „Stichkampf nötig“
  assert.ok(t.rows.every((r) => !r.tie));
});

test('Gruppen nach Klasse getrennt', () => {
  const gs = C.poolGroups([fight('A', 'B'), Object.assign(fight('C', 'D'), { category: '-31 kg' }), fight('A', 'E')]);
  assert.deepStrictEqual(gs.map((g) => [g.label, g.entries.length]), [['U11 -28 kg', 2], ['U11 -31 kg', 1]]);
});

test('Siegerliste: Plätze 1–3 oder alle', () => {
  const t = C.standings(poolOf([fight('A', 'B', 'white', 'Ippon'), fight('A', 'C', 'white', 'Ippon'), fight('A', 'D', 'white', 'Ippon'), fight('B', 'C', 'white', 'Ippon'), fight('B', 'D', 'white', 'Ippon'), fight('C', 'D', 'white', 'Ippon')]));
  assert.deepStrictEqual(C.awardRows(t, '3').map((r) => r.name), ['A', 'B', 'C']);
  assert.strictEqual(C.awardRows(t, 'all').length, 4);
});

/* ---------- Ruhezeit ---------- */

test('Ruhezeit: Warnung mit Restzeit, danach bereit', () => {
  const s = C.createState();
  const end = 1000000;
  s.log.push({ fightId: 'f4', no: '4', finishedAt: end, ageClass: 'U11', white: { name: 'Noah Fischbach' }, blue: { name: 'Emma Rothmund' } });
  const entry = { ageClass: 'U11', white: { name: 'Lukas Brenner' }, blue: { name: 'noah fischbach' } };
  let r = C.restCheck(s, entry, end + 140000); // 2:20 nach Kampfende
  assert.strictEqual(r.restMs, 300000);
  assert.strictEqual(r.profile, 'U11');
  assert.strictEqual(r.waits.length, 1);
  assert.strictEqual(r.waits[0].side, 'blue');
  assert.strictEqual(r.waits[0].lastNo, '4');
  assert.strictEqual(C.formatClock(r.waits[0].remainingMs, 'regular'), '2:40');
  r = C.restCheck(s, entry, end + 300000);
  assert.strictEqual(r.waits.length, 0);
});

test('Ruhezeit: 0 = aus, eigener Kampf zählt beim Neuladen nicht', () => {
  const s = C.createState();
  s.log.push({ fightId: 'f1', no: '1', finishedAt: 5000, white: { name: 'A' }, blue: { name: 'B' } });
  s.profiles.find((p) => p.id === 'p-u11').restTime = 0;
  assert.strictEqual(C.restCheck(s, { ageClass: 'U11', white: { name: 'A' }, blue: { name: 'C' } }, 6000).waits.length, 0);
  // Erwachsene (10 min): Kampf f1 selbst erneut laden → keine Warnung
  assert.strictEqual(C.restCheck(s, { ageClass: 'Männer', white: { name: 'A' }, blue: { name: 'B' }, result: { fightId: 'f1' } }, 6000).waits.length, 0);
  assert.strictEqual(C.restCheck(s, { ageClass: 'Männer', white: { name: 'A' }, blue: { name: 'C' } }, 6000).waits.length, 1);
});

test('Wiederherstellen: alte Profile bekommen die Standard-Ruhezeit, eigene bleiben aus', () => {
  const old = C.createState();
  old.profiles.forEach((p) => delete p.restTime);
  old.profiles.push({ id: 'x', name: 'Eigenes' });
  delete old.settings.winPoints;
  const s = C.restore(JSON.parse(JSON.stringify(old)), 0);
  assert.strictEqual(s.profiles.find((p) => p.id === 'p-u11').restTime, 300);
  assert.strictEqual(s.profiles.find((p) => p.id === 'x').restTime, 0);
  assert.deepStrictEqual(s.settings.winPoints, C.DEFAULT_WIN_POINTS);
});

test('Geschlecht: Erkennung und eigene Gruppen', () => {
  assert.deepStrictEqual(['m', 'W', 'männlich', 'Mädchen', 'Damen', 'Herren', 'Jungen', 'divers', 'x', '', 'U13'].map(C.normGender), ['m', 'w', 'm', 'w', 'w', 'm', 'm', 'd', 'd', '', '']);
  const e = (gender) => ({ ageClass: 'U13', category: '-34 kg', gender, white: { name: 'A' }, blue: { name: 'B' } });
  const gs = C.poolGroups([e('w'), e('m'), e('w'), e('')]);
  assert.deepStrictEqual(gs.map((g) => [g.label, g.entries.length]), [['U13 w -34 kg', 2], ['U13 m -34 kg', 1], ['U13 -34 kg', 1]]);
  assert.strictEqual(C.classLabel({}), '');
});

console.log(`\n${passed} Tests bestanden`);
