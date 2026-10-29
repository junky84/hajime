// Tests der Vernetzung: node test/net.test.js
const assert = require('assert');
const http = require('http');
const C = require('../src/js/core.js');
const N = require('../src/js/net.js');
const H = require('../hub.js');

let passed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log('ok  ', name);
  } catch (e) {
    console.error('FAIL', name);
    console.error(e);
    process.exitCode = 1;
  }
}
const entry = (id, w, b, extra) => Object.assign({ id, no: id, ageClass: 'U13', category: '-34 kg', mat: 'Matte 2', white: { name: w, club: 'A' }, blue: { name: b, club: 'B' }, status: 'open', result: null }, extra || {});
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  await test('Ergebnisse der Matte landen in der Kampfliste der Zentrale (Id, sonst Paarung)', () => {
    const hub = C.createState();
    hub.queue = [entry('1', 'Anna', 'Berta'), entry('2', 'Clara', 'Dora'), entry('3', 'Emma', 'Frida')];
    const res = (winner) => ({ fightId: 'f' + winner, winner, reason: 'Ippon', kind: 'ippon', finishedAt: 5 });
    // Kampf 1 mit gleicher Id, Kampf 2 per Excel mit neuer Id und vertauschten Seiten
    const n = N.applyResults(hub, 'Matte 2', [
      Object.assign(entry('1', 'Anna', 'Berta'), { status: 'done', result: res('white') }),
      Object.assign(entry('x9', 'Dora', 'Clara'), { status: 'done', result: res('white'), log: { fightId: 'fwhite2', no: '2' } }),
    ]);
    assert.strictEqual(n, 2);
    assert.strictEqual(hub.queue[0].status, 'done');
    assert.strictEqual(hub.queue[1].result.winner, 'blue'); // Dora war bei der Zentrale Blau
    assert.strictEqual(hub.queue[1].result.mat, 'Matte 2');
    assert.strictEqual(hub.log.length, 1);
    assert.strictEqual(hub.queue[2].status, 'open');
    // zweite Meldung mit demselben Stand ändert nichts
    assert.strictEqual(N.applyResults(hub, 'Matte 2', [Object.assign(entry('1', 'Anna', 'Berta'), { status: 'done', result: res('white') })]), 0);
  });

  await test('Kampfliste an die Matte: beendete bleiben, offene werden ersetzt', () => {
    const mat = C.createState();
    mat.queue = [Object.assign(entry('1', 'Anna', 'Berta'), { status: 'done', result: { winner: 'white' } }), entry('old', 'X', 'Y')];
    const hub = C.createState();
    hub.settings.tournament = 'Bezirk';
    hub.queue = [entry('1', 'Anna', 'Berta'), entry('2', 'Clara', 'Dora'), entry('9', 'Q', 'R', { mat: 'Matte 1' })];
    const msg = N.fightsFor(hub, 'Matte 2');
    assert.strictEqual(msg.entries.length, 2);
    const r = N.mergeFights(mat, msg);
    assert.deepStrictEqual(r, { added: 1, updated: 0, removed: 1 });
    assert.deepStrictEqual(mat.queue.map((e) => [e.id, e.status]), [['1', 'done'], ['2', 'open']]);
    assert.strictEqual(mat.settings.mat, 'Matte 2');
    assert.strictEqual(mat.settings.tournament, 'Bezirk');
  });

  await test('Stand einer Matte und Übersicht mit weiterlaufender Uhr', () => {
    const s = C.createState();
    s.settings.mat = 'Matte 3';
    s.fight.white.name = 'Anna';
    C.hajimeMate(s, 1000);
    const st = N.matStatus(s, [entry('5', 'Clara', 'Dora')], 11000);
    assert.strictEqual(st.mat, 'Matte 3');
    assert.strictEqual(st.current.clockMs, 230000);
    assert.strictEqual(st.next[0].white.name, 'Clara');
    const ov = N.overview(s, [{ id: 'a', mat: 'Matte 3', status: st, receivedAt: 11000, connected: true }], 21000);
    assert.strictEqual(ov.mats[0].current.clockMs, 220000);
    assert.strictEqual(N.wsUrl('192.168.0.5'), 'ws://192.168.0.5:47801/ws');
    assert.strictEqual(N.wsUrl('http://10.0.0.2:47805/'), 'ws://10.0.0.2:47805/ws');
  });

  await test('Zentrale: Turniercode, Nachrichten, Übersicht im Browser', async () => {
    const events = [];
    const hub = H.createHub({ code: '4711', port: 0, beacon: false, name: 'Testzentrale', onMat: (e) => events.push(e) });
    const { port } = await hub.start();
    // falscher Code wird abgewiesen
    const bad = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const badMsg = await new Promise((res) => {
      bad.onopen = () => bad.send(JSON.stringify({ type: 'hello', code: '0000', mat: 'Matte 9' }));
      bad.onmessage = (e) => res(JSON.parse(e.data));
    });
    assert.deepStrictEqual(badMsg, { type: 'error', reason: 'code' });
    // richtiger Code
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const got = [];
    ws.onmessage = (e) => got.push(JSON.parse(e.data));
    await new Promise((res) => (ws.onopen = res));
    ws.send(JSON.stringify({ type: 'hello', code: '4711', mat: 'Matte 1' }));
    await wait(100);
    assert.strictEqual(got[0].type, 'welcome');
    // große Nachricht (über 64 KB) kommt vollständig an
    const big = 'x'.repeat(100000);
    ws.send(JSON.stringify({ type: 'status', mat: 'Matte 1', big }));
    await wait(150);
    const m = events.find((e) => e.type === 'message');
    assert.strictEqual(m.msg.big.length, 100000);
    assert.strictEqual(hub.clients().length, 1);
    // Zentrale → Matte
    assert.strictEqual(hub.send(m.id, { type: 'call', message: 'Hallo' }), true);
    await wait(100);
    assert.strictEqual(got[got.length - 1].message, 'Hallo');
    // Übersicht
    hub.setOverview({ tournament: 'T', mats: [{ mat: 'Matte 1' }] });
    const json = await new Promise((res) => http.get(`http://127.0.0.1:${port}/overview.json`, (r) => {
      let d = '';
      r.on('data', (c) => (d += c));
      r.on('end', () => res(JSON.parse(d)));
    }));
    assert.strictEqual(json.mats[0].mat, 'Matte 1');
    const page = await new Promise((res) => http.get(`http://127.0.0.1:${port}/`, (r) => {
      let d = '';
      r.on('data', (c) => (d += c));
      r.on('end', () => res(d));
    }));
    assert.ok(/<html/i.test(page));
    ws.close();
    await wait(100);
    assert.ok(events.some((e) => e.type === 'gone'));
    await hub.stop();
  });

  await test('Suche: Matte fragt die Adressen ab und findet die Zentrale', async () => {
    const hub = H.createHub({ code: '1', port: 0, beacon: false, name: 'Suchtest', tournament: 'Pokal' });
    await hub.start();
    const found = [];
    const finder = H.createFinder((list) => found.push(list), null, { port: hub.port(), hosts: ['127.0.0.1', '192.0.2.1'], interval: 200, timeout: 500 });
    try {
      for (let i = 0; i < 50 && !found.length; i++) await wait(100);
      let last = found[found.length - 1] || [];
      assert.ok(last.some((h) => h.name === 'Suchtest' && h.tournament === 'Pokal' && /^127\./.test(h.address)), 'Zentrale nicht gefunden');
      // Zentrale weg: nach zwei Durchgängen ohne Antwort aus der Liste
      await hub.stop();
      for (let i = 0; i < 60 && (found[found.length - 1] || []).length; i++) await wait(100);
      last = found[found.length - 1] || [];
      assert.strictEqual(last.length, 0, 'beendete Zentrale steht noch in der Liste');
    } finally {
      finder.stop();
      await hub.stop();
    }
  });

  await test('Suche: Adressbereich bleibt klein (höchstens /24 je Netzwerk)', () => {
    const hosts = H.scanHosts();
    assert.ok(hosts.includes('127.0.0.1'));
    assert.ok(hosts.length <= 1 + 254 * 8, 'zu viele Adressen: ' + hosts.length);
  });

  console.log(`\n${passed} Tests bestanden`);
})();
