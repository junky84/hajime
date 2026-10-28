/*
 * Aushang: Kampfreihenfolge pro Matte zum Ausdrucken (A4 oder A3 quer).
 * Bewusst ohne Uhrzeiten und ohne Ergebnisse – nur die Reihenfolge.
 * Liefert eine eigenständige HTML-Seite; die App macht daraus ein PDF,
 * die Webversion öffnet den Druckdialog („Als PDF sichern“).
 */
(function (root) {
  'use strict';

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

  /** Kämpfe nach Matte gruppieren, in Kampfreihenfolge. Ohne eigene Matte: die eingestellte. */
  function mats(queue, defaultMat, onlyOpen) {
    const m = new Map();
    queue.forEach((e, i) => {
      if (e.status === 'skipped') return;
      if (onlyOpen && e.status === 'done') return;
      const mat = e.mat || defaultMat || 'Matte 1';
      if (!m.has(mat)) m.set(mat, []);
      m.get(mat).push(Object.assign({}, e, { no: e.no || String(i + 1) }));
    });
    return Array.from(m, ([name, fights]) => ({ name, fights }));
  }

  function person(p, from, t) {
    if (!(p && p.name) && from) return `<span class="n ph">${esc(t.phrase(from))}</span>`;
    return `<span class="n">${esc((p && p.name) || '–')}</span>${p && p.club ? `<span class="c">${esc(p.club)}</span>` : ''}`;
  }
  const cls = (f) => [f.ageClass, f.gender, f.category].filter(Boolean).join(' ');

  const plain = (s, p) => (p ? String(s).replace(/\{(\w+)\}/g, (m, k) => (p[k] == null ? m : p[k])) : s);
  plain.phrase = (s) => s || '';

  function html(opts) {
    const t = opts.t || plain;
    const size = opts.size === 'A3' ? 'A3' : 'A4';
    const scale = size === 'A3' ? 1.41 : 1;
    const pages = opts.mats
      .map(
        (mat) => `<section class="mat">
  <table>
    <thead>
      <tr class="head"><th colspan="4">
        <div class="top">
          <div><div class="title">${esc(opts.tournament || 'Judo')}</div><div class="sub">${esc(t('Kampfreihenfolge'))}</div></div>
          <div class="matname">${esc(t.phrase(mat.name).toUpperCase())}</div>
        </div>
      </th></tr>
      <tr class="cols"><th class="no">${esc(t('Nr.'))}</th><th class="cls">${esc(t('Klasse'))}</th><th>${esc(t('Weiß'))}</th><th>${esc(t('Blau'))}</th></tr>
    </thead>
    <tbody>
      ${mat.fights
        .map(
          (f) => `<tr><td class="no">${esc(f.no)}</td><td class="cls">${esc(cls(f))}${f.round ? `<span class="rd">${esc(t.phrase(f.round))}</span>` : ''}</td><td>${person(
            f.white,
            f.whiteFrom,
            t
          )}</td><td>${person(f.blue, f.blueFrom, t)}</td></tr>`
        )
        .join('\n      ')}
    </tbody>
  </table>
</section>`
      )
      .join('\n');
    return `<!doctype html>
<html lang="${esc(t.lang || 'de')}"><head><meta charset="utf-8"><title>${esc(t('Aushang'))} ${esc(opts.tournament || '')}</title>
<style>
  @page { size: ${size} landscape; margin: 12mm 14mm 14mm;
    @bottom-right { content: "${t('Seite')} " counter(page) " ${t('von')} " counter(pages); font: ${9 * scale}pt system-ui, -apple-system, "Segoe UI", Arial, sans-serif; color: #555; } }
  * { box-sizing: border-box; }
  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { margin: 0; font-family: system-ui, -apple-system, "Segoe UI", "Helvetica Neue", Arial, sans-serif; color: #111; font-size: ${12 * scale}pt; }
  .mat { break-after: page; }
  .mat:last-child { break-after: auto; }
  table { width: 100%; border-collapse: collapse; }
  thead { display: table-header-group; }
  tr { break-inside: avoid; }
  .head th { padding: 0 0 ${3 * scale}mm; text-align: left; font-weight: normal; }
  .top { display: flex; justify-content: space-between; align-items: flex-end; gap: 10mm; border-bottom: ${0.8 * scale}mm solid #111; padding-bottom: ${3 * scale}mm; }
  .title { font-size: ${22 * scale}pt; font-weight: 800; line-height: 1.1; }
  .sub { font-size: ${11 * scale}pt; color: #444; margin-top: 1mm; }
  .matname { font-size: ${34 * scale}pt; font-weight: 900; line-height: 1; white-space: nowrap; }
  .cols th { text-align: left; font-size: ${9 * scale}pt; letter-spacing: 0.12em; text-transform: uppercase; color: #444;
    padding: ${2.5 * scale}mm ${2 * scale}mm; border-bottom: ${0.35 * scale}mm solid #111; }
  td { padding: ${3.2 * scale}mm ${2 * scale}mm; border-bottom: 0.25mm solid #ccc; vertical-align: baseline; font-size: ${13 * scale}pt; }
  .no { width: 7%; font-weight: 800; font-size: ${14 * scale}pt; }
  .cls { width: 14%; white-space: nowrap; }
  .n { font-size: ${15 * scale}pt; }
  .c { color: #555; font-size: ${10 * scale}pt; margin-left: 0.7em; }
  .ph { font-style: italic; color: #666; font-size: ${12 * scale}pt; }
  .rd { display: block; color: #555; font-size: ${9 * scale}pt; }
  .empty { font-size: ${14 * scale}pt; color: #555; padding: 10mm 0; }
</style></head>
<body>
${pages || `<div class="empty">${esc(t('Keine Kämpfe in der Kampfliste.'))}</div>`}
</body></html>`;
  }

  root.JudoNotice = { mats, html };
})(typeof self !== 'undefined' ? self : this);
