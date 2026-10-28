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
  assert.deepStrictEqual(wl[0], ['Altersklasse', 'Geschlecht', 'Gewichtsklasse', 'Platz', 'Name', 'Verein', 'Hinweis']);
  assert.deepStrictEqual(wl.slice(1).map((r) => [r[3], r[4]]), [[1, 'A'], [2, 'B'], [3, 'C']]);
  const gt = sheet(X.protocolBytes([], tables), 'Gruppentabellen');
  assert.strictEqual(gt.length, 4);
  assert.strictEqual(gt[1][4], 'A');
  assert.strictEqual(gt[1][10], 15); // Ippon 10 + Yuko 5
  assert.ok(gt[0].includes('Yuko'));
  // ohne Yuko im Regelprofil fällt die Spalte weg
  const noY = sheet(X.protocolBytes([], tables.map((t) => Object.assign({}, t, { yuko: false }))), 'Gruppentabellen');
  assert.ok(!noY[0].includes('Yuko') && noY[0].includes('Waza-ari') && noY[0].length === gt[0].length - 1);
  assert.strictEqual(noY[1][noY[0].indexOf('Hinweis')], gt[1][gt[0].indexOf('Hinweis')]);

  // Geschlecht in Teilnehmer- und Kampfliste
  const gl = await X.importFile(fileFrom({ T: [['Name', 'Verein', 'AK', 'm/w', 'Gewicht'], ['Mia', 'TSV', 'U13', 'weiblich', '-34'], ['Ben', 'TSV', 'U13', 'Junge', '-34'], ['Kim', 'TSV', 'U13', '', '-34']] }));
  assert.deepStrictEqual(gl.participants.map((p) => p.gender), ['w', 'm', undefined]);

  // Export je Matte → Import am Mattenrechner: Matte, Uhrzeit, Platzhalter, Turniersystem
  const B = require('../src/js/brackets.js');
  const st = C.createState();
  const ps = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].map((n, i) => ({ name: 'K' + n, club: 'V' + (i % 3) }));
  st.brackets.push(B.newBracket({ ageClass: 'U15', category: '-50 kg', gender: 'm' }, 'ko', ps));
  B.sync(st);
  st.queue.forEach((e, i) => Object.assign(e, { mat: 'Matte 2', no: String(i + 1), at: '10:0' + (i % 10) }));
  const bytes = X.matBytes({ mat: 'Matte 2', entries: st.queue, brackets: st.brackets, systemLabel: (id) => B.SYSTEMS[id] });
  const back = await X.importFile({ arrayBuffer: async () => bytes });
  assert.strictEqual(back.fights.length, 11);
  assert.strictEqual(back.fights[0].mat, 'Matte 2');
  assert.strictEqual(back.fights[0].at, '10:00');
  assert.strictEqual(back.fights[0].gender, 'm');
  const hf = back.fights.find((f) => f.slot === 'HF1');
  assert.strictEqual(hf.white.name, '');
  assert.strictEqual(hf.whiteFrom, 'Sieger VF 1');
  assert.strictEqual(back.brackets.length, 1);
  assert.strictEqual(B.systemFromText(back.brackets[0].system), 'ko');
  assert.deepStrictEqual(back.brackets[0].players.map((p) => p.name), st.brackets[0].players.map((p) => p.name));
  assert.strictEqual(back.brackets[0].gender, 'm');

  console.log('Excel-Import: alle Tests bestanden');
})().catch((e) => { console.error(e); process.exit(1); });
