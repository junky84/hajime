// Tests des Mannschaftskampfs: node test/team.test.js
const assert = require('assert');
const C = require('../src/js/core.js');
const TM = require('../src/js/team.js');

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

function setup(legs) {
  const s = C.createState();
  s.team = TM.normTeam({
    active: true,
    title: 'Bezirksliga',
    ageClass: 'Männer',
    white: { name: 'JC Mittelstadt' },
    blue: { name: 'TSV Lindenau' },
    classes: ['-60 kg', '-66 kg', '-73 kg'],
    legs: legs || 1,
  });
  const lu = s.team.lineup[0];
  lu.white = { '-60 kg': 'Paul Hagedorn', '-66 kg': 'Leon Pfisterer', '-73 kg': 'Jonas Eichhorn' };
  lu.blue = { '-60 kg': 'Lea Dornbusch', '-73 kg': 'Finn Ostermann' };
  return s;
}
function finish(s, cls, winner, reason, scores) {
  const e = s.queue.find((q) => q.category === cls && q.status !== 'done');
  e.status = 'done';
  e.result = { winner, reason, scores };
  return e;
}

test('Kampfliste aus der Aufstellung, unbesetzte Klasse = kampfloser Sieg', () => {
  const s = setup();
  assert.strictEqual(TM.sync(s), true);
  assert.strictEqual(s.queue.length, 3);
  assert.deepStrictEqual(s.queue.map((e) => [e.no, e.category, e.white.name, e.blue.name]), [
    ['1', '-60 kg', 'Paul Hagedorn', 'Lea Dornbusch'],
    ['2', '-66 kg', 'Leon Pfisterer', ''],
    ['3', '-73 kg', 'Jonas Eichhorn', 'Finn Ostermann'],
  ]);
  const vacant = s.queue[1];
  assert.strictEqual(vacant.status, 'done');
  assert.strictEqual(vacant.result.winner, 'white');
  assert.strictEqual(vacant.white.club, 'JC Mittelstadt');
  assert.strictEqual(TM.sync(s), false); // stabil
  assert.strictEqual(C.poolGroups(s.queue).length, 0); // keine Gruppentabellen
});

test('Mannschaftsstand: Siege, dann Unterbewertungen', () => {
  const s = setup();
  TM.sync(s);
  finish(s, '-60 kg', 'white', 'Ippon');
  finish(s, '-73 kg', 'blue', 'Hantei', { white: { ippon: 0, wazaari: 0, yuko: 0 }, blue: { ippon: 0, wazaari: 1, yuko: 0 } });
  const sc = TM.score(s);
  assert.deepStrictEqual(sc.white, { wins: 2, points: 20 });
  assert.deepStrictEqual(sc.blue, { wins: 1, points: 7 });
  assert.strictEqual(sc.winner, 'white');
  assert.strictEqual(sc.done, 3);
});

test('Gleich viele Siege: Unterbewertungen entscheiden (oder unentschieden)', () => {
  const s = setup();
  s.team.lineup[0].blue['-66 kg'] = 'Max Muster';
  TM.sync(s);
  assert.strictEqual(s.queue[1].status, 'open'); // jetzt besetzt
  finish(s, '-60 kg', 'white', 'Ippon');
  finish(s, '-66 kg', 'blue', 'Waza-ari');
  finish(s, '-73 kg', 'draw', 'Unentschieden');
  let sc = TM.score(s);
  assert.strictEqual(sc.winner, 'white'); // 1:1 Siege, 10:7
  s.team.rule = 'wins';
  sc = TM.score(s);
  assert.strictEqual(sc.winner, 'draw');
});

test('Hin- und Rückrunde, Startklasse, Änderung der Aufstellung setzt Ergebnis zurück', () => {
  const s = setup(2);
  s.team.start = 2;
  s.team.lineup[1] = { white: { '-60 kg': 'A', '-66 kg': 'B', '-73 kg': 'C' }, blue: { '-60 kg': 'D', '-66 kg': 'E', '-73 kg': 'F' } };
  TM.sync(s);
  assert.deepStrictEqual(s.queue.map((e) => e.category + '/' + e.leg), ['-73 kg/1', '-60 kg/1', '-66 kg/1', '-73 kg/2', '-60 kg/2', '-66 kg/2']);
  assert.strictEqual(s.queue[3].round, 'Rückrunde');
  const e = finish(s, '-73 kg', 'white', 'Ippon');
  s.team.lineup[0].white['-73 kg'] = 'Ersatz';
  TM.sync(s);
  assert.strictEqual(e.status, 'open');
  assert.strictEqual(e.white.name, 'Ersatz');
});

test('Andere Kämpfe der Kampfliste bleiben erhalten', () => {
  const s = setup();
  s.queue.push({ id: 'x', ageClass: 'U11', category: '-28 kg', white: { name: 'X' }, blue: { name: 'Y' }, status: 'open' });
  TM.sync(s);
  assert.strictEqual(s.queue.length, 4);
  assert.strictEqual(s.queue[0].id, 'x');
  s.team.classes = ['-60 kg'];
  TM.sync(s);
  // beendete (echte) Ergebnisse bleiben, offene und automatische verschwinden
  assert.deepStrictEqual(s.queue.map((e) => e.id === 'x' ? 'x' : e.category), ['x', '-60 kg']);
});

test('Anzeige: Kampf x von y', () => {
  const s = setup();
  TM.sync(s);
  s.fight.queueId = s.queue[2].id;
  const v = TM.view(s);
  assert.strictEqual(v.current, 3);
  assert.strictEqual(v.total, 3);
  assert.strictEqual(v.white.wins, 1);
});

console.log(`\n${passed} Tests bestanden`);
