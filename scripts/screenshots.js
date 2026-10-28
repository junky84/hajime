// Erzeugt die README-Screenshots mit der echten App:
//   HAJIME_SCREENSHOTS=docs/screenshots npx electron .
// Wird nur in diesem Modus von main.js geladen (nicht Teil der fertigen App).
const fs = require('fs');
const path = require('path');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = async function run({ getControl, getBoard, quit }) {
  const out = path.resolve(process.env.HAJIME_SCREENSHOTS);
  fs.mkdirSync(out, { recursive: true });
  while (!getControl() || !getBoard()) await wait(200);
  await wait(2500);
  const ctl = getControl();
  const brd = getBoard();
  ctl.setBounds({ x: 0, y: 0, width: 1500, height: 940 });
  brd.setBounds({ x: 100, y: 100, width: 1600, height: 900 });
  await wait(800);

  const js = (code) => ctl.webContents.executeJavaScript(`(async () => { ${code} })()`);
  const shot = async (win, name) => {
    await wait(700);
    // echte Monitornamen des Rechners nicht in die öffentlichen Bilder übernehmen
    if (win === ctl) {
      await ctl.webContents.executeJavaScript(
        `document.querySelectorAll('#displaySelect option').forEach((o, i) => (o.textContent = 'Bildschirm ' + (i + 1) + ': 1920×1080' + (i ? ' (Anzeige)' : ' (Haupt, Bedienung)')))`
      );
      await wait(300);
    }
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(out, name + '.png'), img.toPNG());
    console.log('Screenshot', name);
  };

  const participants = JSON.parse(fs.readFileSync(path.join(__dirname, 'demo-teilnehmer.json'), 'utf8'));

  // Startzustand: Turnier, Teilnehmer, Kampfliste aus "Jeder gegen jeden"
  await js(`
    const C = JudoCore;
    const s = C.createState();
    s.settings.tournament = 'Bezirkseinzelmeisterschaft U11–U15';
    s.settings.mat = 'Matte 1';
    s.settings.soundOn = false;
    s.participants = ${JSON.stringify(participants)};
    __judo.state = s;
    __judo.commit();
    document.querySelector('.tabs button[data-tab="list"]').click();
    window.confirm = () => true;
    document.querySelector('[data-gen="*"]').click();
  `);
  await shot(ctl, 'bedienung-kampfliste');

  // Kampf 1 laden, Kampf läuft mit Wertungen und Osaekomi
  await js(`
    document.querySelector('.tabs button[data-tab="fight"]').click();
    document.getElementById('btnNext').click();
    const s = __judo.state;
    s.queue[0].status = 'done';
    s.queue[0].result = { winner: 'white', reason: 'Waza-ari', white: '1 W', blue: '0 W' };
    const C = JudoCore, now = Date.now();
    C.hajimeMate(s, now - 41000);
    C.addScore(s, 'white', 'wazaari', 1, now - 30000);
    C.addScore(s, 'blue', 'shido', 1, now - 20000);
    C.startOsae(s, 'blue', now - 7300);
    s.fight.flash = null;
    __judo.commit();
  `);
  await shot(brd, 'anzeige-osaekomi');
  await shot(ctl, 'bedienung-kampf');

  // Kampfende mit Sieger
  await js(`
    const s = __judo.state, C = JudoCore, now = Date.now();
    C.toketa(s, now - 4000);
    C.setClock(s, 0, now);
    C.tick(s, now);
    s.fight.flash = null;
    s.fight.osae.lastAt = 0;
    __judo.commit();
  `);
  await shot(brd, 'anzeige-sieger');

  // Golden Score
  await js(`
    const s = __judo.state, C = JudoCore, now = Date.now();
    const e = s.queue.find((q) => q.ageClass === 'U13' && q.category === '-40 kg');
    C.loadFight(s, Object.assign({}, e, { no: '19' }), now);
    s.fight.queueId = e.id;
    C.hajimeMate(s, now - 200000);
    C.addScore(s, 'white', 'yuko', 1, now - 150000);
    C.addScore(s, 'blue', 'yuko', 1, now - 120000);
    C.addScore(s, 'white', 'shido', 1, now - 100000);
    C.tick(s, now - 20000);
    C.hajimeMate(s, now - 17000);
    s.fight.flash = null;
    __judo.commit();
  `);
  await shot(brd, 'anzeige-golden-score');

  // Pausenbild
  await js(`
    const s = __judo.state;
    s.screen = 'idle';
    __judo.commit();
  `);
  await shot(brd, 'anzeige-pausenbild');

  // Gruppentabelle U11 -28 kg (Ergebnisse wie im Beispiel aus Issue #3)
  await js(`
    const s = __judo.state, C = JudoCore, now = Date.now();
    s.screen = 'board';
    const res = {
      'Kaltenbach|Fischbach': ['Mia Kaltenbach', 'Waza-ari'],
      'Brenner|Kaltenbach': ['Mia Kaltenbach', 'Ippon'],
      'Kaltenbach|Rothmund': ['Mia Kaltenbach', 'Ippon'],
      'Brenner|Fischbach': ['Lukas Brenner', 'Waza-ari'],
      'Brenner|Rothmund': ['Lukas Brenner', 'Ippon'],
      'Fischbach|Rothmund': ['Noah Fischbach', 'Ippon'],
    };
    const last = (n) => n.split(' ').pop();
    let t = now - 30 * 60000;
    s.queue.forEach((e, i) => {
      if (e.ageClass !== 'U11' || e.category !== '-28 kg') return;
      const k = [last(e.white.name), last(e.blue.name)];
      const r = res[k.join('|')] || res[k.reverse().join('|')];
      const winner = e.white.name === r[0] ? 'white' : 'blue';
      t += 4 * 60000;
      e.status = 'done';
      e.result = { fightId: 'demo' + i, winner, reason: r[1], kind: C.winKind(winner, r[1]), finishedAt: t, white: '', blue: '' };
      s.log.push({ fightId: 'demo' + i, no: String(i + 1), time: '', mat: 'Matte 1', ageClass: e.ageClass, category: e.category, white: e.white, blue: e.blue,
        whiteScore: '', blueScore: '', winner, winnerName: r[0], reason: r[1], duration: '2:00', finishedAt: t, events: [] });
    });
    s.boardGroup = C.groupKey({ ageClass: 'U11', category: '-28 kg' });
    s.screen = 'table';
    __judo.commit();
  `);
  await shot(brd, 'anzeige-gruppentabelle');

  await js(`
    __judo.state.screen = 'board';
    __judo.commit();
    document.querySelector('.tabs button[data-tab="eval"]').click();
  `);
  await shot(ctl, 'bedienung-auswertung');

  // Ruhezeit: Kämpfer des nächsten offenen Kampfes hat vor 2:20 gekämpft
  await js(`
    const s = __judo.state, C = JudoCore, now = Date.now();
    s.fight = C.newFight(C.getRules(s)); // kein laufender Kampf, sonst fragt „Laden“ nach
    const e = s.queue.find((q) => q.status !== 'done' && q.ageClass === 'U11');
    s.log.push({ fightId: 'demo-rest', no: '4', time: '', mat: 'Matte 1', ageClass: 'U11', category: e.category, white: e.blue, blue: { name: 'Emma Rothmund' },
      whiteScore: '', blueScore: '', winner: 'white', winnerName: e.blue.name, reason: 'Ippon', duration: '2:00', finishedAt: now - 140000, events: [] });
    __judo.commit();
    document.querySelector('.tabs button[data-tab="list"]').click();
    document.querySelector('#queueTable tr[data-id="' + e.id + '"] [data-a="load"]').click();
  `);
  await shot(ctl, 'bedienung-ruhezeit');
  await js(`document.querySelector('#dlgRest [data-r="cancel"]').click();`);

  // Urkunde und Siegerliste: Seite in einem unsichtbaren Fenster abfotografieren
  const { BrowserWindow } = require('electron');
  const page = async (code, name, pdfName) => {
    const html = await js(code);
    const tmp = path.join(require('os').tmpdir(), 'hajime-' + name + '.html');
    fs.writeFileSync(tmp, html);
    const win = new BrowserWindow({ show: false, width: 794, height: 1123, useContentSize: true, webPreferences: { javascript: false } });
    await win.loadFile(tmp);
    await win.webContents.insertCSS('html { overflow: hidden; }');
    await wait(500);
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(out, name + '.png'), img.toPNG());
    console.log('Screenshot', name);
    if (process.env.HAJIME_PDF_OUT) {
      const pdf = await win.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true, landscape: false });
      fs.writeFileSync(path.join(process.env.HAJIME_PDF_OUT, pdfName), pdf);
    }
    win.destroy();
  };
  await js(`
    const s = __judo.state;
    Object.assign(s.settings, { tournamentDate: '2026-11-15', tournamentPlace: 'Mittelstadt' });
    // Beispiel-Vereinslogo
    const cv = document.createElement('canvas');
    cv.width = cv.height = 300;
    const g = cv.getContext('2d');
    g.fillStyle = '#c62828';
    g.beginPath();
    g.arc(150, 150, 150, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#fff';
    g.font = '900 96px Arial, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('JCM', 150, 156);
    s.settings.logo = cv.toDataURL('image/png');
    __judo.commit();
  `);
  const tables = `JudoBrackets.allTables(__judo.state).filter((t) => t.done)`;
  await page(`return JudoAwards.certHtml({ tables: ${tables}.filter((t) => t.complete), places: '3', settings: __judo.state.settings });`, 'urkunde', 'urkunden.pdf');
  await page(`return JudoAwards.listHtml({ tables: ${tables}, places: '3', settings: __judo.state.settings });`, 'siegerliste', 'siegerliste.pdf');
  await js(`
    __judo.state.settings.logo = null;
    __judo.commit();
  `);

  /* ---------- ab v1.4: Turniersysteme, Matten, Aufruf ---------- */
  await js(`
    window.confirm = () => true;
    const C = JudoCore;
    const s = __judo.state;
    s.settings.splitGender = true;
    s.screen = 'board';
    s.queue = [];
    s.brackets = [];
    s.log = [];
    s.fight = C.newFight(C.getRules(s));
    const ko = [['Jakob Wendling', 'JC Mittelstadt'], ['Tim Sauter', 'TSV Lindenau'], ['Nico Brandauer', 'SV Bergheim'], ['Luis Kerschbaum', 'Judoteam Talheim'],
      ['David Ortlieb', 'JC Kirchdorf'], ['Samuel Fink', 'JC Mittelstadt'], ['Moritz Gerlach', 'TSV Lindenau'], ['Erik Haslinger', 'SV Bergheim']];
    const pool = [['Lena Achterberg', 'SV Bergheim'], ['Sophie Wolters', 'JC Mittelstadt'], ['Clara Steinhoff', 'TSV Lindenau'], ['Ida Grimmel', 'JC Kirchdorf'],
      ['Nele Fischbach', 'Judoteam Talheim'], ['Greta Rothmund', 'JC Mittelstadt'], ['Marie Brenner', 'SV Bergheim']];
    s.participants = s.participants
      .concat([['Leo Brandt', 'JC Kirchdorf'], ['Karl Mertens', 'Judoteam Talheim'], ['Ella Vogt', 'SV Bergheim']].map(([name, club]) => ({ name, club, ageClass: 'U11', category: '-28 kg' })))
      .map((p) => Object.assign({}, p, { gender: /^(Mia|Emma|Lina|Hannah|Lea|Marie|Sophie|Clara|Ella) /.test(p.name) ? 'w' : 'm' }))
      .concat(ko.map(([name, club]) => ({ name, club, ageClass: 'U15', category: '-50 kg', gender: 'm' })))
      .concat(pool.map(([name, club]) => ({ name, club, ageClass: 'U15', category: '-48 kg', gender: 'w' })));
    s.groupSystems = {};
    s.groupSystems[C.groupKey({ ageClass: 'U15', category: '-50 kg', gender: 'm' })] = 'ko';
    __judo.commit();
    document.querySelector('.tabs button[data-tab="list"]').click();
    document.querySelector('[data-gen="*"]').click();
  `);
  await shot(ctl, 'bedienung-turniersysteme');

  await js(`
    document.querySelector('.tabs button[data-tab="mats"]').click();
    const set = (id, v) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event('change')); };
    set('mpCount', '3');
    set('mpStart', '09:30');
    document.getElementById('btnMpDistribute').click();
  `);
  await shot(ctl, 'bedienung-matten');

  // K.-o.: Viertelfinale entschieden, Halbfinale 1 läuft
  await js(`
    const s = __judo.state, C = JudoCore, now = Date.now();
    s.settings.mat = 'Matte 1';
    const ko = s.brackets.find((b) => b.system === 'ko');
    const fin = (slot, side, reason, kind) => {
      const e = s.queue.find((q) => q.bracket === ko.key && q.slot === slot);
      e.status = 'done';
      e.result = { fightId: 'demo-' + slot, winner: side, reason, kind, finishedAt: now - 60000, white: '', blue: '' };
      JudoBrackets.sync(s);
    };
    fin('VF1', 'white', 'Ippon', 'ippon');
    fin('VF2', 'blue', 'Waza-ari', 'wazaari');
    fin('VF3', 'white', 'Yuko', 'yuko');
    fin('VF4', 'blue', 'Ippon', 'ippon');
    const hf = s.queue.find((q) => q.bracket === ko.key && q.slot === 'HF1');
    s.settings.mat = hf.mat || 'Matte 1';
    C.loadFight(s, Object.assign({}, hf), now);
    s.fight.queueId = hf.id;
    C.hajimeMate(s, now - 50000);
    s.boardGroup = ko.key;
    s.screen = 'table';
    __judo.commit();
    document.querySelector('.tabs button[data-tab="eval"]').click();
    const card = [...document.querySelectorAll('.eval-card')].find((c) => c.querySelector('.bk-ko'));
    document.querySelector('main').scrollTop = card.offsetTop - 70;
  `);
  await shot(ctl, 'bedienung-turnierbaum');
  await shot(brd, 'anzeige-turnierbaum');

  // Aufruf: Auswahl im Bedienfenster, Zeile oben auf der normalen Anzeige
  await js(`
    const s = __judo.state;
    s.screen = 'board';
    __judo.commit();
    document.querySelector('.tabs button[data-tab="fight"]').click();
    document.getElementById('btnCall').click();
    const chips = document.querySelectorAll('#callGroups .call-chip.cur');
    chips[chips.length - 1].click();
  `);
  await shot(ctl, 'bedienung-aufruf');
  await shot(brd, 'anzeige-aufruf');
  await js(`
    document.getElementById('btnCallClear').click();
    document.getElementById('btnCallDone').click();
  `);

  // Einstellungen / Regelprofile (U11)
  await js(`
    const s = __judo.state;
    s.screen = 'board';
    s.settings.soundOn = true;
    JudoCore.applyProfile(s, 'p-u11', Date.now());
    __judo.commit();
    document.querySelector('.tabs button[data-tab="settings"]').click();
    document.querySelector('main').scrollTop = 0;
  `);
  await shot(ctl, 'bedienung-einstellungen');

  quit();
};
