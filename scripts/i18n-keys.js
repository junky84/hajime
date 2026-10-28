/*
 * Sammelt alle übersetzbaren Texte (deutsche Schlüssel) aus Programm und HTML-Seiten.
 *
 *   node scripts/i18n-keys.js            → fehlende Einträge in src/lang/en.js
 *   node scripts/i18n-keys.js fr         → fehlende Einträge in src/lang/fr.js
 *   node scripts/i18n-keys.js --all      → alle Schlüssel (z. B. als Grundlage für eine neue Sprache)
 *
 * Gefunden werden t('…'), tx('…'), tm('…'), tr('…'), N_('…') (auch beide Seiten von
 * t(a ? '…' : '…')), Texte und title/placeholder in control.html und board.html sowie
 * Daten, die erst bei der Anzeige übersetzt werden (Systeme, Profile, Vorlagen …).
 */
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const SRC = path.join(root, 'src');

// Begriffe, die in allen Sprachen gleich bleiben (Judo-Begriffe, Abkürzungen, Zeichen)
const SAME = /^(Hajime|Mate|Osaekomi|Toketa|Ippon|Waza-ari|Yuko|Shido|Hansoku-make|Golden Score|Hantei|Kiken-gachi|Fusen-gachi|Waza-ari-awasete-ippon|HAJIME|SOREMADE|GOLDEN SCORE|OSAEKOMI|TOKETA|IPPON|WAZA-ARI|YUKO|SHIDO|HSK|Judo|IJF|DJB|Pool|Slot|System|Best of Three|Osaekomi Weiß|Osaekomi Blau|Q|W|E|R|U|I|O|P|A|L|T|N|B|G|K|S|Y|GS|−|\+|[\d\s:.,–\-+−×·/()%↶▸◂←→↑↓✕✓⚠●○]*|.*\$\{.*)$/;

// keine Texte, sondern Vergleichswerte oder Kürzel, die zufällig mitgefunden werden
const NOT_KEYS = /^(ijf|custom|djb|white|blue|draw|d|m|w|U\d+(, U\d+)*|Shift\+\w|deutscher Text|Masters)$/;

function scanCalls(code) {
  const keys = new Set();
  const names = /(?:^|[^\w$.])(t|tx|tm|tr|N_|tr\(opts\))\(/g;
  let m;
  while ((m = names.exec(code))) {
    let i = m.index + m[0].length;
    let depth = 0;
    let first = true;
    // erstes Argument bis zum Komma auf oberster Ebene: alle Zeichenketten darin
    while (i < code.length) {
      const c = code[i];
      if (c === "'" || c === '"' || c === '`') {
        let j = i + 1;
        let str = '';
        while (j < code.length && code[j] !== c) {
          if (code[j] === '\\') {
            const n = code[j + 1];
            str += n === 'n' ? '\n' : n;
            j += 2;
          } else {
            str += code[j];
            j++;
          }
        }
        if (first && depth === 0 && !(c === '`' && str.includes('${'))) keys.add(str);
        i = j + 1;
        continue;
      }
      if (c === '(' || c === '[' || c === '{') depth++;
      else if (c === ')' || c === ']' || c === '}') {
        if (depth === 0) break;
        depth--;
      } else if (c === ',' && depth === 0) first = false;
      i++;
    }
  }
  return keys;
}

function scanHtml(html) {
  const keys = new Set();
  html = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<!--[\s\S]*?-->/g, '');
  const text = />([^<]+)</g;
  let m;
  while ((m = text.exec(html))) {
    const v = m[1].replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim();
    if (/[A-Za-zÄÖÜäöüß]/.test(v)) keys.add(v);
  }
  const attr = /\s(?:title|placeholder|aria-label)="([^"]*)"/g;
  while ((m = attr.exec(html))) if (/[A-Za-zÄÖÜäöüß]/.test(m[1])) keys.add(m[1].replace(/&amp;/g, '&'));
  return keys;
}

// Daten, die erst bei der Anzeige übersetzt werden
function dataKeys() {
  global.self = global;
  const C = require(path.join(SRC, 'js/core.js'));
  global.JudoCore = C;
  const B = require(path.join(SRC, 'js/brackets.js'));
  const TR = require(path.join(SRC, 'js/training.js'));
  const TM = require(path.join(SRC, 'js/team.js'));
  require(path.join(SRC, 'js/i18n.js'));
  const keys = new Set();
  Object.values(B.SYSTEMS).forEach((v) => keys.add(v));
  Object.values(C.GENDER_LABEL).forEach((v) => keys.add(v));
  C.DEFAULT_PROFILES.forEach((p) => keys.add(p.name));
  TR.DEFAULT_TEMPLATES.forEach((x) => [x.name, x.roundNote, x.pauseNote].filter(Boolean).forEach((v) => keys.add(v)));
  globalThis.HajimeI18n.PHRASES.forEach((v) => keys.add(v));
  [TM.FORFEIT_REASON, 'Entscheidung', 'weniger Shido', 'Unentschieden', 'läuft', 'geladen', 'Hinrunde', 'Rückrunde', 'eigene Paarungen'].forEach((v) => keys.add(v));
  return keys;
}

function allKeys() {
  const keys = new Set();
  const add = (set) => set.forEach((k) => k && !SAME.test(k.trim()) && !NOT_KEYS.test(k.trim()) && keys.add(k));
  const jsFiles = fs
    .readdirSync(path.join(SRC, 'js'))
    .filter((f) => f.endsWith('.js'))
    .map((f) => path.join(SRC, 'js', f))
    .concat(path.join(root, 'main.js'));
  jsFiles.forEach((f) => add(scanCalls(fs.readFileSync(f, 'utf8'))));
  ['control.html', 'board.html'].forEach((f) => add(scanHtml(fs.readFileSync(path.join(SRC, f), 'utf8'))));
  add(dataKeys());
  return Array.from(keys).sort((a, b) => a.localeCompare(b, 'de'));
}

function langDict(lang) {
  const file = path.join(SRC, 'lang', lang + '.js');
  let dict = {};
  const g = globalThis;
  const prev = g.HajimeI18n;
  g.HajimeI18n = { register: (_l, _n, d) => (dict = d) };
  try {
    delete require.cache[require.resolve(file)];
    require(file);
  } finally {
    g.HajimeI18n = prev;
  }
  return dict;
}

function missing(lang) {
  const dict = langDict(lang);
  return allKeys().filter((k) => !dict[k]);
}
function unused(lang) {
  const all = new Set(allKeys());
  return Object.keys(langDict(lang)).filter((k) => !all.has(k));
}

module.exports = { allKeys, missing, unused, langDict, SAME };

if (require.main === module) {
  const arg = process.argv[2] || 'en';
  if (arg === '--all') console.log(JSON.stringify(allKeys(), null, 1));
  else {
    const miss = missing(arg);
    console.log(JSON.stringify(miss, null, 1));
    console.error(`${miss.length} fehlende Einträge in src/lang/${arg}.js, ${unused(arg).length} nicht mehr verwendete`);
  }
}
