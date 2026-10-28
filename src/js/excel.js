/*
 * Excel-/CSV-Import und -Export (SheetJS, lokal eingebunden).
 * Erkennt Spalten über die Überschriften, z. B. "Weiß Name", "Blau Verein",
 * "Vorname", "Nachname", "Verein", "Gewichtsklasse", "Altersklasse".
 */
(function (root) {
  'use strict';

  function normHeader(h) {
    return String(h == null ? '' : h)
      .toLowerCase()
      .replace(/ß/g, 'ss')
      .replace(/ä/g, 'ae')
      .replace(/ö/g, 'oe')
      .replace(/ü/g, 'ue')
      .replace(/[^a-z0-9#]+/g, ' ')
      .trim();
  }

  function sideOf(h) {
    if (/\b(weiss|weis|white|kaempfer 1|kaempfer a|judoka 1|judoka a)\b/.test(h)) return 'white';
    if (/\b(blau|blue|kaempfer 2|kaempfer b|judoka 2|judoka b)\b/.test(h)) return 'blue';
    return null;
  }

  function fieldOf(h) {
    if (!h) return null;
    if (/\b(geschlecht|gender|sex|m w|m w d)\b/.test(h)) return 'gender';
    if (/^(matte|mat|tatami)( nr)?$/.test(h)) return 'mat';
    if (/^(ca|ca uhrzeit|uhrzeit|zeit|geplant|beginn)$/.test(h)) return 'at';
    if (/^(slot|paarung id|system platz)$/.test(h)) return 'slot';
    if (/^(runde|phase)$/.test(h)) return 'round';
    if (/\bvorname\b|\bfirst ?name\b|\bgiven\b/.test(h)) return 'first';
    if (/\bnachname\b|\bfamilienname\b|\blast ?name\b|\bsurname\b/.test(h)) return 'last';
    if (/\b(verein|club|klub|team|nation|land|mannschaft|ort)\b/.test(h)) return 'club';
    if (/alter|^ak$|\bak\b|\bage\b|jugend/.test(h)) return 'ageClass';
    if (/gewicht|\bgk\b|\bkg\b|weight|kategorie|category|\bklasse\b|gew kl/.test(h)) return 'category';
    if (/^(nr|nummer|no|#|kampf nr|kampfnr|kampf|bout|match)$/.test(h) || /\bkampf ?nr\b/.test(h)) return 'no';
    if (/\b(name|kaempfer|judoka|teilnehmer|athlet|sportler|starter)\b/.test(h)) return 'name';
    return null;
  }

  function mapHeader(row) {
    const cols = {};
    let hits = 0;
    row.forEach((cell, i) => {
      const h = normHeader(cell);
      if (!h) return;
      const side = sideOf(h);
      let field = fieldOf(h);
      if (side && (!field || field === 'name')) {
        // "Weiß" allein oder "Weiß Name"
        const rest = h.replace(/\b(weiss|weis|white|blau|blue|kaempfer|judoka|[12ab])\b/g, '').trim();
        field = fieldOf(rest) || 'name';
      }
      const key = (side ? side + '.' : '') + field;
      if (field && cols[key] == null) {
        cols[key] = i;
        hits++;
      }
    });
    return { cols, hits };
  }

  const cellStr = (v) => (v == null ? '' : String(v).trim());

  // m / w / d aus freiem Text (gleiche Regeln wie JudoCore.normGender)
  function genderOf(v) {
    const C = root.JudoCore;
    if (C && C.normGender) return C.normGender(v);
    const s = cellStr(v).toLowerCase();
    if (/^(w|weiblich|f|female|mädchen|damen|frauen)/.test(s)) return 'w';
    if (/^(m|männlich|male|jungen?|herren|männer)/.test(s)) return 'm';
    if (/^(d|divers|x)$/.test(s)) return 'd';
    return '';
  }

  function personFrom(row, cols, prefix) {
    const get = (k) => (cols[prefix + k] != null ? cellStr(row[cols[prefix + k]]) : '');
    let name = get('name');
    const first = get('first');
    const last = get('last');
    if (!name && (first || last)) name = [first, last].filter(Boolean).join(' ');
    return { name, club: get('club') };
  }

  // Platzhalter aus dem Mattenexport: „(Sieger VF 1)“
  function placeholder(p) {
    const m = p.name.match(/^\((.+)\)$/);
    return m ? m[1] : '';
  }

  function parseSheet(rows) {
    // Kopfzeile in den ersten 15 Zeilen suchen
    let best = null;
    for (let r = 0; r < Math.min(rows.length, 15); r++) {
      const m = mapHeader(rows[r] || []);
      const hasName = Object.keys(m.cols).some((k) => /(^|\.)(name|first|last)$/.test(k));
      if (hasName && (!best || m.hits > best.hits)) best = { ...m, row: r };
    }
    const result = { fights: [], participants: [] };
    if (!best) {
      // Keine Überschriften: Spalte A = Name, B = Verein
      rows.forEach((row) => {
        const name = cellStr(row && row[0]);
        if (name) result.participants.push({ name, club: cellStr(row[1]), ageClass: '', category: '' });
      });
      return result;
    }
    const c = best.cols;
    const has = (k) => c[k] != null;
    const isFights = (has('white.name') || has('white.first') || has('white.last')) && (has('blue.name') || has('blue.first') || has('blue.last'));
    const isPeople = has('name') || has('first') || has('last');
    for (let r = best.row + 1; r < rows.length; r++) {
      const row = rows[r] || [];
      const ageClass = has('ageClass') ? cellStr(row[c.ageClass]) : '';
      const category = has('category') ? cellStr(row[c.category]) : '';
      const gender = has('gender') ? genderOf(row[c.gender]) : '';
      if (isFights) {
        const white = personFrom(row, c, 'white.');
        const blue = personFrom(row, c, 'blue.');
        const slot = has('slot') ? cellStr(row[c.slot]) : '';
        if (!white.name && !blue.name && !slot) continue;
        const f = { no: has('no') ? cellStr(row[c.no]) : '', ageClass, category, white, blue };
        if (gender) f.gender = gender;
        if (has('mat') && cellStr(row[c.mat])) f.mat = cellStr(row[c.mat]);
        if (has('at') && cellStr(row[c.at])) f.at = cellStr(row[c.at]);
        if (slot) f.slot = slot;
        ['white', 'blue'].forEach((s) => {
          const from = placeholder(f[s]);
          if (from) {
            f[s] = { name: '', club: '' };
            f[s + 'From'] = from;
          }
        });
        result.fights.push(f);
      } else if (isPeople) {
        const p = personFrom(row, c, '');
        if (!p.name) continue;
        const x = { ...p, ageClass, category };
        if (gender) x.gender = gender;
        result.participants.push(x);
      }
    }
    return result;
  }

  /*
   * Blatt „Turniersystem“ aus dem Mattenexport: je Gruppe System und Setzliste.
   * Liefert [{ ageClass, category, gender, system (Text), players: [{ name, club }] }].
   */
  function parseSystems(rows) {
    const head = (rows[0] || []).map(normHeader);
    const col = (re) => head.findIndex((h) => re.test(h));
    const c = { age: col(/alter/), cat: col(/gewicht/), gender: col(/geschlecht/), sys: col(/^system$/), seed: col(/setz/), name: col(/^name$/), club: col(/verein/) };
    if (c.sys < 0 || c.name < 0) return [];
    const m = new Map();
    rows.slice(1).forEach((row) => {
      const name = cellStr(row[c.name]);
      if (!name) return;
      const g = {
        ageClass: c.age >= 0 ? cellStr(row[c.age]) : '',
        category: c.cat >= 0 ? cellStr(row[c.cat]) : '',
        gender: c.gender >= 0 ? genderOf(row[c.gender]) : '',
        system: cellStr(row[c.sys]),
      };
      const key = [g.ageClass, g.category, g.gender, g.system].join('\u0001');
      if (!m.has(key)) m.set(key, Object.assign(g, { players: [] }));
      m.get(key).players.push({ name, club: c.club >= 0 ? cellStr(row[c.club]) : '', seed: c.seed >= 0 ? Number(row[c.seed]) || 0 : 0 });
    });
    return Array.from(m.values()).map((g) => {
      g.players = g.players.sort((a, b) => a.seed - b.seed).map((p) => ({ name: p.name, club: p.club }));
      return g;
    });
  }

  async function importFile(file) {
    const XLSX = root.XLSX;
    if (!XLSX) throw new Error('Excel-Bibliothek nicht geladen');
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array', cellDates: false });
    const out = { fights: [], participants: [], brackets: [], sheets: [] };
    wb.SheetNames.forEach((name) => {
      const ws = wb.Sheets[name];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '', blankrows: false });
      if (!rows.length) return;
      if (/hinweis|anleitung|info/i.test(name)) return;
      if (/turniersystem/i.test(name)) {
        const bs = parseSystems(rows);
        if (bs.length) {
          out.brackets.push(...bs);
          out.sheets.push(`${name}: ${bs.length} Gruppen`);
        }
        return;
      }
      const r = parseSheet(rows);
      if (r.fights.length || r.participants.length) {
        out.sheets.push(`${name}: ${r.fights.length ? r.fights.length + ' Kämpfe' : r.participants.length + ' Teilnehmer'}`);
        out.fights.push(...r.fights);
        out.participants.push(...r.participants);
      }
    });
    return out;
  }

  function sheetFrom(aoa, widths) {
    const ws = root.XLSX.utils.aoa_to_sheet(aoa);
    if (widths) ws['!cols'] = widths.map((w) => ({ wch: w }));
    return ws;
  }

  function templateBytes() {
    const XLSX = root.XLSX;
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      sheetFrom(
        [
          ['Nr', 'Altersklasse', 'Geschlecht', 'Gewichtsklasse', 'Weiß Name', 'Weiß Verein', 'Blau Name', 'Blau Verein'],
          ['1', 'U13', 'm', '-34 kg', 'Max Mustermann', 'JC Musterstadt', 'Erik Beispiel', 'TSV Beispielhausen'],
          ['2', 'U13', 'w', '-34 kg', 'Lena Muster', 'JC Musterstadt', 'Sophie Probe', 'SV Probedorf'],
        ],
        [5, 13, 11, 15, 24, 24, 24, 24]
      ),
      'Kampfliste'
    );
    XLSX.utils.book_append_sheet(
      wb,
      sheetFrom(
        [
          ['Vorname', 'Nachname', 'Verein', 'Altersklasse', 'Geschlecht', 'Gewichtsklasse'],
          ['Max', 'Mustermann', 'JC Musterstadt', 'U13', 'm', '-34 kg'],
          ['Erik', 'Beispiel', 'TSV Beispielhausen', 'U13', 'm', '-34 kg'],
          ['Jonas', 'Probe', 'SV Probedorf', 'U13', 'm', '-34 kg'],
        ],
        [16, 18, 24, 13, 11, 15]
      ),
      'Teilnehmer'
    );
    XLSX.utils.book_append_sheet(
      wb,
      sheetFrom(
        [
          ['Hinweise zum Import'],
          [''],
          ['Blatt "Kampfliste": fertige Paarungen (Weiß gegen Blau) in Kampfreihenfolge.'],
          ['Blatt "Teilnehmer": nur Namen – Paarungen können in der App erzeugt werden (Jeder gegen jeden).'],
          ['Es reicht, eines der beiden Blätter auszufüllen. Beispielzeilen bitte löschen.'],
          ['Statt Vorname/Nachname geht auch eine Spalte "Name". Verein, Alters- und Gewichtsklasse sind optional.'],
          ['Die Altersklasse (z. B. U11, U13) wählt automatisch das passende Regelprofil (Kampfzeit usw.).'],
          ['Geschlecht (m / w / d) ist optional. Mit der Einstellung „Nach Geschlecht trennen“ bildet Hajime getrennte Gruppen.'],
          ['CSV-Dateien mit denselben Spaltenüberschriften werden ebenfalls erkannt.'],
        ],
        [110]
      ),
      'Hinweise'
    );
    return XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  }

  // Gruppentabellen als Zeilen (für Protokoll-Export)
  function tableRows(tables) {
    const rows = [];
    (tables || []).forEach((t) =>
      t.rows.forEach((r) =>
        rows.push([
          t.ageClass,
          t.gender || '',
          t.category,
          r.place,
          r.name,
          r.club,
          r.fights,
          r.wins,
          r.losses,
          r.draws,
          r.points,
          r.ippon,
          r.wazaari,
          r.yuko,
          r.tie ? 'Stichkampf nötig' : t.complete ? '' : `vorläufig (${t.done}/${t.total})`,
        ])
      )
    );
    return rows;
  }
  const TABLE_HEAD = ['Altersklasse', 'Geschlecht', 'Gewichtsklasse', 'Platz', 'Name', 'Verein', 'Kämpfe', 'Siege', 'Niederlagen', 'Unentschieden', 'Wertungspunkte', 'Ippon', 'Waza-ari', 'Yuko', 'Hinweis'];
  const TABLE_WIDTHS = [12, 10, 14, 6, 24, 22, 7, 6, 11, 13, 14, 6, 9, 6, 20];
  // Blatt „Gruppentabellen“; Spalte Yuko nur, wenn eine Klasse Yuko verwendet
  function tableAoa(tables) {
    const rows = tableRows(tables);
    const yuko = (tables || []).some((t) => t.yuko !== false);
    const iy = TABLE_HEAD.indexOf('Yuko');
    const cut = (r) => (yuko ? r : r.filter((_, i) => i !== iy));
    return { aoa: [cut(TABLE_HEAD)].concat(rows.map(cut)), widths: cut(TABLE_WIDTHS), rows: rows.length };
  }

  function protocolBytes(log, tables) {
    const XLSX = root.XLSX;
    const head = ['Nr', 'Uhrzeit', 'Matte', 'Altersklasse', 'Geschlecht', 'Gewichtsklasse', 'Weiß', 'Verein Weiß', 'Wertung Weiß', 'Blau', 'Verein Blau', 'Wertung Blau', 'Sieger', 'Entscheidung', 'Kampfzeit'];
    const rows = log.map((l) => [l.no, l.time, l.mat, l.ageClass, l.gender || '', l.category, l.white.name, l.white.club, l.whiteScore, l.blue.name, l.blue.club, l.blueScore, l.winnerName, l.reason, l.duration]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheetFrom([head].concat(rows), [5, 9, 10, 12, 10, 14, 24, 22, 16, 24, 22, 16, 24, 26, 10]), 'Protokoll');
    // Ereignisprotokoll: jede Aktion mit Uhrzeit und Kampfzeit
    const two = (n) => String(n).padStart(2, '0');
    const clock = (ts) => {
      const d = new Date(ts);
      return `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;
    };
    const evHead = ['Nr', 'Altersklasse', 'Gewichtsklasse', 'Weiß', 'Blau', 'Uhrzeit', 'Kampfzeit', 'Ereignis'];
    const evRows = [];
    log.forEach((l) =>
      (l.events || []).forEach((e) => evRows.push([l.no, l.ageClass, l.category, l.white.name, l.blue.name, clock(e.at), e.clock, e.text]))
    );
    if (evRows.length) XLSX.utils.book_append_sheet(wb, sheetFrom([evHead].concat(evRows), [5, 12, 14, 24, 24, 10, 11, 60]), 'Ereignisse');
    const tt = tableAoa(tables);
    if (tt.rows) XLSX.utils.book_append_sheet(wb, sheetFrom(tt.aoa, tt.widths), 'Gruppentabellen');
    return XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  }

  // Siegerliste: Platzierte je Gruppe, dazu die vollständigen Gruppentabellen
  function winnersBytes(tables, places, awardRows) {
    const XLSX = root.XLSX;
    const rows = [];
    tables.forEach((t) =>
      awardRows(t, places).forEach((r) =>
        rows.push([t.ageClass, t.gender || '', t.category, r.place, r.name, r.club, r.tie ? 'Stichkampf nötig' : t.complete ? '' : `vorläufig (${t.done}/${t.total})`])
      )
    );
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheetFrom([['Altersklasse', 'Geschlecht', 'Gewichtsklasse', 'Platz', 'Name', 'Verein', 'Hinweis']].concat(rows), [12, 10, 14, 6, 26, 24, 20]), 'Siegerliste');
    const tt = tableAoa(tables);
    XLSX.utils.book_append_sheet(wb, sheetFrom(tt.aoa, tt.widths), 'Gruppentabellen');
    return XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  }

  /*
   * Kampfliste einer Matte (Matte-1.xlsx …) im Import-Format, dazu das Blatt
   * „Turniersystem“, damit der Mattenrechner Sieger automatisch weiterrücken lässt.
   * entries: Kämpfe dieser Matte in Reihenfolge; brackets: Turniersysteme ihrer Gruppen.
   */
  function matBytes(opts) {
    const XLSX = root.XLSX;
    const ph = (p, from) => (p && p.name ? p.name : from ? `(${from})` : '');
    const head = ['Nr', 'Matte', 'ca.', 'Altersklasse', 'Geschlecht', 'Gewichtsklasse', 'Runde', 'Weiß Name', 'Weiß Verein', 'Blau Name', 'Blau Verein', 'Slot'];
    const rows = opts.entries.map((e, i) => [
      e.no || String(i + 1),
      opts.mat,
      e.at || '',
      e.ageClass || '',
      e.gender || '',
      e.category || '',
      e.round || '',
      ph(e.white, e.whiteFrom),
      (e.white && e.white.club) || '',
      ph(e.blue, e.blueFrom),
      (e.blue && e.blue.club) || '',
      e.slot || '',
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheetFrom([head].concat(rows), [5, 9, 7, 12, 10, 14, 22, 24, 22, 24, 22, 6]), 'Kampfliste');
    const sys = [['Altersklasse', 'Geschlecht', 'Gewichtsklasse', 'System', 'Setzplatz', 'Name', 'Verein']];
    (opts.brackets || []).forEach((b) => b.players.forEach((p, i) => sys.push([b.ageClass, b.gender || '', b.category, opts.systemLabel(b.system), i + 1, p.name, p.club || ''])));
    if (sys.length > 1) XLSX.utils.book_append_sheet(wb, sheetFrom(sys, [12, 10, 14, 22, 9, 24, 22]), 'Turniersystem');
    XLSX.utils.book_append_sheet(
      wb,
      sheetFrom(
        [
          [`Kampfliste ${opts.mat}${opts.tournament ? ' – ' + opts.tournament : ''}`],
          [''],
          ['Diese Datei am Rechner der Matte in Hajime importieren (Kampfliste → Excel / CSV importieren).'],
          ['Die Matte wird dabei automatisch eingestellt.'],
          ['Namen in Klammern, z. B. „(Sieger VF 1)“, sind Platzhalter – Hajime trägt die Kämpfer ein, sobald sie feststehen.'],
          ['Blatt „Turniersystem“ bitte nicht ändern: daraus berechnet Hajime, wer weiterkommt.'],
        ],
        [110]
      ),
      'Hinweise'
    );
    return XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  }

  root.JudoExcel = { importFile, templateBytes, protocolBytes, winnersBytes, matBytes, _parseSheet: parseSheet };
})(typeof self !== 'undefined' ? self : this);
