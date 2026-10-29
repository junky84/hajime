/*
 * Screenshots für „Matten im Netz“ mit „Hajime für Windows“ (für Handbuch und Schnellstart):
 *   npx electron scripts/screenshots-netz.js docs/screenshots
 *
 * Startet drei Hajime-für-Windows-Instanzen (Zentrale + zwei Matten) auf eigenen Ports,
 * die Firewall-Freigabe wird nachgespielt (HAJIME_FW_DEMO). Dazu die vereinfachten
 * Windows-Darstellungen (Ordner, Abfrage) aus scripts/illustrationen.html.
 */
'use strict';
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const root = path.join(__dirname, '..');
const out = path.resolve(process.argv[process.argv.length - 1]);
const HUB_PORT = 47960;
const PORTS = { hub: 47921, m1: 47922, m2: 47923 };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const procs = [];

function runtime(port, extraEnv) {
  const p = spawn('node', [path.join(root, 'windows', 'hajime-windows.js'), '--no-browser', '--stay', '--foreground'], {
    env: Object.assign({}, process.env, { HAJIME_UI_PORT: String(port), HAJIME_HUB_PORT: String(HUB_PORT) }, extraEnv || {}),
    stdio: 'ignore',
  });
  procs.push(p);
}

async function win(port) {
  const w = new BrowserWindow({ show: false, width: 1500, height: 940, backgroundColor: '#0f1218' });
  await w.loadURL(`http://127.0.0.1:${port}/control.html`);
  await wait(1200);
  return w;
}

const js = (w, code) => w.webContents.executeJavaScript(`(async () => { ${code} })()`);

// Ausschnitt um ein Element (mit Rand), vorher in die Mitte scrollen
async function shotEl(w, sel, name, pad) {
  pad = pad == null ? 12 : pad;
  const r = await js(
    w,
    `const el = document.querySelector(${JSON.stringify(sel)}); el.scrollIntoView({ block: 'center' }); await new Promise((r) => setTimeout(r, 300));
     const b = el.getBoundingClientRect(); return { x: b.left, y: b.top, width: b.width, height: b.height };`
  );
  await wait(300);
  const rect = { x: Math.max(0, Math.floor(r.x - pad)), y: Math.max(0, Math.floor(r.y - pad)), width: Math.ceil(r.width + 2 * pad), height: Math.ceil(r.height + 2 * pad) };
  const img = await w.webContents.capturePage(rect);
  fs.writeFileSync(path.join(out, name + '.png'), img.toPNG());
  console.log('Screenshot', name);
}
async function shotTop(w, name, height) {
  const img = await w.webContents.capturePage({ x: 0, y: 0, width: 1500, height });
  fs.writeFileSync(path.join(out, name + '.png'), img.toPNG());
  console.log('Screenshot', name);
}

// Grundzustand: Turnier, Teilnehmer, Kampfliste
const participants = fs.readFileSync(path.join(__dirname, 'demo-teilnehmer.json'), 'utf8');
const setup = (mat) => `
  const s = JudoCore.createState();
  s.settings.level = 'tournament';
  s.settings.langControl = 'de';
  s.settings.langBoard = 'de';
  s.settings.tournament = 'Bezirkseinzelmeisterschaft U11–U15';
  s.settings.mat = ${JSON.stringify(mat)};
  s.settings.soundOn = false;
  s.participants = ${participants};
  __judo.state = s;
  __judo.commit();
  window.confirm = () => true;
  window.alert = () => {};
  document.querySelector('.tabs button[data-tab="settings"]').click();`;
const role = (r) => `const sel = document.getElementById('netRole'); sel.value = ${JSON.stringify(r)}; sel.dispatchEvent(new Event('change'));`;

