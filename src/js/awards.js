/*
 * Siegerehrung: Siegerliste (A4 hoch) und Urkunden (eine A4-Seite pro Platzierung).
 * Liefert eigenständige HTML-Seiten; die App macht daraus ein PDF,
 * die Webversion öffnet den Druckdialog („Als PDF sichern“).
 */
(function (root) {
  'use strict';

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

  // "2026-11-15" → "15. November 2026"
  function longDate(iso) {
    const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return String(iso || '');
    return `${Number(m[3])}. ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
  }

  function classLine(t) {
    const parts = [];
    if (t.ageClass) parts.push('Altersklasse ' + t.ageClass);
    if (t.category) parts.push('Gewichtsklasse ' + t.category);
    return parts.join(' · ') || t.label;
  }

  // Bilder nur einmal im CSS ablegen, nicht auf jeder Seite (hält das Dokument klein)
  const cssUrl = (data) => `url("${String(data).replace(/"/g, '%22')}")`;

  function head(title, css) {
    return `<!doctype html>
<html lang="de"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>
  * { box-sizing: border-box; }
  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { margin: 0; color: #111; font-family: system-ui, -apple-system, "Segoe UI", "Helvetica Neue", Arial, sans-serif; }
${css}
</style></head>
<body>`;
  }

  /* ---------- Siegerliste ---------- */

  function listHtml(opts) {
    const s = opts.settings || {};
    const C = root.JudoCore;
    const meta = [longDate(s.tournamentDate), s.tournamentPlace].filter(Boolean).join(' · ');
    const blocks = opts.tables
      .map((t) => {
        const rows = C.awardRows(t, opts.places);
        if (!rows.length) return '';
        const state = t.complete ? '' : `<span class="prov">vorläufig – ${t.done} von ${t.total} Kämpfen</span>`;
        const tie = t.ties.length ? `<div class="tie">Gleichstand: ${t.ties.map((x) => esc(x.join(', '))).join(' / ')} – Stichkampf nötig</div>` : '';
        return `<section class="grp">
  <h2>${esc(t.label)} <small>Jeder gegen jeden</small>${state}</h2>
  <table><thead><tr><th class="pl">Platz</th><th>Name</th><th>Verein</th></tr></thead><tbody>
  ${rows.map((r) => `<tr><td class="pl p${r.place}">${r.place}${r.tie ? '*' : ''}</td><td class="nm">${esc(r.name)}</td><td>${esc(r.club)}</td></tr>`).join('\n  ')}
  </tbody></table>${tie}
</section>`;
      })
      .join('\n');
    return (
      head(
        'Siegerliste ' + (s.tournament || ''),
        `  @page { size: A4 portrait; margin: 14mm 15mm 16mm;
    @bottom-right { content: "Seite " counter(page) " von " counter(pages); font: 9pt system-ui, Arial, sans-serif; color: #555; } }
  .top { border-bottom: 0.8mm solid #111; padding-bottom: 3mm; margin-bottom: 6mm; display: flex; justify-content: space-between; align-items: flex-end; gap: 8mm; }
  .title { font-size: 22pt; font-weight: 800; line-height: 1.1; }
  .sub { font-size: 11pt; color: #444; margin-top: 1mm; }
  .logo { width: 30mm; height: 18mm; background: ${s.logo ? cssUrl(s.logo) : 'none'} right center / contain no-repeat; flex: none; }
  .grp { break-inside: avoid; margin-bottom: 7mm; }
  h2 { font-size: 14pt; margin: 0 0 2mm; }
  h2 small { font-size: 9pt; font-weight: 600; color: #666; margin-left: 2mm; }
  .prov { font-size: 9pt; font-weight: 700; color: #a15c00; margin-left: 3mm; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; font-size: 8.5pt; letter-spacing: 0.1em; text-transform: uppercase; color: #555; padding: 1.5mm 2mm; border-bottom: 0.35mm solid #111; }
  td { padding: 2.2mm 2mm; border-bottom: 0.25mm solid #ccc; font-size: 12pt; }
  .pl { width: 16mm; font-weight: 800; }
  td.p1 { color: #a07a1c; } td.p2 { color: #6b7280; } td.p3 { color: #9a5a26; }
  .nm { font-weight: 600; }
  .tie { font-size: 9.5pt; color: #a15c00; font-weight: 700; margin-top: 1.5mm; }
  .empty { font-size: 13pt; color: #555; padding: 10mm 0; }`
      ) +
      `
<div class="top"><div><div class="title">${esc(s.tournament || 'Judo')}</div><div class="sub">Siegerliste${meta ? ' · ' + esc(meta) : ''}</div></div>${s.logo ? '<div class="logo"></div>' : ''}</div>
${blocks.trim() || '<div class="empty">Noch keine Platzierungen – es sind keine Kämpfe beendet.</div>'}
</body></html>`
    );
  }

  /* ---------- Urkunden ---------- */

  function nameSize(name) {
    const n = String(name || '').length;
    return n > 30 ? 24 : n > 24 ? 30 : n > 18 ? 36 : 42;
  }

  function certHtml(opts) {
    const s = opts.settings || {};
    const C = root.JudoCore;
    const meta = [s.tournament, longDate(s.tournamentDate), s.tournamentPlace].filter(Boolean).join(' · ');
    const pages = [];
    opts.tables.forEach((t) => {
      C.awardRows(t, opts.places).forEach((r) => {
        pages.push(`<section class="cert">
  <div class="frame"></div>
  <div class="body">
    ${s.logo ? '<div class="logo"></div>' : '<div class="logo-space"></div>'}
    <div class="meta">${esc(meta)}</div>
    <div class="head">Urkunde</div>
    <div class="for">für den</div>
    <div class="place p${r.place}">${r.place}. Platz</div>
    <div class="name" style="font-size:${nameSize(r.name)}pt">${esc(r.name)}</div>
    <div class="club">${esc(r.club)}</div>
    <div class="cls">${esc(classLine(t))}</div>
    <div class="signs">
      <div><i></i>${esc(s.certSign1 || '')}</div>
      <div><i></i>${esc(s.certSign2 || '')}</div>
    </div>
  </div>
</section>`);
      });
    });
    const bg = s.certBg ? cssUrl(s.certBg) : null;
    return (
      head(
        'Urkunden ' + (s.tournament || ''),
        `  @page { size: A4 portrait; margin: 0; }
  .cert { position: relative; width: 210mm; height: 296.5mm; overflow: hidden; break-after: page; ${bg ? `background: ${bg} center / cover no-repeat;` : ''} }
  .cert:last-child { break-after: auto; }
  .frame { position: absolute; inset: 10mm; border: 1.3mm double #b08a2e; ${bg ? 'display: none;' : ''} }
  .body { position: absolute; inset: 22mm 22mm 24mm; display: flex; flex-direction: column; align-items: center; text-align: center; }
  .logo { width: 60mm; height: 30mm; background: ${s.logo ? cssUrl(s.logo) : 'none'} center / contain no-repeat; margin-bottom: 7mm; }
  .logo-space { height: 14mm; }
  .meta { font-size: 13pt; font-weight: 600; color: #555; max-width: 150mm; line-height: 1.35; min-height: 1em; }
  .head { font-family: Georgia, "Times New Roman", serif; font-weight: 700; font-size: 58pt; letter-spacing: 0.02em; margin: 12mm 0 9mm; }
  .for { font-size: 14pt; color: #555; }
  .place { font-family: Georgia, "Times New Roman", serif; font-weight: 700; font-size: 60pt; line-height: 1.1; margin: 2mm 0 10mm; color: #333; }
  .place.p1 { color: #b08a2e; } .place.p2 { color: #7d8794; } .place.p3 { color: #a0612d; }
  .name { font-family: Georgia, "Times New Roman", serif; font-weight: 700; line-height: 1.15; padding: 0 6mm 3mm; border-bottom: 0.3mm solid #bbb; min-width: 115mm; }
  .club { font-size: 15pt; color: #444; margin-top: 4mm; min-height: 1em; }
  .cls { font-size: 15pt; font-weight: 700; margin-top: 9mm; }
  .signs { margin-top: auto; width: 100%; display: flex; justify-content: space-between; gap: 30mm; }
  .signs div { flex: 1; font-size: 11pt; color: #444; }
  .signs i { display: block; border-top: 0.3mm solid #777; margin-bottom: 2.5mm; }
  .empty { font-size: 14pt; color: #555; padding: 30mm; }`
      ) +
      `
${pages.join('\n') || '<div class="empty">Keine Platzierungen für Urkunden vorhanden.</div>'}
</body></html>`
    );
  }

  function count(tables, places) {
    return tables.reduce((n, t) => n + root.JudoCore.awardRows(t, places).length, 0);
  }

  root.JudoAwards = { listHtml, certHtml, count, longDate, classLine };
})(typeof self !== 'undefined' ? self : this);
