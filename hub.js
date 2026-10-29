/*
 * Hajime-Zentrale: kleiner Server im lokalen Netz (HTTP + WebSocket) und automatische Suche.
 * Reines Node.js ohne Zusatzpakete, damit die App ohne Installation läuft.
 *
 *  - HTTP  :47801  „/“ Übersicht aller Matten für Browser/Fernseher, „/overview.json“ deren Daten
 *  - WS    :47801/ws  Mattenrechner melden ihren Stand, die Zentrale schickt Kampflisten und Aufrufe
 *  - Suche: Mattenrechner fragen die Nachbaradressen im eigenen Netz nach „/hajime.json“ (nur
 *    ausgehende Verbindungen – deshalb braucht ein Mattenrechner keine Firewall-Freigabe)
 *  - UDP   :47800  Die Zentrale ruft zusätzlich „Hier bin ich“ ins Netz (für Matten bis Version 1.5)
 *
 * Nur lokales Netz, kein Internet. Eine Matte muss den Turniercode kennen, sonst wird sie abgewiesen.
 */
'use strict';
const http = require('http');
const crypto = require('crypto');
const dgram = require('dgram');
const os = require('os');
const fs = require('fs');
const path = require('path');

const DISCOVERY_PORT = 47800;
const MULTICAST = '239.255.47.80'; // zusätzlich zum Broadcast, falls das Netz Broadcasts filtert
const HTTP_PORT = 47801;
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_FRAME = 32 * 1024 * 1024;

/* ---------- WebSocket (RFC 6455, nur was Browser senden) ---------- */

function encodeFrame(op, data) {
  const body = Buffer.isBuffer(data) ? data : Buffer.from(String(data));
  let head;
  if (body.length < 126) head = Buffer.from([0x80 | op, body.length]);
  else if (body.length < 65536) {
    head = Buffer.alloc(4);
    head[0] = 0x80 | op;
    head[1] = 126;
    head.writeUInt16BE(body.length, 2);
  } else {
    head = Buffer.alloc(10);
    head[0] = 0x80 | op;
    head[1] = 127;
    head.writeBigUInt64BE(BigInt(body.length), 2);
  }
  return Buffer.concat([head, body]);
}

class WsConn {
  constructor(socket, onText, onClose) {
    this.socket = socket;
    this.buf = Buffer.alloc(0);
    this.parts = [];
    this.open = true;
    this.onText = onText;
    this.onClose = onClose;
    socket.setNoDelay(true);
    socket.on('data', (d) => this.data(d));
    socket.on('close', () => this.closed());
    socket.on('error', () => this.closed());
  }
  data(d) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, d]) : d;
    for (;;) {
      const b = this.buf;
      if (b.length < 2) return;
      const fin = (b[0] & 0x80) !== 0;
      const op = b[0] & 0x0f;
      const masked = (b[1] & 0x80) !== 0;
      let len = b[1] & 0x7f;
      let off = 2;
      if (len === 126) {
        if (b.length < 4) return;
        len = b.readUInt16BE(2);
        off = 4;
      } else if (len === 127) {
        if (b.length < 10) return;
        len = Number(b.readBigUInt64BE(2));
        off = 10;
      }
      if (len > MAX_FRAME) return this.close();
      const m = masked ? 4 : 0;
      if (b.length < off + m + len) return;
      let payload = b.subarray(off + m, off + m + len);
      if (masked) {
        const mask = b.subarray(off, off + 4);
        payload = Buffer.from(payload);
        for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
      }
      this.buf = b.subarray(off + m + len);
      if (op === 0x8) return this.close();
      if (op === 0x9) this.raw(0xa, payload);
      else if (op === 0x1 || op === 0x0) {
        this.parts.push(payload);
        if (fin) {
          const text = Buffer.concat(this.parts).toString('utf8');
          this.parts = [];
          try {
            this.onText(text);
          } catch (err) {
            /* fehlerhafte Nachricht ignorieren */
          }
        }
      }
    }
  }
  raw(op, data) {
    if (!this.open) return;
    try {
      this.socket.write(encodeFrame(op, data));
    } catch (err) {
      this.closed();
    }
  }
  send(obj) {
    this.raw(0x1, JSON.stringify(obj));
  }
  close() {
    if (this.open) {
      try {
        this.socket.end(encodeFrame(0x8, Buffer.alloc(0)));
      } catch (err) {
        /* schon zu */
      }
    }
    this.closed();
  }
  closed() {
    if (!this.open) return;
    this.open = false;
    try {
      this.socket.destroy();
    } catch (err) {
      /* egal */
    }
    this.onClose();
  }
}

