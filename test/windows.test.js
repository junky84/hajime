/* Tests für „Hajime für Windows“ (windows/hajime-windows.js) – läuft auf jedem System */
'use strict';
const assert = require('assert');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const H = require('../hub.js');

let passed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log('ok  ', name);
  } catch (err) {
    console.error('FAIL', name);
    console.error(err);
    process.exitCode = 1;
  }
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const UI = 47900 + Math.floor(Math.random() * 50);
const HUB = 48000 + Math.floor(Math.random() * 50);

function get(p, host) {
  return new Promise((resolve, reject) => {
    http
      .get({ host: '127.0.0.1', port: UI, path: p, headers: { host: host || `127.0.0.1:${UI}` } }, (res) => {
        let b = '';
        res.setEncoding('utf8');
        res.on('data', (d) => (b += d));
        res.on('end', () => resolve({ status: res.statusCode, body: b }));
      })
      .on('error', reject);
  });
}

// kleine WebSocket-Verbindung wie aus dem Hajime-Fenster
function bridge(origin) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port: UI,
      path: '/bridge',
      headers: { Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Key': crypto.randomBytes(16).toString('base64'), 'Sec-WebSocket-Version': '13', Origin: origin || `http://127.0.0.1:${UI}` },
    });
    req.on('response', (res) => resolve({ refused: res.statusCode }));
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
  const proc = spawn(process.execPath, [path.join(__dirname, '..', 'windows', 'hajime-windows.js'), '--no-browser', '--stay', '--foreground'], {
    env: Object.assign({}, process.env, { HAJIME_UI_PORT: String(UI), HAJIME_HUB_PORT: String(HUB) }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  proc.stdout.on('data', (d) => (out += d));
  proc.stderr.on('data', (d) => (out += d));
  for (let i = 0; i < 50 && !/läuft:/.test(out); i++) await wait(100);

  await test('Startet und meldet sich als Hajime', async () => {
    const r = await get('/__hajime');
    assert.strictEqual(r.status, 200);
    assert.strictEqual(JSON.parse(r.body).hajime, 1);
  });

  await test('Bedienseite mit Brücke, Version und ohne Offline-Speicher', async () => {
    const r = await get('/control.html');
    assert.strictEqual(r.status, 200);
    assert.ok(r.body.indexOf('js/native.js') > 0 && r.body.indexOf('js/native.js') < r.body.indexOf('js/transport.js'), 'native.js fehlt oder steht hinter transport.js');
    assert.ok(/judoNative/.test((await get('/js/native.js')).body));
    assert.ok(/HAJIME_VERSION/.test((await get('/js/version.js')).body));
    assert.ok(!/serviceWorker/.test((await get('/js/webapp.js')).body));
    assert.strictEqual((await get('/board.html')).status, 200);
  });

  await test('Schutz: fremde Adresse, Pfad nach oben und fremde Seite werden abgewiesen', async () => {
    assert.strictEqual((await get('/control.html', 'evil.example:80')).status, 403);
    assert.notStrictEqual((await get('/../package.json')).status, 200);
    assert.notStrictEqual((await get('/%2e%2e/hub.js')).status, 200);
    const b = await bridge('http://evil.example');
    assert.strictEqual(b.refused, 403);
  });

  await test('Brücke: Freigabe, Zentrale starten, Matte findet sie, Zentrale stoppen', async () => {
    const b = await bridge();
    const fw = await b.call('firewallStatus');
    if (process.platform !== 'win32') assert.deepStrictEqual(fw, { needed: false, ok: true });
    else assert.strictEqual(fw.needed, true);
    const info = await b.call('hubStart', { code: '4711', tournament: 'Testpokal' });
    assert.strictEqual(info.port, HUB);
    assert.ok(info.name);
    // Seite der Zentrale antwortet
    const j = await new Promise((resolve) => http.get({ host: '127.0.0.1', port: HUB, path: '/hajime.json' }, (res) => {
      let s = '';
      res.on('data', (d) => (s += d));
      res.on('end', () => resolve(JSON.parse(s)));
    }));
    assert.strictEqual(j.tournament, 'Testpokal');
    await b.call('finderStart');
    for (let i = 0; i < 100 && !b.events.some((e) => e.event === 'hubs-found' && e.data.some((h) => h.tournament === 'Testpokal')); i++) await wait(100);
    assert.ok(b.events.some((e) => e.event === 'hubs-found' && e.data.some((h) => h.tournament === 'Testpokal')), 'Zentrale nicht gefunden');
    await b.call('finderStop');
    await b.call('hubStop');
    b.close();
  });

  await test('Zweiter Start erkennt das laufende Hajime und beendet sich', async () => {
    const second = spawn(process.execPath, [path.join(__dirname, '..', 'windows', 'hajime-windows.js'), '--no-browser', '--foreground'], {
      env: Object.assign({}, process.env, { HAJIME_UI_PORT: String(UI), HAJIME_HUB_PORT: String(HUB) }),
      stdio: 'ignore',
    });
    const code = await new Promise((resolve) => second.on('exit', resolve));
    assert.strictEqual(code, 0);
  });

  proc.kill();
  if (process.exitCode) console.error(out);
  console.log(`\n${passed} Tests bestanden`);
})();
