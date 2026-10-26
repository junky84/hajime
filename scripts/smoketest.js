// Starttest der fertig gebauten Pakete (läuft in GitHub Actions nach dem Build):
// startet jede Variante mit HAJIME_SELFTEST, wartet auf Screenshots und Protokoll.
//   node scripts/smoketest.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

const dist = path.resolve('dist');
const results = path.resolve('selftest');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hajime-'));
fs.mkdirSync(results, { recursive: true });

function find(dir, re) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (re.test(e.name)) return p;
    if (e.isDirectory() && !e.name.endsWith('.app')) {
      const r = find(p, re);
      if (r) return r;
    }
  }
  return null;
}

const cases = [];
const files = fs.readdirSync(dist);
if (process.platform === 'win32') {
  const portable = files.find((f) => /portable\.exe$/i.test(f));
  if (portable) cases.push({ name: 'windows-portable', cmd: path.join(dist, portable) });
  const zip = files.find((f) => /Windows\.zip$/i.test(f));
  if (zip) {
    const dir = path.join(tmp, 'zip');
    fs.mkdirSync(dir);
    execFileSync('tar', ['-xf', path.join(dist, zip), '-C', dir]);
    cases.push({ name: 'windows-zip', cmd: find(dir, /^Hajime\.exe$/i) });
  }
} else if (process.platform === 'darwin') {
  const zip = files.find((f) => /Mac\.zip$/i.test(f));
  if (zip) {
    const dir = path.join(tmp, 'mac');
    fs.mkdirSync(dir);
    execFileSync('ditto', ['-x', '-k', path.join(dist, zip), dir]);
    cases.push({ name: 'mac-zip', cmd: path.join(find(dir, /\.app$/), 'Contents', 'MacOS', 'Hajime') });
  }
}

function runCase(c) {
  return new Promise((resolve) => {
    const out = path.join(results, c.name);
    fs.mkdirSync(out, { recursive: true });
    const started = Date.now();
    const child = spawn(c.cmd, [], {
      env: { ...process.env, HAJIME_SELFTEST: out, HAJIME_SELFTEST_DELAY: '5000' },
      stdio: 'ignore',
    });
    child.on('error', (err) => fs.appendFileSync(path.join(out, 'selftest.log'), 'Startfehler: ' + err.message + '\n'));
    const logFile = path.join(out, 'selftest.log');
    const timer = setInterval(() => {
      const log = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8') : '';
      const done = /Screenshots geschrieben/.test(log);
      const timeout = Date.now() - started > 240000;
      if (done || timeout) {
        clearInterval(timer);
        setTimeout(() => {
          try {
            child.kill();
          } catch (e) {
            /* schon beendet */
          }
          const ok = done && /Anzeige verbunden: ja/.test(log) && !/FEHLER/.test(log);
          resolve({ name: c.name, ok, seconds: ((Date.now() - started) / 1000).toFixed(1), log });
        }, 3000);
      }
    }, 500);
  });
}

(async () => {
  if (!cases.length) {
    console.error('Keine Pakete in dist/ gefunden');
    process.exit(1);
  }
  let failed = false;
  for (const c of cases) {
    const r = await runCase(c);
    console.log(`\n=== ${r.name}: ${r.ok ? 'OK' : 'FEHLGESCHLAGEN'} nach ${r.seconds} s ===\n${r.log || '(kein Protokoll – App hat nicht gestartet)'}`);
    if (!r.ok) failed = true;
  }
  process.exit(failed ? 1 : 0);
})();