/* WebSocket-Handshake für einen HTTP-Upgrade; liefert die Verbindung oder null */
function acceptWs(req, socket, onText, onClose) {
  const key = req.headers['sec-websocket-key'];
  if (!key || String(req.headers.upgrade || '').toLowerCase() !== 'websocket') {
    socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
    return null;
  }
  const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
  socket.write(['HTTP/1.1 101 Switching Protocols', 'Upgrade: websocket', 'Connection: Upgrade', 'Sec-WebSocket-Accept: ' + accept, '', ''].join('\r\n'));
  return new WsConn(socket, onText, onClose);
}

/* ---------- Netzwerk-Adressen ---------- */

function ipv4s() {
  const out = [];
  Object.values(os.networkInterfaces()).forEach((list) =>
    (list || []).forEach((a) => {
      if ((a.family === 'IPv4' || a.family === 4) && !a.internal) out.push(a);
    })
  );
  return out;
}
function broadcastOf(a) {
  const ip = a.address.split('.').map(Number);
  const mask = a.netmask.split('.').map(Number);
  return ip.map((x, i) => (x & mask[i]) | (~mask[i] & 255)).join('.');
}

/* ---------- Zentrale ---------- */

/*
 * opts: { code, name, tournament, version, onMat(evt), log }
 * onMat({ type: 'hello' | 'message' | 'gone', id, mat, msg, address })
 */
