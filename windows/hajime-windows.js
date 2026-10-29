/*
 * Hajime für Windows – läuft mit der signierten node.exe, ohne Installation und ohne eigene .exe.
 *
 *  - liefert die Hajime-Seiten an Microsoft Edge aus (nur auf diesem Rechner: 127.0.0.1:47811;
 *    der Port bleibt fest, weil Edge die Hajime-Daten pro Adresse speichert)
 *  - öffnet Edge als eigenes Fenster ohne Adressleiste (App-Modus)
 *  - Brücke für „Matten im Netz“ (WebSocket /bridge): Zentrale starten, Zentrale suchen,
 *    Firewall-Freigabe für die Zentrale (über das Windows-Programm netsh, mit Abfrage von Windows)
 *  - beendet sich, wenn kein Hajime-Fenster mehr offen ist
 *
 * Aufruf (macht „Hajime starten.cmd“):  node.exe hajime-windows.js
 *   --no-browser   kein Fenster öffnen (Tests)
 *   --stay         nicht beenden, wenn kein Fenster offen ist (Tests)
 *   --foreground   nicht in den Hintergrund wechseln (Fehlersuche)
 * Umgebung: HAJIME_UI_PORT, HAJIME_HUB_PORT, HAJIME_NO_BROWSER, HAJIME_FW_DEMO=missing|deny (nur für Tests und Screenshots)
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, execFile } = require('child_process');

const DIR = __dirname;
// im Paket liegt alles in „programm“, beim Entwickeln im Repository
const NET = require(fs.existsSync(path.join(DIR, 'hub.js')) ? path.join(DIR, 'hub.js') : path.join(DIR, '..', 'hub.js'));
const APP = fs.existsSync(path.join(DIR, 'app')) ? path.join(DIR, 'app') : path.join(DIR, '..', 'src');
const UI_PORT = Number(process.env.HAJIME_UI_PORT) || 47811;
const HUB_PORT = Number(process.env.HAJIME_HUB_PORT) || NET.HTTP_PORT;
const IS_WIN = process.platform === 'win32';
const ARGS = new Set(process.argv.slice(2));
if (process.env.HAJIME_NO_BROWSER) ARGS.add('--no-browser'); // Starttest in der CI
const VERSION = (() => {
  for (const f of [path.join(DIR, 'version.json'), path.join(DIR, '..', 'package.json')]) {
    try {
      return JSON.parse(fs.readFileSync(f, 'utf8')).version;
    } catch (err) {
      /* nächste Datei */
    }
  }
  return '';
})();
const UI_URL = `http://127.0.0.1:${UI_PORT}/control.html`;

/* ---------- Protokoll (zur Fehlersuche) ---------- */

const LOG_DIR = path.join(IS_WIN ? process.env.LOCALAPPDATA || os.tmpdir() : os.tmpdir(), 'Hajime');
const LOG_FILE = path.join(LOG_DIR, 'hajime-windows.log');
function log(msg) {
  const line = `${new Date().toISOString()} [${process.pid}] ${msg}\n`;
  if (ARGS.has('--foreground') || !IS_WIN) process.stdout.write(line);
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    if (fs.existsSync(LOG_FILE) && fs.statSync(LOG_FILE).size > 1024 * 1024) fs.renameSync(LOG_FILE, LOG_FILE + '.alt');
    fs.appendFileSync(LOG_FILE, line);
  } catch (err) {
    /* ohne Protokoll weiter */
  }
}

