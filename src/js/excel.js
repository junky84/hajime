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

  function personFrom(row, cols, prefix) {
    const get = (k) => (cols[prefix + k] != null ? cellStr(row[cols[prefix + k]]) : '');
    let name = get('name');
    const first = get('first');
    const last = get('last');
    if (!name && (first || last)) name = [first, last].filter(Boolean).join(' ');
    return { name, club: get('club') };
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
      if (isFights) {
        const white = personFrom(row, c, 'white.');
        const blue = personFrom(row, c, 'blue.');
        if (!white.name && !blue.name) continue;
        result.fights.push({ no: has('no') ? cellStr(row[c.no]) : '', ageClass, category, white, blue });
      } else if (isPeople) {
        const p = personFrom(row, c, '');
        if (!p.name) continue;
        result.participants.push({ ...p, ageClass, category });
      }
    }
    return result;
  }

  async function importFile(file) {
    const XLSX = root.XLSX;
    if (!XLSX) throw new Error('Excel-Bibliothek nicht geladen');
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array', cellDates: false });
    const out = { fights: [], participants: [], sheets: [] };
    wb.SheetNames.forEach((name) => {
      const ws = wb.Sheets[name];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '', blankrows: false });
      if (!rows.length) return;
      if (/hinweis|anleitung|info/i.test(name)) return;
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
          ['Nr', 'Altersklasse', 'Gewichtsklasse', 'Weiß Name', 'Weiß Verein', 'Blau Name', 'Blau Verein'],
          ['1', 'U13', '-34 kg', 'Max Mustermann', 'JC Musterstadt', 'Erik Beispiel', 'TSV Beispielhausen'],
          ['2', 'U13', '-34 kg', 'Lena Muster', 'JC Musterstadt', 'Sophie Probe', 'SV Probedorf'],
        ],
        [5, 13, 15, 24, 24, 24, 24]
      ),
      'Kampfliste'
    );
    XLSX.utils.book_append_sheet(
      wb,
      sheetFrom(
        [
          ['Vorname', 'Nachname', 'Verein', 'Altersklasse', 'Gewichtsklasse'],
          ['Max', 'Mustermann', 'JC Musterstadt', 'U13', '-34 kg'],
          ['Erik', 'Beispiel', 'TSV Beispielhausen', 'U13', '-34 kg'],
          ['Jonas', 'Probe', 'SV Probedorf', 'U13', '-34 kg'],
        ],
        [16, 18, 24, 13, 15]
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
  const TABLE_HEAD = ['Altersklasse', 'Gewichtsklasse', 'Platz', 'Name', 'Verein', 'Kämpfe', 'Siege', 'Niederlagen', 'Unentschieden', 'Wertungspunkte', 'Ippon', 'Waza-ari', 'Yuko', 'Hinweis'];
  const TABLE_WIDTHS = [12, 14, 6, 24, 22, 7, 6, 11, 13, 14, 6, 9, 6, 20];

  function protocolBytes(log, tables) {
    const XLSX = root.XLSX;
    const head = ['Nr', 'Uhrzeit', 'Matte', 'Altersklasse', 'Gewichtsklasse', 'Weiß', 'Verein Weiß', 'Wertung Weiß', 'Blau', 'Verein Blau', 'Wertung Blau', 'Sieger', 'Entscheidung', 'Kampfzeit'];
    const rows = log.map((l) => [l.no, l.time, l.mat, l.ageClass, l.category, l.white.name, l.white.club, l.whiteScore, l.blue.name, l.blue.club, l.blueScore, l.winnerName, l.reason, l.duration]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheetFrom([head].concat(rows), [5, 9, 10, 12, 14, 24, 22, 16, 24, 22, 16, 24, 26, 10]), 'Protokoll');
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
    const tRows = tableRows(tables);
    if (tRows.length) XLSX.utils.book_append_sheet(wb, sheetFrom([TABLE_HEAD].concat(tRows), TABLE_WIDTHS), 'Gruppentabellen');
    return XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  }

  // Siegerliste: Platzierte je Gruppe, dazu die vollständigen Gruppentabellen
  function winnersBytes(tables, places, awardRows) {
    const XLSX = root.XLSX;
    const rows = [];
    tables.forEach((t) =>
      awardRows(t, places).forEach((r) =>
        rows.push([t.ageClass, t.category, r.place, r.name, r.club, r.tie ? 'Stichkampf nötig' : t.complete ? '' : `vorläufig (${t.done}/${t.total})`])
      )
    );
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheetFrom([['Altersklasse', 'Gewichtsklasse', 'Platz', 'Name', 'Verein', 'Hinweis']].concat(rows), [12, 14, 6, 26, 24, 20]), 'Siegerliste');
    XLSX.utils.book_append_sheet(wb, sheetFrom([TABLE_HEAD].concat(tableRows(tables)), TABLE_WIDTHS), 'Gruppentabellen');
    return XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  }

  root.JudoExcel = { importFile, templateBytes, protocolBytes, winnersBytes, _parseSheet: parseSheet };
})(typeof self !== 'undefined' ? self : this);