function createHub(opts) {
  const log = opts.log || (() => {});
  const clients = new Map(); // id → { conn, mat, address, seenAt, ok }
  let overview = { tournament: opts.tournament || '', mats: [], at: Date.now() };
  let server = null;
  let beacon = null;
  let beaconTimer = 0;
  let pingTimer = 0;
  let port = 0;
  let info = { code: String(opts.code || ''), name: opts.name || os.hostname(), tournament: opts.tournament || '', version: opts.version || '' };

  let overviewPage = null;
  function page() {
    if (overviewPage == null) {
      try {
        const file = [path.join(__dirname, 'src', 'overview.html'), path.join(__dirname, 'app', 'overview.html')].find((f) => fs.existsSync(f));
        overviewPage = fs.readFileSync(file, 'utf8');
      } catch (err) {
        overviewPage = '<!doctype html><meta charset="utf-8"><p>Übersicht nicht gefunden.</p>';
      }
    }
    return overviewPage;
  }

  function onRequest(req, res) {
    const url = (req.url || '/').split('?')[0];
    const head = { 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' };
    if (url === '/overview.json') {
      res.writeHead(200, Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, head));
      res.end(JSON.stringify(Object.assign({}, overview, { now: Date.now() })));
    } else if (url === '/' || url === '/index.html') {
      res.writeHead(200, Object.assign({ 'Content-Type': 'text/html; charset=utf-8' }, head));
      res.end(page());
    } else if (url === '/hajime.json') {
      res.writeHead(200, Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, head));
      res.end(JSON.stringify({ hajime: 1, name: info.name, tournament: info.tournament, version: info.version }));
    } else {
      res.writeHead(404, head);
      res.end();
    }
  }

  function onUpgrade(req, socket) {
    const key = req.headers['sec-websocket-key'];
    if ((req.url || '').split('?')[0] !== '/ws' || !key || String(req.headers.upgrade || '').toLowerCase() !== 'websocket') {
      socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
      return;
    }
    const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
    socket.write(['HTTP/1.1 101 Switching Protocols', 'Upgrade: websocket', 'Connection: Upgrade', 'Sec-WebSocket-Accept: ' + accept, '', ''].join('\r\n'));
    const id = crypto.randomBytes(6).toString('hex');
    const address = String(socket.remoteAddress || '').replace(/^::ffff:/, '');
    const c = { id, conn: null, mat: '', address, seenAt: Date.now(), ok: false };
    c.conn = new WsConn(
      socket,
      (text) => {
        const msg = JSON.parse(text);
        c.seenAt = Date.now();
        if (!c.ok) {
          if (msg.type !== 'hello') return;
          if (String(msg.code || '') !== info.code) {
            c.conn.send({ type: 'error', reason: 'code' });
            log(`Matte von ${address} abgewiesen: falscher Turniercode`);
            setTimeout(() => c.conn.close(), 200);
            return;
          }
          c.ok = true;
          c.mat = String(msg.mat || '');
          c.conn.send({ type: 'welcome', id, name: info.name, tournament: info.tournament });
          log(`Matte verbunden: ${c.mat} (${address})`);
          if (opts.onMat) opts.onMat({ type: 'hello', id, mat: c.mat, address, msg });
          return;
        }
        if (msg.mat != null) c.mat = String(msg.mat);
        if (msg.type === 'pong') return;
        if (opts.onMat) opts.onMat({ type: 'message', id, mat: c.mat, address, msg });
      },
      () => {
        clients.delete(id);
        if (c.ok) {
          log(`Matte getrennt: ${c.mat} (${address})`);
          if (opts.onMat) opts.onMat({ type: 'gone', id, mat: c.mat, address });
        }
      }
    );
    clients.set(id, c);
  }

  function sendBeacon() {
    if (!beacon) return;
    const msg = Buffer.from(JSON.stringify({ hajime: 1, port, name: info.name, tournament: info.tournament, version: info.version }));
    const targets = new Set(['255.255.255.255', '127.0.0.1']);
    ipv4s().forEach((a) => targets.add(broadcastOf(a)));
    targets.add(MULTICAST);
    targets.forEach((addr) => beacon.send(msg, DISCOVERY_PORT, addr, () => {}));
  }

  function listen(p) {
    return new Promise((resolve, reject) => {
      const s = http.createServer(onRequest);
      s.on('upgrade', onUpgrade);
      s.once('error', reject);
      s.listen(p, '0.0.0.0', () => resolve(s));
    });
  }

  async function start() {
    let last = null;
    for (let p = opts.port || HTTP_PORT; p < (opts.port || HTTP_PORT) + 10; p++) {
      try {
        server = await listen(p);
        port = server.address().port;
        break;
      } catch (err) {
        last = err;
        if (err.code !== 'EADDRINUSE') throw err;
      }
    }
    if (!server) throw last || new Error('Kein freier Port');
    if (opts.port === 0) port = server.address().port;
    if (opts.beacon !== false) {
      beacon = dgram.createSocket({ type: 'udp4', reuseAddr: true });
      beacon.on('error', (err) => log('Suche (Broadcast) nicht möglich: ' + err.message));
      beacon.bind(0, () => {
        try {
          beacon.setBroadcast(true);
          beacon.setMulticastTTL(1);
          beacon.setMulticastLoopback(true);
        } catch (err) {
          /* ohne Broadcast nur Adresse von Hand */
        }
        sendBeacon();
      });
      beaconTimer = setInterval(sendBeacon, 2000);
    }
    // Lebenszeichen; stille Verbindungen (z. B. WLAN weg) nach 20 s schließen
    pingTimer = setInterval(() => {
      const now = Date.now();
      clients.forEach((c) => {
        if (now - c.seenAt > 20000) c.conn.close();
        else if (c.ok) c.conn.send({ type: 'ping', at: now });
      });
    }, 5000);
    log(`Zentrale gestartet auf Port ${port}`);
    return { port, addresses: addresses(), name: info.name };
  }

  function addresses() {
    return ipv4s().map((a) => a.address);
  }

  function stop() {
    clearInterval(beaconTimer);
    clearInterval(pingTimer);
    clients.forEach((c) => c.conn.close());
    clients.clear();
    if (beacon) {
      try {
        beacon.close();
      } catch (err) {
        /* egal */
      }
      beacon = null;
    }
    return new Promise((resolve) => {
      if (!server) return resolve();
      server.close(() => resolve());
      server = null;
    });
  }

  return {
    start,
    stop,
    addresses,
    port: () => port,
    name: () => info.name,
    update(patch) {
      info = Object.assign(info, patch || {});
    },
    setOverview(o) {
      overview = Object.assign({}, o, { at: Date.now() });
    },
    send(id, msg) {
      const c = clients.get(id);
      if (c && c.ok) c.conn.send(msg);
      return !!(c && c.ok);
    },
    clients: () => Array.from(clients.values()).filter((c) => c.ok).map((c) => ({ id: c.id, mat: c.mat, address: c.address, seenAt: c.seenAt })),
  };
}

/* ---------- Suche nach Zentralen (Mattenrechner) ---------- */

/*
 * Adressen, die eine Matte nach einer Zentrale fragt: das eigene Netz (bei großen Netzen nur die
 * 254 Nachbarn der eigenen Adresse) und der eigene Rechner.
 */