app.whenReady().then(async () => {
  try {
    fs.mkdirSync(out, { recursive: true });
    runtime(PORTS.hub, { HAJIME_FW_DEMO: 'missing', HAJIME_NAME: 'Turnierleitung' });
    runtime(PORTS.m1);
    runtime(PORTS.m2);
    await wait(1500);

    // Matte 2 sucht, solange es noch keine Zentrale gibt
    const m2 = await win(PORTS.m2);
    await js(m2, setup('Matte 2') + role('mat'));
    await wait(9000);
    await shotEl(m2, '#netNoHub', 'netz-keine-zentrale');

    // Zentrale: Kampfliste auf zwei Matten verteilen, dann „Zentrale“ wählen
    const hub = await win(PORTS.hub);
    await js(
      hub,
      setup('Turnierleitung') +
        `
      document.querySelector('.tabs button[data-tab="list"]').click();
      document.querySelector('[data-gen="*"]').click();
      document.querySelector('.tabs button[data-tab="mats"]').click();
      const set = (id, v) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event('change')); };
      set('mpCount', '2');
      set('mpStart', '09:30');
      document.getElementById('btnMpDistribute').click();
      document.querySelector('.tabs button[data-tab="settings"]').click();
      ${role('hub')}`
    );
    await wait(2500);
    // ganzer Bereich „Matten im Netz“
    await js(hub, `document.getElementById('netRole').closest('[data-min]').id = 'netSection';`);
    await shotEl(hub, '#netSection', 'netz-zentrale-freigabe');
    await js(hub, `document.getElementById('btnFwAllow').click();`);
    await wait(2500);
    // echte Adressen des Rechners nicht in die öffentlichen Bilder übernehmen
    await js(hub, `const a = document.getElementById('netHubAddr'); a.textContent = a.textContent.replace(/\\d+\\.\\d+\\.\\d+\\.\\d+:${HUB_PORT}/g, '192.168.178.20:47801');`);
    await shotEl(hub, '#netSection', 'netz-zentrale-bereit');
    const code = await js(hub, `return document.getElementById('netHubCode').textContent;`);

    // Matte 1 findet die Zentrale
    const m1 = await win(PORTS.m1);
    await js(m1, setup('Matte 1') + `document.querySelector('.tabs button[data-tab="fight"]').click();`);
    await wait(4000);
    await shotTop(m1, 'netz-matte-gefunden', 150);
    await js(m1, `document.getElementById('btnNetBannerYes').click();`);
    await wait(500);
    await js(m1, `document.getElementById('dlgNetCodeVal').value = ${JSON.stringify(code)}; const i = document.getElementById('dlgNetCodeInfo'); i.textContent = i.textContent.replace(/\\(.*\\)/, '(192.168.178.20:47801)');`);
    await shotEl(m1, '#dlgNetCode', 'netz-matte-verbinden', 16);
    await js(m1, `document.getElementById('dlgNetCode').close('ok');`);

    // Matte 2 verbindet sich jetzt auch
    await js(m2, `const sel = document.getElementById('netAddress'); sel.value = '127.0.0.1:${HUB_PORT}'; document.getElementById('netCode').value = ${JSON.stringify(code)}; document.getElementById('btnNetConnect').click();`);
    await wait(3000);

    // Zentrale schickt die Kampflisten, die Matten laden ihren ersten Kampf
    await js(hub, `document.querySelector('.tabs button[data-tab="mats"]').click(); await new Promise((r) => setTimeout(r, 300)); document.querySelectorAll('[data-sendfights]').forEach((b) => b.click());`);
    await wait(2000);
    for (const m of [m1, m2]) {
      await js(m, `document.querySelector('.tabs button[data-tab="fight"]').click(); document.getElementById('btnNext').click();`);
    }
    await wait(1500);
    // ein Ergebnis auf Matte 1
    await js(
      m1,
      `const s = __judo.state, C = JudoCore, now = Date.now();
       const e = s.queue.find((q) => q.status !== 'done');
       C.hajimeMate(s, now - 95000); C.addScore(s, 'white', 'ippon', 1, now - 1000); __judo.commit();`
    );
    await wait(1000);
    await js(m1, `document.getElementById('btnNext') && document.getElementById('btnNext').click();`);
    await wait(6500);
    await shotEl(hub, '#netCard', 'netz-matten-uebersicht', 6);

    // vereinfachte Windows-Darstellungen
    const il = new BrowserWindow({ show: false, width: 1500, height: 900, backgroundColor: '#ffffff' });
    await il.loadFile(path.join(__dirname, 'illustrationen.html'));
    await wait(500);
    for (const id of ['windows-ordner', 'windows-abfrage', 'windows-zip-zulassen', 'windows-entpacken']) await shotEl(il, '#' + id, id, 0);
  } catch (err) {
    console.error(err);
    process.exitCode = 1;
  }
  procs.forEach((p) => p.kill());
  app.quit();
});
