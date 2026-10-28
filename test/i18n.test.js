// Tests der Mehrsprachigkeit: node test/i18n.test.js
const assert = require('assert');
const K = require('../scripts/i18n-keys.js');
require('../src/js/i18n.js');
require('../src/lang/en.js');
const I18n = globalThis.HajimeI18n;

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

test('Englisch ist vollständig (alle Texte aus Programm und Seiten übersetzt)', () => {
  const miss = K.missing('en');
  assert.deepStrictEqual(miss, [], 'fehlende Übersetzungen – node scripts/i18n-keys.js en');
});

test('Platzhalter bleiben in der Übersetzung erhalten', () => {
  const d = K.langDict('en');
  const ph = (s) => (s.match(/\{\w+\}/g) || []).sort().join(',');
  const bad = Object.keys(d).filter((k) => ph(k) !== ph(d[k]));
  assert.deepStrictEqual(bad, []);
});

test('Übersetzung mit Platzhaltern, Rückfall auf Englisch und Deutsch', () => {
  const en = I18n.make('en');
  assert.strictEqual(en('Nächster Kampf'), 'Next contest');
  assert.strictEqual(en('{n} von {m} Kämpfen', { n: 2, m: 5 }), '2 of 5 contests');
  assert.strictEqual(en('Ippon'), 'Ippon'); // Judo-Begriff bleibt
  assert.strictEqual(en('gibt es nicht'), 'gibt es nicht');
  const de = I18n.make('de');
  assert.strictEqual(de('Nächster Kampf'), 'Nächster Kampf');
  // unbekannte Sprache: Englisch als Rückfall
  I18n.register('xx', 'Test', { Kampfliste: 'Lista' });
  const xx = I18n.make('xx');
  assert.strictEqual(xx('Kampfliste'), 'Lista');
  assert.strictEqual(xx('Nächster Kampf'), 'Next contest');
});

test('Zusammengesetzte Bezeichnungen (Runden, Platzhalter, Matten)', () => {
  const en = I18n.make('en');
  assert.strictEqual(en.phrase('Viertelfinale 2'), 'Quarter-final 2');
  assert.strictEqual(en.phrase('Sieger HF 1'), 'Winner SF 1');
  assert.strictEqual(en.phrase('Kampf um Platz 3 (A)'), 'Bronze medal contest (A)');
  assert.strictEqual(en.phrase('Matte 3'), 'Mat 3');
  assert.strictEqual(en.phrase('Pool A – Kampf 4'), 'Pool A – Contest 4');
  assert.strictEqual(en.phrase('Rückrunde'), 'Second leg');
});

console.log(`\n${passed} Tests bestanden`);