function scanHosts() {
  const hosts = new Set(['127.0.0.1']);
  const toInt = (ip) => ip.split('.').reduce((n, x) => n * 256 + Number(x), 0);
  const toIp = (n) => [24, 16, 8, 0].map((sh) => Math.floor(n / 2 ** sh) % 256).join('.');
  ipv4s().forEach((a) => {
    const ip = toInt(a.address);
    let bits = String(a.netmask)
      .split('.')
      .reduce((n, x) => n + Number(x).toString(2).replace(/0/g, '').length, 0);
    if (bits < 24) bits = 24;
    if (bits > 30) return;
    const size = 2 ** (32 - bits);
    const base = ip - (ip % size);
    for (let h = base + 1; h < base + size - 1; h++) hosts.add(toIp(h));
  });
  return Array.from(hosts);
}

function probe(host, port, timeout) {
  return new Promise((resolve) => {
    let done = false;
    let req = null;
    // Gesamtzeit begrenzen (Verbindungsaufbau zu Adressen ohne Gerät dauert sonst lange)
    const guard = setTimeout(() => {
      finish(null);
      if (req) req.destroy();
    }, timeout);
    function finish(v) {
      if (done) return;
      done = true;
      clearTimeout(guard);
      resolve(v);
    }
    req = http.get({ host, port, path: '/hajime.json', agent: false, headers: { Connection: 'close' } }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        return finish(null);
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (d) => {
        body += d;
        if (body.length > 4096) req.destroy();
      });
      res.on('end', () => {
        try {
          const m = JSON.parse(body);
          finish(m && m.hajime === 1 ? m : null);
        } catch (err) {
          finish(null);
        }
      });
      res.on('error', () => finish(null));
    });
    req.on('error', () => finish(null));
  });
}

/*
 * opts: { port, hosts (nur für Tests), interval, timeout }
 * Sucht sofort, dann alle 8 s, nach zwei Minuten nur noch alle 30 s.
 */
function createFinder(onFound, log, opts) {
  opts = opts || {};
  const port = opts.port || HTTP_PORT;
  const found = new Map(); // key → Zentrale
  let stopped = false;
  let timer = 0;
  let running = null;
  const started = Date.now();

  function list() {
    return Array.from(found.values())
      .map((h) => ({ key: h.key, address: h.address, port: h.port, name: h.name, tournament: h.tournament, version: h.version, seenAt: h.seenAt }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async function scan() {
    const hosts = opts.hosts || scanHosts();
    const seen = new Set();
    let changed = false;
    let i = 0;
    async function worker() {
      while (!stopped && i < hosts.length) {
        const host = hosts[i++];
        const m = await probe(host, port, opts.timeout || 800);
        if (!m || stopped) continue;
        const key = (m.name || host) + '|' + port;
        const prev = found.get(key);
        // dieselbe Zentrale über mehrere Wege (eigener Rechner, Netzwerk): Netzwerkadresse bevorzugen
        const loop = (a) => /^127\./.test(a);
        const address = prev && loop(host) && !loop(prev.address) ? prev.address : host;
        const hub = { key, address, port, name: m.name || host, tournament: m.tournament || '', version: m.version || '', seenAt: Date.now(), missed: 0 };
        if (!prev || prev.address !== hub.address || prev.tournament !== hub.tournament || prev.name !== hub.name) changed = true;
        found.set(key, hub);
        seen.add(key);
        if (changed) {
          changed = false;
          onFound(list());
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(48, hosts.length) }, worker));
    if (stopped) return;
    // zweimal nicht mehr gefunden: aus der Liste nehmen
    let removed = false;
    found.forEach((h, k) => {
      if (seen.has(k)) return;
      h.missed++;
      if (h.missed >= 2) {
        found.delete(k);
        removed = true;
      }
    });
    if (removed) onFound(list());
  }

  function loop() {
    if (stopped) return;
    running = scan()
      .catch((err) => (log || (() => {}))('Suche nach der Zentrale: ' + err.message))
      .then(() => {
        running = null;
        if (stopped) return;
        const every = opts.interval || (Date.now() - started < 120000 ? 8000 : 30000);
        timer = setTimeout(loop, every);
      });
  }
  loop();

  return {
    list,
    // sofort neu suchen (Knopf „Erneut suchen“)
    rescan() {
      if (stopped || running) return;
      clearTimeout(timer);
      loop();
    },
    stop() {
      stopped = true;
      clearTimeout(timer);
    },
  };
}

module.exports = { createHub, createFinder, scanHosts, acceptWs, WsConn, encodeFrame, DISCOVERY_PORT, HTTP_PORT };
