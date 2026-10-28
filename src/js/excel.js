/*
 * Excel-/CSV-Import und -Export (SheetJS, lokal eingebunden).
 * Erkennt Spalten über die Überschriften, z. B. "Weiß Name", "Blau Verein",
 * "Vorname", "Nachname", "Verein", "Gewichtsklasse", "Altersklasse".
 */
(function (root) {
  'use strict';

  // Übersetzung der Spaltenköpfe (t aus i18n.js); ohne: Deutsch
  const idT = (s, p) => (p ? String(s).replace(/\{(\w+)\}/g, (m, k) => (p[k] == null ? m : p[k])) : s);
  idT.phrase = (s) => s || '';

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
    if (/^(matte|mat|tatami)( nr| no)?$/.test(h)) return 'mat';
    if (/^(ca|ca uhrzeit|uhrzeit|zeit|geplant|beginn|approx|time|start|planned)$/.test(h)) return 'at';
    if (/^(slot|paarung id|system platz|pairing id)$/.test(h)) return 'slot';
    if (/^(runde|phase|round|leg)$/.test(h)) return 'round';
    if (/\bvorname\b|\bfirst ?name\b|\bgiven\b/.test(h)) return 'first';
    if (/\bnachname\b|\bfamilienname\b|\blast ?name\b|\bsurname\b/.test(h)) return 'last';
    if (/\b(verein|club|klub|team|nation|land|mannschaft|ort)\b/.test(h)) return 'club';
    if (/alter|^ak$|\bak\b|\bage\b|jugend/.test(h)) return 'ageClass';
    if (/gewicht|\bgk\b|\bkg\b|weight|kategorie|category|\bklasse\b|gew kl/.test(h)) return 'category';
    if (/^(nr|nummer|no|#|kampf nr|kampfnr|kampf|bout|match|contest|contest no|number)$/.test(h) || /\bkampf ?nr\b/.test(h)) return 'no';
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
        if (has('round') && cellStr(row[c.round])) f.round = cellStr(row[c.round]);
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
    const c = { age: col(/alter|\bage\b/), cat: col(/gewicht|weight/), gender: col(/geschlecht|gender/), sys: col(/^system$/), seed: col(/setz|seed/), name: col(/^name$/), club: col(/verein|club/) };
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

  async function importFile(file, t) {
    t = t || idT;
    const XLSX = root.XLSX;
    if (!XLSX) throw new Error(t('Excel-Bibliothek nicht geladen'));
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array', cellDates: false });
    const out = { fights: [], participants: [], brackets: [], sheets: [] };
    wb.SheetNames.forEach((name) => {
      const ws = wb.Sheets[name];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '', blankrows: false });
      if (!rows.length) return;
      if (/hinweis|anleitung|info|notes|instructions/i.test(name)) return;
      if (/turniersystem|tournament ?system/i.test(name)) {
        const bs = parseSystems(rows);
        if (bs.length) {
          out.brackets.push(...bs);
          out.sheets.push(`${name}: ${t('{n} Gruppen', { n: bs.length })}`);
        }
        return;
      }
      const r = parseSheet(rows);
      if (r.fights.length || r.participants.length) {
        out.sheets.push(`${name}: ${r.fights.length ? t('{n} Kämpfe', { n: r.fights.length }) : t('{n} Teilnehmer', { n: r.participants.length })}`);
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

  function templateBytes(t) {
    t = t || idT;
    const XLSX = root.XLSX;
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      sheetFrom(
        [
          [t('Nr'), t('Altersklasse'), t('Geschlecht'), t('Gewichtsklasse'), t('Weiß Name'), t('Weiß Verein'), t('Blau Name'), t('Blau Verein')],
          ['1', 'U13', 'm', '-34 kg', 'Max Mustermann', 'JC Musterstadt', 'Erik Beispiel', 'TSV Beispielhausen'],
          ['2', 'U13', 'w', '-34 kg', 'Lena Muster', 'JC Musterstadt', 'Sophie Probe', 'SV Probedorf'],
        ],
        [5, 13, 11, 15, 24, 24, 24, 24]
      ),
      t('Kampfliste')
    );
    XLSX.utils.book_append_sheet(
      wb,
      sheetFrom(
        [
          [t('Vorname'), t('Nachname'), t('Verein'), t('Altersklasse'), t('Geschlecht'), t('Gewichtsklasse')],
          ['Max', 'Mustermann', 'JC Musterstadt', 'U13', 'm', '-34 kg'],
          ['Erik', 'Beispiel', 'TSV Beispielhausen', 'U13', 'm', '-34 kg'],
          ['Jonas', 'Probe', 'SV Probedorf', 'U13', 'm', '-34 kg'],
        ],
        [16, 18, 24, 13, 11, 15]
      ),
      t('Teilnehmer')
    );
    XLSX.utils.book_append_sheet(
      wb,
      sheetFrom(
        [
          [t('Hinweise zum Import')],
          [''],
          [t('Blatt "Kampfliste": fertige Paarungen (Weiß gegen Blau) in Kampfreihenfolge.')],
          [t('Blatt "Teilnehmer": nur Namen – Paarungen können in der App erzeugt werden (Jeder gegen jeden).')],
          [t('Es reicht, eines der beiden Blätter auszufüllen. Beispielzeilen bitte löschen.')],
          [t('Statt Vorname/Nachname geht auch eine Spalte "Name". Verein, Alters- und Gewichtsklasse sind optional.')],
          [t('Die Altersklasse (z. B. U11, U13) wählt automatisch das passende Regelprofil (Kampfzeit usw.).')],
          [t('Geschlecht (m / w / d) ist optional. Mit der Einstellung „Nach Geschlecht trennen“ bildet Hajime getrennte Gruppen.')],
          [t('CSV-Dateien mit denselben Spaltenüberschriften werden ebenfalls erkannt.')],
        ],
        [110]
      ),
      t('Hinweise')
    );
    return XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  }

  // Gruppentabellen als Zeilen (für Protokoll-Export)
  function tableRows(tables, t) {
    t = t || idT;
    const rows = [];
    (tables || []).forEach((g) =>
      g.rows.forEach((r) =>
        rows.push([
          g.ageClass,
          g.gender || '',
          g.category,
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
          r.tie ? t('Stichkampf nötig') : g.complete ? '' : t('vorläufig ({n}/{m})', { n: g.done, m: g.total }),
        ])
      )
    );
    return rows;
  }
  const TABLE_HEAD = ['Altersklasse', 'Geschlecht', 'Gewichtsklasse', 'Platz', 'Name', 'Verein', 'Kämpfe', 'Siege', 'Niederlagen', 'Unentschieden', 'Wertungspunkte', 'Ippon', 'Waza-ari', 'Yuko', 'Hinweis'];
  const TABLE_WIDTHS = [12, 10, 14, 6, 24, 22, 7, 6, 11, 13, 14, 6, 9, 6, 20];
  // Blatt „Gruppentabellen“; Spalte Yuko nur, wenn eine Klasse Yuko verwendet
  function tableAoa(tables, t) {
    t = t || idT;
    const rows = tableRows(tables, t);
    const yuko = (tables || []).some((g) => g.yuko !== false);
    const iy = TABLE_HEAD.indexOf('Yuko');
    const cut = (r) => (yuko ? r : r.filter((_, i) => i !== iy));
    return { aoa: [cut(TABLE_HEAD.map((h) => t(h)))].concat(rows.map(cut)), widths: cut(TABLE_WIDTHS), rows: rows.length };
  }

  function protocolBytes(log, tables, t) {
    t = t || idT;
    const XLSX = root.XLSX;
    // Wertungen je Seite in eigenen Spalten (Yuko nur, wenn damit gekämpft wurde)
    const C = root.JudoCore;
    const yuko = C.logUsesYuko(log);
    const kinds = [['ippon', 'Ippon', 6], ['wazaari', 'Waza-ari', 9]].concat(yuko ? [['yuko', 'Yuko', 6]] : [], [['shido', 'Shido', 6]]);
    const sideHead = (lbl) => [lbl, t('Verein {side}', { side: lbl })].concat(kinds.map((k) => lbl + ' ' + k[1]));
    const sideCols = (l, side) => {
      const sc = C.logScores(l, side);
      return [l[side].name, l[side].club].concat(kinds.map((k) => sc[k[0]] || 0));
    };
    const head = [t('Nr'), t('Uhrzeit'), t('Matte'), t('Altersklasse'), t('Geschlecht'), t('Gewichtsklasse')].concat(sideHead(t('Weiß')), sideHead(t('Blau')), [t('Sieger'), t('Entscheidung'), t('Kampfzeit')]);
    const rows = log.map((l) =>
      [l.no, l.time, idOr(t, l.mat), l.ageClass, l.gender || '', l.category].concat(sideCols(l, 'white'), sideCols(l, 'blue'), [
        l.winner === 'draw' ? t('Unentschieden') : l.winnerName,
        C.reasonText ? C.reasonText(l.reason, t) : l.reason,
        l.duration,
      ])
    );
    const sideW = [24, 22].concat(kinds.map((k) => k[2]));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheetFrom([head].concat(rows), [5, 9, 10, 12, 10, 14].concat(sideW, sideW, [24, 26, 10])), t('Protokoll'));
    // Ereignisprotokoll: jede Aktion mit Uhrzeit und Kampfzeit
    const two = (n) => String(n).padStart(2, '0');
    const clock = (ts) => {
      const d = new Date(ts);
      return `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;
    };
    const evHead = [t('Nr'), t('Altersklasse'), t('Gewichtsklasse'), t('Weiß'), t('Blau'), t('Uhrzeit'), t('Kampfzeit'), t('Ereignis')];
    const evRows = [];
    log.forEach((l) =>
      (l.events || []).forEach((e) => evRows.push([l.no, l.ageClass, l.category, l.white.name, l.blue.name, clock(e.at), e.clock, e.text]))
    );
    if (evRows.length) XLSX.utils.book_append_sheet(wb, sheetFrom([evHead].concat(evRows), [5, 12, 14, 24, 24, 10, 11, 60]), t('Ereignisse'));
    const tt = tableAoa(tables, t);
    if (tt.rows) XLSX.utils.book_append_sheet(wb, sheetFrom(tt.aoa, tt.widths), t('Gruppentabellen'));
    return XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  }
  // Matten-Namen („Matte 2“) in der Sprache der Ausgabe
  const idOr = (t, v) => (t && t.phrase ? t.phrase(v || '') : v || '');

  // Siegerliste: Platzierte je Gruppe, dazu die vollständigen Gruppentabellen
  function winnersBytes(tables, places, awardRows, t) {
    t = t || idT;
    const XLSX = root.XLSX;
    const rows = [];
    tables.forEach((g) =>
      awardRows(g, places).forEach((r) =>
        rows.push([g.ageClass, g.gender || '', g.category, r.place, r.name, r.club, r.tie ? t('Stichkampf nötig') : g.complete ? '' : t('vorläufig ({n}/{m})', { n: g.done, m: g.total })])
      )
    );
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      sheetFrom([[t('Altersklasse'), t('Geschlecht'), t('Gewichtsklasse'), t('Platz'), t('Name'), t('Verein'), t('Hinweis')]].concat(rows), [12, 10, 14, 6, 26, 24, 20]),
      t('Siegerliste')
    );
    const tt = tableAoa(tables, t);
    XLSX.utils.book_append_sheet(wb, sheetFrom(tt.aoa, tt.widths), t('Gruppentabellen'));
    return XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  }

  /*
   * Kampfliste einer Matte (Matte-1.xlsx …) im Import-Format, dazu das Blatt
   * „Turniersystem“, damit der Mattenrechner Sieger automatisch weiterrücken lässt.
   * entries: Kämpfe dieser Matte in Reihenfolge; brackets: Turniersysteme ihrer Gruppen.
   */
  function matBytes(opts) {
    const t = opts.t || idT;
    const XLSX = root.XLSX;
    const ph = (p, from) => (p && p.name ? p.name : from ? `(${t.phrase(from)})` : '');
    const head = [t('Nr'), t('Matte'), t('ca.'), t('Altersklasse'), t('Geschlecht'), t('Gewichtsklasse'), t('Runde'), t('Weiß Name'), t('Weiß Verein'), t('Blau Name'), t('Blau Verein'), 'Slot'];
    const rows = opts.entries.map((e, i) => [
      e.no || String(i + 1),
      t.phrase(opts.mat),
      e.at || '',
      e.ageClass || '',
      e.gender || '',
      e.category || '',
      t.phrase(e.round || ''),
      ph(e.white, e.whiteFrom),
      (e.white && e.white.club) || '',
      ph(e.blue, e.blueFrom),
      (e.blue && e.blue.club) || '',
      e.slot || '',
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheetFrom([head].concat(rows), [5, 9, 7, 12, 10, 14, 22, 24, 22, 24, 22, 6]), t('Kampfliste'));
    const sys = [[t('Altersklasse'), t('Geschlecht'), t('Gewichtsklasse'), t('System'), t('Setzplatz'), t('Name'), t('Verein')]];
    (opts.brackets || []).forEach((b) => b.players.forEach((p, i) => sys.push([b.ageClass, b.gender || '', b.category, opts.systemLabel(b.system), i + 1, p.name, p.club || ''])));
    if (sys.length > 1) XLSX.utils.book_append_sheet(wb, sheetFrom(sys, [12, 10, 14, 22, 9, 24, 22]), t('Turniersystem'));
    XLSX.utils.book_append_sheet(
      wb,
      sheetFrom(
        [
          [`${t('Kampfliste')} ${t.phrase(opts.mat)}${opts.tournament ? ' – ' + opts.tournament : ''}`],
          [''],
          [t('Diese Datei am Rechner der Matte in Hajime importieren (Kampfliste → Excel / CSV importieren).')],
          [t('Die Matte wird dabei automatisch eingestellt.')],
          [t('Namen in Klammern, z. B. „(Sieger VF 1)“, sind Platzhalter – Hajime trägt die Kämpfer ein, sobald sie feststehen.')],
          [t('Blatt „Turniersystem“ bitte nicht ändern: daraus berechnet Hajime, wer weiterkommt.')],
        ],
        [110]
      ),
      t('Hinweise')
    );
    return XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  }

  /* ---------- Mannschaftskampf ---------- */


  // Vorlage für die Aufstellung (lässt sich unter „Mannschaft“ wieder einlesen)
  function teamTemplateBytes(t) {
    t = t || idT;
    const XLSX = root.XLSX;
    const head = [t('Runde'), t('Gewichtsklasse'), t('Weiß Name'), t('Weiß Verein'), t('Blau Name'), t('Blau Verein')];
    const rows = [
      [t('Hinrunde'), '-60 kg', 'Paul Hagedorn', 'JC Mittelstadt', 'Lea Dornbusch', 'TSV Lindenau'],
      [t('Hinrunde'), '-66 kg', 'Leon Pfisterer', 'JC Mittelstadt', '', 'TSV Lindenau'],
      [t('Hinrunde'), '-73 kg', 'Jonas Eichhorn', 'JC Mittelstadt', 'Finn Ostermann', 'TSV Lindenau'],
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheetFrom([head].concat(rows), [12, 14, 24, 22, 24, 22]), t('Aufstellung'));
    XLSX.utils.book_append_sheet(
      wb,
      sheetFrom(
        [
          [t('Aufstellung für den Mannschaftskampf')],
          [''],
          [t('Eine Zeile je Gewichtsklasse, in der Reihenfolge der Kämpfe. Leerer Name = Klasse nicht besetzt (kampfloser Sieg).')],
          [t('Spalte „Runde“: Hinrunde oder Rückrunde (leer = Hinrunde). Die Vereinsspalten geben die Namen der Mannschaften.')],
        ],
        [110]
      ),
      t('Hinweise')
    );
    return XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  }

  // Aufstellung aus importierten Kampfzeilen: Gewichtsklassen, Mannschaften, Durchgänge
  function teamFromFights(fights) {
    const legOf = (r) => (/r(ü|ue)ck|return|second|2/i.test(r || '') ? 2 : 1);
    const out = { classes: [], white: '', blue: '', ageClass: '', legs: 1, lineup: [{ white: {}, blue: {} }, { white: {}, blue: {} }] };
    (fights || []).forEach((f) => {
      const cls = String(f.category || '').trim();
      if (!cls) return;
      const leg = legOf(f.round);
      if (leg === 2) out.legs = 2;
      if (!out.classes.includes(cls)) out.classes.push(cls);
      out.lineup[leg - 1].white[cls] = (f.white && f.white.name) || '';
      out.lineup[leg - 1].blue[cls] = (f.blue && f.blue.name) || '';
      if (!out.white && f.white && f.white.club) out.white = f.white.club;
      if (!out.blue && f.blue && f.blue.club) out.blue = f.blue.club;
      if (!out.ageClass && f.ageClass) out.ageClass = f.ageClass;
    });
    return out;
  }

  // Ergebnisbogen der Begegnung (rows aus JudoTeam.score)
  function teamBytes(opts) {
    const t = opts.t || idT;
    const XLSX = root.XLSX;
    const sc = opts.score;
    const team = opts.team;
    const wName = team.white.name || t('Weiß');
    const bName = team.blue.name || t('Blau');
    const head = [t('Kampf'), t('Runde'), t('Klasse'), wName, bName, t('Sieger'), t('Wertung'), t('Punkte')];
    const rows = sc.rows.map((r) => [
      r.no,
      r.round ? t(r.round) : '',
      r.category,
      (r.white && r.white.name) || t('nicht besetzt'),
      (r.blue && r.blue.name) || t('nicht besetzt'),
      r.winner === 'white' ? wName : r.winner === 'blue' ? bName : r.winner === 'draw' ? t('Unentschieden') : '',
      r.winner ? (r.auto ? t('kampflos') : opts.reasonText ? opts.reasonText(r.reason) : r.reason) : r.status === 'skipped' ? t('entfällt') : '',
      r.winner === 'white' || r.winner === 'blue' ? r.points : '',
    ]);
    const res = sc.winner === 'draw' ? t('Unentschieden') : sc.winner ? t('Sieger: {name}', { name: sc.winner === 'white' ? wName : bName }) : t('vorläufig ({n} von {m} Kämpfen)', { n: sc.done, m: sc.total });
    const aoa = [[team.title || t('Mannschaftskampf')], [], head]
      .concat(rows)
      .concat([[], [t('Stand'), '', '', t('{wins} Siege · {points}', { wins: sc.white.wins, points: sc.white.points }), t('{wins} Siege · {points}', { wins: sc.blue.wins, points: sc.blue.points }), res]]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheetFrom(aoa, [7, 11, 12, 26, 26, 22, 26, 8]), t('Ergebnisbogen'));
    return XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  }

  root.JudoExcel = { importFile, templateBytes, protocolBytes, winnersBytes, matBytes, teamTemplateBytes, teamFromFights, teamBytes, _parseSheet: parseSheet };
})(typeof self !== 'undefined' ? self : this);
