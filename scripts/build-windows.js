/*
 * Baut „Hajime für Windows“ nach dist/Hajime-<version>-Windows:
 *
 *   Hajime starten.cmd          Doppelklick: startet Hajime im eigenen Fenster (Edge)
 *   Anleitung (online).url      Benutzerhandbuch auf GitHub
 *   LIESMICH.txt
 *   programm/
 *     node.exe                  offizielle Node.js-Laufzeit (von der OpenJS Foundation signiert)
 *     hajime-windows.js         liefert Hajime aus, Zentrale, Suche, Firewall-Freigabe
 *     native.js, hub.js, version.json
 *     app/                      die Hajime-Seiten (wie in der Webversion)
 *
 * Keine eigene .exe – deshalb kein Fehlalarm wie bei einer unsignierten Programmdatei.
 *
 * Aufruf: node scripts/build-windows.js [--node <Pfad zu node.exe> --node-license <LICENSE von Node.js>]
 * Ohne --node entsteht der Ordner ohne node.exe (zum Prüfen; die CI lädt node.exe von nodejs.org).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const pkg = require(path.join(root, 'package.json'));
const out = path.join(root, 'dist', `Hajime-${pkg.version}-Windows`);
const prog = path.join(out, 'programm');
const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : '';
};
const nodeExe = arg('--node');
const nodeLicense = arg('--node-license');

// Webversion bauen und ihre Seiten übernehmen
execFileSync(process.execPath, [path.join(__dirname, 'build-web.js')], { stdio: 'inherit' });
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(prog, { recursive: true });
fs.cpSync(path.join(root, 'dist', 'Hajime-Web', 'app'), path.join(prog, 'app'), { recursive: true });
fs.rmSync(path.join(prog, 'app', 'sw.js'), { force: true });

fs.copyFileSync(path.join(root, 'windows', 'hajime-windows.js'), path.join(prog, 'hajime-windows.js'));
fs.copyFileSync(path.join(root, 'windows', 'native.js'), path.join(prog, 'native.js'));
fs.copyFileSync(path.join(root, 'hub.js'), path.join(prog, 'hub.js'));
fs.writeFileSync(path.join(prog, 'version.json'), JSON.stringify({ version: pkg.version }) + '\n');
if (nodeExe) fs.copyFileSync(nodeExe, path.join(prog, 'node.exe'));
else console.warn('Hinweis: ohne --node gebaut – programm/node.exe fehlt.');
// Node.js darf nur mit seinem Lizenztext weitergegeben werden
if (nodeLicense) fs.copyFileSync(nodeLicense, path.join(prog, 'node.exe-LIZENZ.txt'));
else if (nodeExe) throw new Error('--node-license fehlt (Lizenztext von Node.js)');
fs.copyFileSync(path.join(root, 'LICENSE'), path.join(prog, 'Hajime-LIZENZ.txt'));

// Windows-Dateien mit CRLF
const crlf = (s) => s.replace(/\r?\n/g, '\r\n');
fs.writeFileSync(path.join(out, 'Hajime starten.cmd'), crlf(fs.readFileSync(path.join(root, 'windows', 'Hajime starten.cmd'), 'utf8')));
fs.writeFileSync(path.join(out, 'Anleitung (online).url'), crlf('[InternetShortcut]\nURL=https://github.com/junky84/hajime/blob/main/docs/benutzerhandbuch.md\n'));
fs.writeFileSync(
  path.join(out, 'LIESMICH.txt'),
  '﻿' +
    crlf(`Hajime ${pkg.version} für Windows – Judo-Anzeigetafel ohne Installation

STARTEN
  Doppelklick auf "Hajime starten". Hajime öffnet sich in einem eigenen Fenster
  (Microsoft Edge). Zum Beenden das Fenster schließen.

  Wichtig: Die ZIP-Datei vorher entpacken (rechte Maustaste - "Alle extrahieren").
  Tipp: Vor dem Entpacken rechte Maustaste auf die ZIP-Datei - Eigenschaften -
  "Zulassen" anhaken - OK. Dann fragt Windows beim Start nicht nach.

ANLEITUNG
  "Anleitung (online)" öffnen oder:
  https://github.com/junky84/hajime/blob/main/docs/benutzerhandbuch.md

MATTEN IM NETZ
  Auf dem Rechner der Turnierleitung: Einstellungen - Matten im Netz - Zentrale.
  Beim ersten Mal "Für die Matten freigeben" klicken und bei Windows "Ja".
  Die Matten finden die Zentrale dann von selbst.

WAS IM ORDNER "programm" IST
  node.exe       Node.js (von der OpenJS Foundation signiert, MIT-Lizenz,
                 siehe node.exe-LIZENZ.txt)
  app            die Hajime-Seiten
  *.js           startet Hajime und verbindet die Matten
  Es wird nichts installiert. Die Daten speichert Edge auf diesem Rechner.

Hajime ist Open Source (MIT-Lizenz): https://github.com/junky84/hajime
`)
);

console.log(`Hajime für Windows ${pkg.version}: ${path.relative(root, out)}`);
