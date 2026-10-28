/*
 * Baut die Webseiten-Version nach dist/Hajime-Web:
 *   index.html / "Hajime starten.html"  -> leiten auf app/control.html weiter
 *   app/                                -> die App (Kopie von src/) + Web-App-Dateien
 *
 * Läuft direkt aus dem Ordner (Doppelklick, auch offline) oder auf jedem
 * Webserver. Auf einem Webserver ist sie zusätzlich als App installierbar und
 * funktioniert nach dem ersten Aufruf offline (Service Worker).
 *
 * Aufruf: node scripts/build-web.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const pkg = require(path.join(root, 'package.json'));
const out = path.join(root, 'dist', 'Hajime-Web');
const app = path.join(out, 'app');

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(app, { recursive: true });
fs.cpSync(path.join(root, 'src'), app, { recursive: true });
fs.copyFileSync(path.join(root, 'build', 'web-icon-192.png'), path.join(app, 'icon-192.png'));
fs.copyFileSync(path.join(root, 'build', 'web-icon-512.png'), path.join(app, 'icon-512.png'));

const write = (file, text) => fs.writeFileSync(path.join(app, file), text);

write(
  'manifest.webmanifest',
  JSON.stringify(
    {
      name: 'Hajime – Judo-Anzeigetafel',
      short_name: 'Hajime',
      start_url: 'control.html',
      scope: './',
      display: 'standalone',
      background_color: '#0f1218',
      theme_color: '#0f1218',
      lang: 'de',
      icons: [
        { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
      ],
    },
    null,
    2
  )
);

write(
  'js/webapp.js',
  `/* Webversion: offline-fähig machen (nur auf einem Webserver, nicht per Doppelklick). */
if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
`
);

// Versionsnummer für „Über Hajime“ (die Electron-App fragt sie beim Hauptprozess ab)
write('js/version.js', `window.HAJIME_VERSION = ${JSON.stringify(pkg.version)};\n`);

// Alle Dateien der App vorab in den Offline-Speicher legen
function list(dir, base) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const rel = base ? `${base}/${e.name}` : e.name;
    return e.isDirectory() ? list(path.join(dir, e.name), rel) : [rel];
  });
}
const files = list(app, '').filter((f) => f !== 'sw.js' && !f.endsWith('.DS_Store'));
// Prüfsumme über alle Dateien: jede Änderung ergibt einen neuen Offline-Speicher
const hash = require('crypto').createHash('sha256');
files.forEach((f) => hash.update(f).update(fs.readFileSync(path.join(app, f))));
const stamp = `${pkg.version}-${hash.digest('hex').slice(0, 10)}`;
write(
  'sw.js',
  `/* Offline-Speicher der Webversion ${stamp} */
const CACHE = 'hajime-${stamp}';
const FILES = ${JSON.stringify(['./', ...files])};

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || fetch(e.request)));
});
`
);

// Web-App-Einträge in die Seiten einfügen
function patch(file, head, body) {
  const p = path.join(app, file);
  let html = fs.readFileSync(p, 'utf8');
  html = html.replace('</head>', `${head}\n  </head>`);
  if (body) html = html.replace('</body>', `${body}\n  </body>`);
  fs.writeFileSync(p, html);
}
// Favicon steht schon in src/*.html (img/favicon.png)
patch('control.html', `    <link rel="apple-touch-icon" href="icon-192.png" />\n    <link rel="manifest" href="manifest.webmanifest" />\n    <meta name="theme-color" content="#0f1218" />`, '    <script src="js/version.js"></script>\n    <script src="js/webapp.js"></script>');

// Startseiten im Hauptordner
const redirect = `<!doctype html>
<html lang="de">
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="refresh" content="0; url=app/control.html" />
    <title>Hajime</title>
    <link rel="icon" type="image/png" href="app/img/favicon.png" />
  </head>
  <body style="font-family: system-ui, sans-serif; padding: 2em">
    <p>Hajime wird gestartet … <a href="app/control.html">Falls nicht: hier klicken</a></p>
  </body>
</html>
`;
fs.writeFileSync(path.join(out, 'index.html'), redirect);
fs.writeFileSync(path.join(out, 'Hajime starten.html'), redirect);
fs.writeFileSync(
  path.join(out, 'LIESMICH.txt'),
  `Hajime ${pkg.version} – Webversion (ohne Installation, ohne .exe)

Starten:
  "Hajime starten.html" mit Chrome oder Edge öffnen (Doppelklick oder ins
  Browserfenster ziehen). Es ist kein Internet nötig.

Anzeige für das Publikum:
  "Anzeige öffnen" klicken und Pop-ups erlauben, falls der Browser fragt.
  Chrome/Edge fragen beim ersten Mal, ob die Seite Fenster auf allen
  Bildschirmen verwalten darf. Mit "Zulassen" erscheint oben eine
  Bildschirmauswahl und die Anzeige landet automatisch auf dem Beamer.
  Ohne Erlaubnis das Fenster von Hand auf den Beamer ziehen.

  Im Anzeigefenster einmal klicken (sonst bleibt der Gong stumm) und
  doppelklicken für Vollbild.

Matten im Netz:
  Die Webversion kann keine Zentrale sein, sich aber als Matte mit einer
  Zentrale (macOS-App) verbinden: Einstellungen -> Matten im Netz -> Matte,
  Adresse der Zentrale und Turniercode eintragen.

Daten:
  Einstellungen, Kampfliste und Protokoll speichert der Browser, nicht der
  Ordner. Für einen anderen Rechner oder Browser unter "Einstellungen" eine
  Sicherung speichern und dort wieder laden.
`
);

console.log(`Webversion ${pkg.version}: ${path.relative(root, out)} (${files.length} Dateien)`);
