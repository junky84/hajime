/*
 * Starttest für „Hajime für Windows“ in der CI (windows-latest):
 *  1. „Hajime starten.cmd“ startet Hajime im Hintergrund (ohne Fenster)
 *  2. Seiten und Brücke antworten
 *  3. Firewall-Freigabe anlegen, prüfen und wieder entfernen (der CI-Rechner ist Administrator)
 *  4. Zentrale starten; die Suche findet sie über die Netzwerkadresse
 *  5. Edge (ohne Bildschirm) lädt die Bedienung, Screenshot nach selftest/
 *
 * Aufruf: node scripts/windows-smoketest.js   (nach scripts/build-windows.js --node …)
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { spawnSync, execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const pkg = require(path.join(root, 'package.json'));
const dir = path.join(root, 'dist', `Hajime-${pkg.version}-Windows`);
const H = require(path.join(dir, 'programm', 'hub.js'));
const UI = 47811;
const out = path.join(root, 'selftest');
fs.mkdirSync(out, { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const step = (s) => console.log('\n== ' + s);
function fail(msg) {
  console.error('FEHLER: ' + msg);
  process.exit(1);
}

function getJson(port, p) {
  return new Promise((resolve) => {
    http
      .get({ host: '127.0.0.1', port, path: p, timeout: 3000 }, (res) => {
        let b = '';
        res.on('data', (d) => (b += d));
        res.on('end', () => {
          try {
            resolve(JSON.parse(b));
          } catch (err) {
            resolve(null);
          }
        });
      })
      .on('error', () => resolve(null));
  });
}

function bridge() {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port: UI,
      path: '/bridge',
      headers: { Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Key': crypto.randomBytes(16).toString('base64'), 'Sec-WebSocket-Version': '13', Origin: `http://127.0.0.1:${UI}` },
    });
    req.on('response', (res) => reject(new Error('Brücke abgelehnt: ' + res.statusCode)));
    req.on('upgrade', (res, socket) => {
      const pending = new Map();
      const events = [];
      let seq = 0;
      const conn = new H.WsConn(
        socket,
        (text) => {
          const m = JSON.parse(text);
          if (m.event) return events.push(m);
          const p = pending.get(m.id);
          if (p) (m.ok ? p.resolve : p.reject)(m.ok ? m.result : new Error(m.error));
        },
        () => {}
      );
      resolve({
        events,
        call: (op, ...args) =>
          new Promise((res2, rej2) => {
            const id = ++seq;
            pending.set(id, { resolve: res2, reject: rej2 });
            conn.send({ id, op, args });
          }),
        close: () => conn.close(),
      });
    });
    req.on('error', reject);
    req.end();
  });
}

(async () => {
  step('Start über „Hajime starten.cmd“');
  const r = spawnSync('cmd.exe', ['/d', '/c', 'Hajime starten.cmd'], { cwd: dir, env: Object.assign({}, process.env, { HAJIME_NO_BROWSER: '1' }), encoding: 'utf8', timeout: 30000 });
  console.log('Rückgabe:', r.status, (r.stdout || '').trim(), (r.stderr || '').trim());
  if (r.status !== 0) fail('Startdatei endete mit Fehler');
  let info = null;
  for (let i = 0; i < 50 && !(info = await getJson(UI, '/__hajime')); i++) await wait(200);
  if (!info || info.hajime !== 1) fail('Hajime antwortet nicht auf Port ' + UI);
  console.log('läuft im Hintergrund:', JSON.stringify(info));

  step('Bedienseite');
  const page = await new Promise((resolve) => http.get({ host: '127.0.0.1', port: UI, path: '/control.html' }, (res) => {
    let b = '';
    res.on('data', (d) => (b += d));
    res.on('end', () => resolve(b));
  }));
  if (!/js\/native\.js/.test(page)) fail('control.html ohne native.js');

  const b = await bridge();

  step('Firewall-Freigabe');
  let st = await b.call('firewallStatus');
  console.log('vorher:', JSON.stringify(st));
  if (!st.needed) fail('Unter Windows muss die Freigabe geprüft werden');
  const al = await b.call('firewallAllow');
  console.log('freigeben:', JSON.stringify(al));
  if (!al.ok) fail('Freigabe fehlgeschlagen');
  st = await b.call('firewallStatus');
  if (!st.ok) fail('Regel nach dem Freigeben nicht gefunden');
  const rule = execFileSync('netsh', ['advfirewall', 'firewall', 'show', 'rule', 'name=Hajime-Zentrale', 'verbose'], { encoding: 'utf8' });
  console.log(rule);

  step('Zentrale starten und über das Netzwerk finden');
  const hub = await b.call('hubStart', { code: '1234', tournament: 'CI-Pokal' });
  console.log('Zentrale:', JSON.stringify(hub));
  await b.call('finderStart');
  const lan = (h) => h.tournament === 'CI-Pokal' && h.address !== '127.0.0.1';
  for (let i = 0; i < 200 && !b.events.some((e) => e.event === 'hubs-found' && e.data.some(lan)); i++) await wait(100);
  const lists = b.events.filter((e) => e.event === 'hubs-found');
  console.log('gefunden:', JSON.stringify(lists.length ? lists[lists.length - 1].data : []));
  if (!lists.some((e) => e.data.some((h) => h.tournament === 'CI-Pokal'))) fail('Suche findet die Zentrale nicht');
  if (!lists.some((e) => e.data.some(lan))) console.log('Hinweis: nur über 127.0.0.1 gefunden (CI-Netz ohne Nachbarn)');
  await b.call('finderStop');

  step('Edge lädt die Bedienung');
  const edge = ['ProgramFiles(x86)', 'ProgramFiles'].map((v) => process.env[v] && path.join(process.env[v], 'Microsoft', 'Edge', 'Application', 'msedge.exe')).find((f) => f && fs.existsSync(f));
  if (edge) {
    const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-'));
    const shot = path.join(out, 'windows-edge.png');
    const common = ['--headless=new', '--disable-gpu', '--no-first-run', `--user-data-dir=${prof}`, '--window-size=1400,900', '--virtual-time-budget=6000'];
    const dom = spawnSync(edge, common.concat(['--dump-dom', `http://127.0.0.1:${UI}/control.html`]), { encoding: 'utf8', timeout: 60000, maxBuffer: 50 * 1024 * 1024 });
    fs.writeFileSync(path.join(out, 'windows-edge-dom.html'), dom.stdout || '');
    spawnSync(edge, common.concat([`--screenshot=${shot}`, `http://127.0.0.1:${UI}/control.html`]), { timeout: 60000 });
    console.log('DOM:', (dom.stdout || '').length, 'Zeichen; Screenshot:', fs.existsSync(shot));
    if (!/<dialog[^>]*id="dlgLevel"[^>]*open/.test(dom.stdout || '') && !/class="[^"]*lvl-/.test(dom.stdout || '')) fail('Bedienung in Edge nicht vollständig geladen (Startdialog fehlt)');
  } else console.log('Edge nicht gefunden – übersprungen');

  step('Aufräumen');
  await b.call('hubStop');
  const rm = await b.call('firewallRemove');
  console.log('Freigabe entfernt:', JSON.stringify(rm));
  if (!rm.ok) fail('Freigabe ließ sich nicht entfernen');
  b.close();
  const pid = (await getJson(UI, '/__hajime')).pid;
  try {
    process.kill(pid);
  } catch (err) {
    /* schon beendet */
  }
  const log = path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'Hajime', 'hajime-windows.log');
  if (fs.existsSync(log)) fs.copyFileSync(log, path.join(out, 'hajime-windows.log'));
  console.log('\nStarttest bestanden.');
  process.exit(0);
})().catch((err) => fail(err.stack || err.message));
