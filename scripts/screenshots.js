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
    document.querySelector('[data-rr="*"]').click();
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

  // Einstellungen / Regelprofile (U11)
  await js(`
    const s = __judo.state;
    s.screen = 'board';
    s.settings.soundOn = true;
    JudoCore.applyProfile(s, 'p-u11', Date.now());
    __judo.commit();
    document.querySelector('.tabs button[data-tab="settings"]').click();
  `);
  await shot(ctl, 'bedienung-einstellungen');

  quit();
};
