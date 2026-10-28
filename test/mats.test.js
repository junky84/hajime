// Tests der Matten-Verteilung: node test/mats.test.js
const assert = require('assert');
const C = require('../src/js/core.js');
const B = require('../src/js/brackets.js');
const M = require('../src/js/mats.js');

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
let seed = 3;
const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

function tournament(spec) {
  const s = C.createState();
  spec.forEach(([ageClass, category, n, system, gender]) => {
    const ps = Array.from({ length: n }, (_, i) => ({ name: `${ageClass}${gender || ''}${category}-${i}`, club: 'V' + (i % 3) }));
    s.brackets.push(B.newBracket({ ageClass, category, gender: gender || '' }, system || B.suggest(n), ps, rng));
  });
  B.sync(s);
  return s;
}

test('Dauer je Gruppe aus Regelprofil + Zuschlag', () => {
  const s = tournament([['U11', '-28 kg', 4], ['U13', '-40 kg', 5]]);
  const g = M.matGroups(s, M.planOf({ matPlan: { extra: 60 } }));
  assert.deepStrictEqual(g.map((x) => [x.label, x.players, x.fights, x.durSec / 60]), [['U11 -28 kg', 4, 6, 18], ['U13 -40 kg', 5, 10, 40]]);
});

test('Verteilung nach Dauer: alle Matten ähnlich ausgelastet, Gruppen bleiben zusammen', () => {
  const s = tournament([['U11', '-28 kg', 4], ['U11', '-31 kg', 4], ['U11', '-34 kg', 5], ['U13', '-34 kg', 4], ['U13', '-40 kg', 5], ['U13', '-46 kg', 3], ['U15', '-46 kg', 3], ['U15', '-50 kg', 5]]);
  s.matPlan = { count: 3, start: '09:30', extra: 60 };
  s.matPlan.assign = M.distribute(M.matGroups(s), 3);
  const L = M.apply(s);
  const mins = L.mats.map((m) => m.durSec / 60);
  assert.ok(Math.max(...mins) - Math.min(...mins) <= 14, 'ungleich: ' + mins);
  // jede Gruppe komplett auf einer Matte
  C.poolGroups(s.queue).forEach((g) => assert.strictEqual(new Set(g.entries.map((e) => e.mat)).size, 1));
  // Nummern je Matte ab 1, Uhrzeit beginnt mit Beginn
  const m1 = s.queue.filter((e) => e.mat === 'Matte 1');
  assert.deepStrictEqual(m1.map((e) => e.no).slice(0, 3), ['1', '2', '3']);
  assert.strictEqual(m1[0].at, '09:30');
});

test('Niemand kämpft zweimal direkt hintereinander', () => {
  const s = tournament([['U11', '-28 kg', 3], ['U11', '-31 kg', 3], ['U11', '-34 kg', 4]]);
  s.matPlan = { count: 1, extra: 60 };
  M.apply(s);
  const q = s.queue.filter((e) => !e.pending);
  for (let i = 1; i < q.length; i++) {
    const a = [q[i - 1].white.name, q[i - 1].blue.name];
    assert.ok(!a.includes(q[i].white.name) && !a.includes(q[i].blue.name), `Kampf ${i} und ${i + 1}: ${a} / ${q[i].white.name}, ${q[i].blue.name}`);
  }
});

test('K.-o.: spätere Runden erst nach ihren Vorkämpfen', () => {
  const s = tournament([['U15', '-50 kg', 8, 'ko'], ['U15', '-55 kg', 4, 'rr']]);
  s.matPlan = { count: 1, extra: 60 };
  M.apply(s);
  const pos = (slot) => s.queue.findIndex((e) => e.slot === slot && e.category === '-50 kg');
  assert.ok(pos('HF1') > pos('VF1') && pos('HF1') > pos('VF2'));
  assert.ok(pos('TRA') > pos('VF2'));
  assert.ok(pos('P3A') > pos('HF2') && pos('P3A') > pos('TRA'));
  assert.ok(pos('F') > pos('HF1') && pos('F') > pos('HF2'));
});

