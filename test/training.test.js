// Tests des Trainingsmodus: node test/training.test.js
const assert = require('assert');
const TR = require('../src/js/training.js');

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

function training(tpl) {
  const tr = TR.createTraining();
  tr.current = TR.normTemplate(tpl);
  return tr;
}

test('Runden und Pausen wechseln, Gong zu Beginn und Ende, Ende nach der letzten Runde', () => {
  const tr = training({ name: 'T', round: 60, pause: 30, rounds: 2 });
  TR.start(tr, 0);
  assert.strictEqual(tr.run.phase, 'round');
  assert.strictEqual(tr.run.sound.kind, 'gong');
  TR.tick(tr, 49000);
  assert.strictEqual(tr.run.sound.kind, 'gong');
  TR.tick(tr, 50000); // 10 s vor Ende
  assert.strictEqual(tr.run.sound.kind, 'beep');
  TR.tick(tr, 60000);
  assert.strictEqual(tr.run.phase, 'pause');
  assert.strictEqual(tr.run.sound.kind, 'gong');
  TR.tick(tr, 90500);
  assert.strictEqual(tr.run.phase, 'round');
  assert.strictEqual(tr.run.round, 2);
  assert.strictEqual(TR.remaining(tr.run, tr.current, 90500), 59500);
  TR.tick(tr, 150000);
  assert.strictEqual(tr.run.phase, 'done');
  assert.strictEqual(tr.run.running, false);
});

test('Pause und Weiterlaufen ohne Zeitverlust', () => {
  const tr = training({ round: 120, pause: 60, rounds: 3 });
  TR.toggle(tr, 0);
  TR.toggle(tr, 30000);
  assert.strictEqual(TR.remaining(tr.run, tr.current, 99999), 90000);
  TR.toggle(tr, 100000);
  assert.strictEqual(TR.remaining(tr.run, tr.current, 110000), 80000);
});

test('Nur Signalton: kein Gong, kurze Runden ohne Vorwarnung', () => {
  const tr = training({ round: 20, pause: 10, rounds: 10, signalOnly: true });
  TR.start(tr, 0);
  assert.strictEqual(tr.run.sound.kind, 'beep');
  const id = tr.run.sound.id;
  TR.tick(tr, 12000);
  assert.strictEqual(tr.run.sound.id, id); // keine 10-s-Warnung bei 20-s-Runden
  TR.tick(tr, 20000);
  assert.strictEqual(tr.run.phase, 'pause');
});

test('Langsamer Takt überspringt keine Phase falsch', () => {
  const tr = training({ round: 10, pause: 5, rounds: 3 });
  TR.start(tr, 0);
  TR.tick(tr, 31000); // Runde 1 bis 10, Pause bis 15, Runde 2 bis 25, Pause bis 30, Runde 3
  assert.strictEqual(tr.run.phase, 'round');
  assert.strictEqual(tr.run.round, 3);
  assert.strictEqual(tr.run.endsAt, 40000);
});

test('Runde vor und zurück, Vorlagen begrenzt', () => {
  const tr = training({ round: 60, pause: 0, rounds: 4 });
  TR.start(tr, 0);
  TR.skip(tr, 1, 1000);
  assert.strictEqual(tr.run.round, 2);
  TR.skip(tr, -1, 2000);
  assert.strictEqual(tr.run.round, 1);
  assert.strictEqual(TR.normTemplate({ round: -5, rounds: 0 }).round, 5);
  assert.strictEqual(TR.normTemplate({ rounds: 500 }).rounds, 99);
  assert.strictEqual(TR.summary(TR.normTemplate({ round: 180, pause: 60, rounds: 6 })), '6 × 3:00 · Pause 1:00');
});

console.log(`\n${passed} Tests bestanden`);