// Meldung als Windows-Fenster (wenn etwas grundsätzlich nicht geht)
function alertUser(text) {
  log('Meldung: ' + text);
  if (!IS_WIN) return;
  const t = text.replace(/'/g, "''");
  execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Add-Type -AssemblyName PresentationFramework; [void][System.Windows.MessageBox]::Show('${t}', 'Hajime')`], { windowsHide: true }, () => {});
}

/* ---------- Fenster öffnen ---------- */

function findBrowser() {
  const env = process.env;
  const bases = [env['ProgramFiles(x86)'], env.ProgramFiles, env.LOCALAPPDATA].filter(Boolean);
  const list = [];
  bases.forEach((b) => list.push(path.join(b, 'Microsoft', 'Edge', 'Application', 'msedge.exe')));
  bases.forEach((b) => list.push(path.join(b, 'Google', 'Chrome', 'Application', 'chrome.exe')));
  return list.find((f) => fs.existsSync(f)) || null;
}

function openUrl(url) {
  if (IS_WIN) spawn('cmd.exe', ['/d', '/c', `start "" "${url}"`], { windowsHide: true, windowsVerbatimArguments: true, detached: true, stdio: 'ignore' }).unref();
  else spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
}

function openWindow() {
  const exe = IS_WIN ? findBrowser() : null;
  if (exe) {
    log('Fenster öffnen: ' + exe);
    spawn(exe, ['--app=' + UI_URL, '--window-size=1400,900'], { detached: true, stdio: 'ignore' }).unref();
  } else {
    log('Kein Edge/Chrome gefunden – Standardbrowser');
    openUrl(UI_URL);
  }
}

/* ---------- Firewall-Freigabe (nur Windows, nur für die Zentrale) ---------- */

const FW_NAME = 'Hajime-Zentrale';
// nur für Tests und Screenshots auf anderen Systemen: Freigabe nachspielen (missing | deny)
const FW_DEMO = process.env.HAJIME_FW_DEMO || '';
let demoAllowed = false;

function powershell(script, timeout) {
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], { windowsHide: true, timeout: timeout || 60000 }, (err, stdout, stderr) => {
      resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, out: String(stdout || '').trim(), err: String(stderr || '').trim() });
    });
  });
}

const FW = {
  // Gibt es eine aktive Regel, die eingehende Verbindungen für genau diese node.exe erlaubt?
  async status() {
    if (FW_DEMO) return { needed: true, ok: demoAllowed };
    if (!IS_WIN) return { needed: false, ok: true };
    const r = await powershell(
      `$ErrorActionPreference='SilentlyContinue'; Get-NetFirewallRule -DisplayName '${FW_NAME}' | ` +
        `Where-Object { $_.Enabled -eq 'True' -and $_.Direction -eq 'Inbound' -and $_.Action -eq 'Allow' } | ` +
        `Get-NetFirewallApplicationFilter | ForEach-Object { $_.Program }`
    );
    const progs = r.out
      .split(/\r?\n/)
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    const ok = progs.includes(process.execPath.toLowerCase());
    log(`Firewall-Regel: ${ok ? 'vorhanden' : 'fehlt'}${r.err ? ' (' + r.err + ')' : ''}`);
    return { needed: true, ok };
  },

  // netsh als Administrator: Windows fragt „Möchten Sie zulassen …?“ (Herausgeber: Microsoft Windows)
  async netshElevated(argLine) {
    const a = argLine.replace(/'/g, "''");
    const r = await powershell(`try { $p = Start-Process -FilePath 'netsh.exe' -ArgumentList '${a}' -Verb RunAs -WindowStyle Hidden -Wait -PassThru; exit $p.ExitCode } catch { exit 1223 }`, 300000);
    log(`netsh ${argLine.split(' ').slice(0, 4).join(' ')} … → ${r.code}`);
    return r.code;
  },

  async allow() {
    if (FW_DEMO) {
      await new Promise((r) => setTimeout(r, 1500));
      if (FW_DEMO === 'deny') return { ok: false, reason: 'cancelled', code: 1223 };
      demoAllowed = true;
      return { ok: true };
    }
    if (!IS_WIN) return { ok: true };
    const code = await FW.netshElevated(
      `advfirewall firewall add rule name="${FW_NAME}" dir=in action=allow program="${process.execPath}" enable=yes profile=any remoteip=localsubnet description="Hajime - Matten im Netz verbinden sich mit dieser Zentrale"`
    );
    const st = await FW.status();
    if (st.ok) return { ok: true };
    return { ok: false, reason: code === 1223 ? 'cancelled' : 'failed', code };
  },

  async remove() {
    if (FW_DEMO) {
      demoAllowed = false;
      return { ok: true };
    }
    if (!IS_WIN) return { ok: true };
    const code = await FW.netshElevated(`advfirewall firewall delete rule name="${FW_NAME}" program="${process.execPath}"`);
    const st = await FW.status();
    return { ok: !st.ok, reason: code === 1223 ? 'cancelled' : '', code };
  },
};

/* ---------- Matten im Netz: Zentrale und Suche ---------- */

let hub = null;
let finder = null;
const clients = new Set();
function broadcast(event, data) {
  clients.forEach((c) => c.send({ event, data }));
}

const OPS = {
  async hubStart(opts) {
    opts = opts || {};
    if (hub) {
      hub.update({ code: String(opts.code), tournament: opts.tournament || '' });
      return { port: hub.port(), addresses: hub.addresses(), name: hub.name() };
    }
    const h = NET.createHub({
      code: String(opts.code),
      tournament: opts.tournament || '',
      name: opts.name || os.hostname(),
      version: VERSION,
      port: HUB_PORT,
      log,
      onMat: (ev) => broadcast('hub-event', ev),
    });
    try {
      const r = await h.start();
      hub = h;
      return r;
    } catch (err) {
      await h.stop();
      throw err;
    }
  },
  async hubStop() {
    if (hub) await hub.stop();
    hub = null;
  },
  hubSend(id, msg) {
    return hub ? hub.send(id, msg) : false;
  },
  hubOverview(data) {
    if (hub) hub.setOverview(data);
  },
  finderStart() {
    if (!finder) finder = NET.createFinder((list) => broadcast('hubs-found', list), log, { port: HUB_PORT });
    else finder.rescan();
    return finder.list();
  },
  finderStop() {
    if (finder) finder.stop();
    finder = null;
  },
  openExternal(url) {
    if (/^https?:\/\//.test(String(url))) openUrl(String(url));
  },
  firewallStatus: () => FW.status(),
  firewallAllow: () => FW.allow(),
  firewallRemove: () => FW.remove(),
};

/* ---------- Seiten ausliefern ---------- */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
};

function send(res, status, type, body) {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
  res.end(body);
}

// nur Aufrufe von diesem Rechner unter der eigenen Adresse (Schutz vor fremden Webseiten)
function hostOk(req) {
  const host = String(req.headers.host || '');
  return host === `127.0.0.1:${UI_PORT}` || host === `localhost:${UI_PORT}`;
}

function onRequest(req, res) {
  if (!hostOk(req)) return send(res, 403, 'text/plain', 'Nicht erlaubt');
  let url;
  try {
    url = decodeURIComponent((req.url || '/').split('?')[0]);
  } catch (err) {
    return send(res, 400, 'text/plain', 'Ungültige Adresse');
  }
  if (url === '/__hajime') return send(res, 200, MIME['.json'], JSON.stringify({ hajime: 1, version: VERSION, windows: clients.size, pid: process.pid, hub: hub ? hub.port() : 0 }));
  if (url === '/__show' && req.method === 'POST') {
    // zweiter Doppelklick: vorhandenes Fenster nach vorn, sonst neues öffnen
    if (clients.size) broadcast('focus', null);
    else if (!ARGS.has('--no-browser')) openWindow();
    return send(res, 200, MIME['.json'], JSON.stringify({ shown: clients.size > 0 }));
  }
  if (url === '/') {
    res.writeHead(302, { Location: '/control.html' });
    return res.end();
  }
  if (url === '/js/native.js') return send(res, 200, MIME['.js'], fs.readFileSync(path.join(DIR, 'native.js')));
  if (url === '/js/webapp.js') return send(res, 200, MIME['.js'], '/* im Windows-Paket ohne Offline-Speicher */\n');
  if (url === '/sw.js') return send(res, 404, 'text/plain', '');
  const file = path.join(APP, url);
  if (!file.startsWith(APP + path.sep)) return send(res, 403, 'text/plain', 'Nicht erlaubt');
  if (url === '/js/version.js' && !fs.existsSync(file)) return send(res, 200, MIME['.js'], `window.HAJIME_VERSION = ${JSON.stringify(VERSION)};\n`);
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, 'text/plain', 'Nicht gefunden');
    const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
    if (url === '/control.html') {
      // Brücke vor der Transportschicht laden
      let html = data.toString('utf8');
      if (!html.includes('js/native.js')) html = html.replace('<script src="js/transport.js"></script>', '<script src="js/native.js"></script>\n    <script src="js/transport.js"></script>');
      return send(res, 200, type, html);
    }
    send(res, 200, type, data);
  });
}

let idleTimer = 0;
function checkIdle() {
  clearTimeout(idleTimer);
  if (clients.size || ARGS.has('--stay')) return;
  // kurz warten: Neuladen der Seite oder ein neues Fenster
  idleTimer = setTimeout(() => {
    if (!clients.size) shutdown('kein Hajime-Fenster mehr offen');
  }, 15000);
}

function onUpgrade(req, socket) {
  const origin = String(req.headers.origin || '');
  if ((req.url || '').split('?')[0] !== '/bridge' || !hostOk(req) || (origin !== `http://127.0.0.1:${UI_PORT}` && origin !== `http://localhost:${UI_PORT}`)) {
    socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
    return;
  }
  let conn = null;
  conn = NET.acceptWs(
    req,
    socket,
    async (text) => {
      let m;
      try {
        m = JSON.parse(text);
      } catch (err) {
        return;
      }
      const fn = OPS[m.op];
      if (!fn) return m.id && conn.send({ id: m.id, ok: false, error: 'Unbekannt: ' + m.op });
      try {
        const result = await fn.apply(null, m.args || []);
        if (m.id) conn.send({ id: m.id, ok: true, result: result === undefined ? null : result });
      } catch (err) {
        log(`${m.op}: ${err.message}`);
        if (m.id) conn.send({ id: m.id, ok: false, error: err.message });
      }
    },
    () => {
      clients.delete(conn);
      log(`Fenster getrennt (${clients.size} offen)`);
      checkIdle();
    }
  );
  if (!conn) return;
  clients.add(conn);
  clearTimeout(idleTimer);
  log(`Fenster verbunden (${clients.size} offen)`);
}

