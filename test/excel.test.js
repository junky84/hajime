// Tests des Excel-Imports: node test/excel.test.js
const assert = require('assert');
global.self = global;
global.XLSX = require('../src/vendor/xlsx.full.min.js');
require('../src/js/excel.js');
const X = global.JudoExcel;

function fileFrom(sheets) {
  const wb = XLSX.utils.book_new();
  for (const [name, aoa] of Object.entries(sheets)) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), name);
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  return { arrayBuffer: async () => buf };
}

(async () => {
  // Vorlage muss sich selbst wieder einlesen lassen
  const tpl = await X.importFile({ arrayBuffer: async () => X.templateBytes() });
  assert.strictEqual(tpl.fights.length, 2);
  assert.strictEqual(tpl.fights[0].white.name, 'Max Mustermann');
  assert.strictEqual(tpl.fights[0].blue.club, 'TSV Beispielhausen');
  assert.strictEqual(tpl.fights[0].ageClass, 'U13');
  assert.strictEqual(tpl.participants.length, 3);
  assert.strictEqual(tpl.participants[2].name, 'Jonas Probe');

  // Freie Teilnehmerliste mit Titelzeile davor
  const free = await X.importFile(fileFrom({ Liste: [
    ['Kreiseinzelmeisterschaft 2026'], [],
    ['Name', 'Verein', 'AK', 'Gew.-Kl.'],
    ['Anna A', 'JC A', 'U11', '-28'], ['Ben B', 'JC B', 'U11', '-28'], ['', '', '', ''],
  ] }));
  assert.strictEqual(free.participants.length, 2);
  assert.deepStrictEqual(free.participants[0], { name: 'Anna A', club: 'JC A', ageClass: 'U11', category: '-28' });

  // Kampfliste mit "Weiß"/"Blau" ohne Zusatz und Vereinsspalten
  const fl = await X.importFile(fileFrom({ K: [
    ['Kampf-Nr', 'Weiß', 'Verein Weiß', 'Blau', 'Verein Blau', 'Gewichtsklasse'],
    [7, 'Carl C', 'SV C', 'Dora D', 'SV D', '-40 kg'],
  ] }));
  assert.strictEqual(fl.fights.length, 1);
  assert.deepStrictEqual(fl.fights[0], { no: '7', ageClass: '', category: '-40 kg', white: { name: 'Carl C', club: 'SV C' }, blue: { name: 'Dora D', club: 'SV D' } });

  // Ganz ohne Überschriften: Spalte A Name, B Verein
  const raw = await X.importFile(fileFrom({ S: [['Eva E', 'Club E'], ['Fritz F', 'Club F']] }));
  assert.strictEqual(raw.participants.length, 2);
  assert.strictEqual(raw.participants[1].club, 'Club F');

  // Siegerliste und Gruppentabellen im Export
  const C = require('../src/js/core.js');
  const fight = (a, b, winner, reason) => ({ ageClass: 'U11', category: '-28 kg', white: { name: a, club: 'V' + a }, blue: { name: b }, status: 'done', result: { winner, reason } });
  const tables = C.poolGroups([fight('A', 'B', 'white', 'Ippon'), fight('B', 'C', 'white', 'Waza-ari'), fight('A', 'C', 'white', 'Yuko')]).map((g) => C.standings(g));
  const sheet = (bytes, name) => XLSX.utils.sheet_to_json(XLSX.read(bytes, { type: 'array' }).Sheets[name], { header: 1 });
  const wl = sheet(X.winnersBytes(tables, '3', C.awardRows), 'Siegerliste');
  assert.deepStrictEqual(wl[0], ['Altersklasse', 'Gewichtsklasse', 'Platz', 'Name', 'Verein', 'Hinweis']);
  assert.deepStrictEqual(wl.slice(1).map((r) => [r[2], r[3]]), [[1, 'A'], [2, 'B'], [3, 'C']]);
  const gt = sheet(X.protocolBytes([], tables), 'Gruppentabellen');
  assert.strictEqual(gt.length, 4);
  assert.strictEqual(gt[1][3], 'A');
  assert.strictEqual(gt[1][9], 15); // Ippon 10 + Yuko 5

  console.log('Excel-Import: alle Tests bestanden');
})().catch((e) => { console.error(e); process.exit(1); });