test('Von Hand verschobene Gruppe bleibt, Aufheben entfernt Matten', () => {
  const s = tournament([['U11', '-28 kg', 4], ['U13', '-40 kg', 5]]);
  s.matPlan = { count: 2, assign: {} };
  const key = C.groupKey({ ageClass: 'U11', category: '-28 kg' });
  s.matPlan.assign[key] = 1;
  s.matPlan.assign[C.groupKey({ ageClass: 'U13', category: '-40 kg' })] = 1;
  const L = M.apply(s);
  assert.strictEqual(L.mats[1].groups.length, 2);
  assert.strictEqual(L.mats[0].groups.length, 0);
  M.clear(s);
  assert.ok(s.queue.every((e) => !e.mat && !e.at));
  assert.ok(M.forMat({ mat: 'matte 2' }, 'Matte 2') && !M.forMat({ mat: 'Matte 2' }, 'Matte 1') && M.forMat({}, 'Matte 1'));
});

// Gruppen erzeugen wie mit „Nach Geschlecht trennen“
const sexed = (list) => list.map(([a, c, n, g]) => [a, c, n, null, g]);
const span = (L) => Math.max(...L.mats.map((m) => m.durSec));
function check(s, count) {
  s.matPlan = { count, extra: 60 };
  const groups = M.matGroups(s);
  s.matPlan.assign = M.distribute(groups, count);
  const L = M.apply(s);
  const mixedPlan = { count, extra: 60, assign: {} };
  const mixed = M.layout(groups, M.planOf({ matPlan: mixedPlan }));
  return { L, mixedSpan: span(mixed) };
}

test('Nach Geschlecht getrennt: ausgeglichen → jede Matte nur ein Geschlecht', () => {
  const s = tournament(
    sexed([['U11', '-28 kg', 4, 'w'], ['U11', '-31 kg', 5, 'w'], ['U13', '-34 kg', 4, 'w'], ['U13', '-40 kg', 5, 'w'], ['U11', '-28 kg', 4, 'm'], ['U11', '-31 kg', 5, 'm'], ['U13', '-34 kg', 4, 'm'], ['U13', '-40 kg', 5, 'm']])
  );
  const { L } = check(s, 4);
  L.mats.forEach((m) => {
    assert.ok(!m.mixed, m.name + ' gemischt');
    assert.ok(m.groups.every((g) => g.gender === m.gender));
  });
  assert.deepStrictEqual(L.mats.map((m) => m.gender).sort(), ['m', 'm', 'w', 'w']);
  // die Kampfliste jeder Matte hat nur ein Geschlecht
  L.mats.forEach((m) => assert.strictEqual(new Set(s.queue.filter((e) => e.mat === m.name).map((e) => e.gender)).size, 1));
});

test('Nach Geschlecht getrennt: wenige Mädchen → höchstens ein Wechsel je Matte, kaum länger', () => {
  const s = tournament(
    sexed([['U13', '-40 kg', 3, 'w'], ['U11', '-28 kg', 5, 'm'], ['U11', '-31 kg', 5, 'm'], ['U13', '-34 kg', 5, 'm'], ['U13', '-40 kg', 4, 'm'], ['U15', '-46 kg', 5, 'm'], ['U15', '-50 kg', 4, 'm']])
  );
  const { L, mixedSpan } = check(s, 3);
  assert.ok(span(L) <= mixedSpan * 1.15 + 1, `zu lang: ${span(L)} statt ${mixedSpan}`);
  L.mats.forEach((m) => {
    // erst das eigene Geschlecht, dann höchstens einmal wechseln
    const seq = s.queue.filter((e) => e.mat === m.name && e.status !== 'skipped').map((e) => e.gender);
    const switches = seq.filter((g, i) => i && g !== seq[i - 1]).length;
    assert.ok(switches <= 1, m.name + ': ' + seq.join(''));
    if (seq.length) assert.strictEqual(seq[0], m.gender);
  });
  // die Mädchen-Gruppe teilt sich keine Matte mit Jungen davor
  const wMat = L.mats.find((m) => m.groups.some((g) => g.gender === 'w'));
  assert.strictEqual(wMat.groups[0].gender, 'w');
});

test('Neue Gruppe nach der Verteilung landet auf einer Matte ihres Geschlechts', () => {
  const s = tournament(sexed([['U11', '-28 kg', 4, 'w'], ['U13', '-34 kg', 4, 'w'], ['U11', '-28 kg', 4, 'm'], ['U13', '-34 kg', 4, 'm']]));
  check(s, 2);
  const extra = tournament(sexed([['U15', '-50 kg', 3, 'w']]));
  s.queue = s.queue.concat(extra.queue);
  s.brackets = s.brackets.concat(extra.brackets);
  const L = M.apply(s);
  const m = L.mats.find((x) => x.groups.some((g) => g.label === 'U15 w -50 kg'));
  assert.strictEqual(m.gender, 'w');
  assert.ok(!m.mixed);
});

console.log(`\n${passed} Tests bestanden`);