async function shutdown(why) {
  log('Beenden: ' + why);
  try {
    if (finder) finder.stop();
    if (hub) await hub.stop();
  } catch (err) {
    /* egal */
  }
  process.exit(0);
}

/* ---------- Start ---------- */

function ping() {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port: UI_PORT, path: '/__hajime', timeout: 1500, headers: { host: `127.0.0.1:${UI_PORT}` } }, (res) => {
      let b = '';
      res.on('data', (d) => (b += d));
      res.on('end', () => {
        try {
          resolve(JSON.parse(b).hajime === 1);
        } catch (err) {
          resolve(false);
        }
      });
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(false));
  });
}

function post(p) {
  return new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port: UI_PORT, path: p, method: 'POST', timeout: 3000 }, (res) => {
      res.resume();
      res.on('end', resolve);
    });
    req.on('timeout', () => req.destroy());
    req.on('error', resolve);
    req.end();
  });
}

async function main() {
  if (await ping()) {
    log('Hajime läuft schon – Fenster zeigen');
    if (!ARGS.has('--no-browser')) await post('/__show');
    return;
  }
  // Unter Windows im Hintergrund weiterlaufen: Das schwarze Fenster von „Hajime starten“ geht gleich wieder zu
  if (IS_WIN && !ARGS.has('--child') && !ARGS.has('--foreground')) {
    spawn(process.execPath, [__filename, '--child'].concat(process.argv.slice(2)), { cwd: DIR, detached: true, windowsHide: true, stdio: 'ignore' }).unref();
    return;
  }
  const server = http.createServer(onRequest);
  server.on('upgrade', onUpgrade);
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') alertUser(`Hajime kann nicht starten: Ein anderes Programm belegt Port ${UI_PORT}. Bitte den Rechner neu starten und es noch einmal versuchen.`);
    else alertUser('Hajime kann nicht starten: ' + err.message);
    process.exit(1);
  });
  server.listen(UI_PORT, '127.0.0.1', () => {
    log(`Hajime ${VERSION} läuft: ${UI_URL} (Seiten aus ${APP})`);
    if (!ARGS.has('--no-browser')) openWindow();
    // Fenster ging nie auf (Edge blockiert?): nach 2 Minuten beenden
    if (!ARGS.has('--stay')) {
      idleTimer = setTimeout(() => {
        if (!clients.size) shutdown('kein Fenster verbunden');
      }, 120000);
    }
  });
}

process.on('uncaughtException', (err) => log('Fehler: ' + (err.stack || err.message)));
main();
