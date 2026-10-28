/*
 * Hajime-Zentrale: kleiner Server im lokalen Netz (HTTP + WebSocket) und automatische Suche.
 * Reines Node.js ohne Zusatzpakete, damit die App ohne Installation läuft.
 *
 *  - HTTP  :47801  „/“ Übersicht aller Matten für Browser/Fernseher, „/overview.json“ deren Daten
 *  - WS    :47801/ws  Mattenrechner melden ihren Stand, die Zentrale schickt Kampflisten und Aufrufe
 *  - UDP   :47800  Die Zentrale ruft alle 2 s „Hier bin ich“ ins Netz (Broadcast), Matten hören zu
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
        overviewPage = fs.readFileSync(path.join(__dirname, 'src', 'overview.html'), 'utf8');
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
    return { port, addresses: addresses() };
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

function createFinder(onFound, log) {
  const found = new Map();
  let sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  sock.on('error', (err) => {
    (log || (() => {}))('Suche nach der Zentrale nicht möglich: ' + err.message);
    try {
      sock.close();
    } catch (e) {
      /* egal */
    }
    sock = null;
  });
  sock.on('message', (buf, rinfo) => {
    let m;
    try {
      m = JSON.parse(buf.toString('utf8'));
    } catch (err) {
      return;
    }
    if (!m || m.hajime !== 1 || !m.port) return;
    // dieselbe Zentrale über mehrere Wege (Loopback, Broadcast): nur einmal
    const key = m.name + '|' + m.port;
    const prev = found.get(key);
    let address = rinfo.address;
    if (prev && address === '127.0.0.1' && prev.address !== '127.0.0.1') address = prev.address;
    const hub = { key, address, port: m.port, name: m.name || address, tournament: m.tournament || '', version: m.version || '', seenAt: Date.now() };
    found.set(key, hub);
    onFound(list());
  });
  sock.bind(DISCOVERY_PORT, () => {
    // Multicast-Gruppe auf allen Netzwerken (und lokal) betreten
    [null].concat(ipv4s().map((a) => a.address)).forEach((ifc) => {
      try {
        if (ifc) sock.addMembership(MULTICAST, ifc);
        else sock.addMembership(MULTICAST);
      } catch (err) {
        /* Netzwerk ohne Multicast */
      }
    });
  });
  const prune = setInterval(() => {
    const now = Date.now();
    let changed = false;
    found.forEach((h, k) => {
      if (now - h.seenAt > 8000) {
        found.delete(k);
        changed = true;
      }
    });
    if (changed) onFound(list());
  }, 3000);
  function list() {
    return Array.from(found.values()).sort((a, b) => a.name.localeCompare(b.name));
  }
  return {
    list,
    stop() {
      clearInterval(prune);
      if (sock) {
        try {
          sock.close();
        } catch (e) {
          /* egal */
        }
      }
      sock = null;
    },
  };
}

module.exports = { createHub, createFinder, encodeFrame, DISCOVERY_PORT, HTTP_PORT };
