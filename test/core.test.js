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

console.log(`\n${passed} Tests bestanden`);
