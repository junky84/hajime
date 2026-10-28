/*
 * Turnierbaum als HTML – für Bedienung (Auswertung), Anzeige (Gruppentabelle)
 * und Druck. Bekommt die Daten aus JudoBrackets.treeModel(), braucht selbst
 * keine Logik. Stile: .bk-* in css/board.css (Größen in em, Farben als Variablen).
 */
(function (root) {
  'use strict';
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

  function side(s, cls, note, showClub) {
    let name;
    if (s.name) name = `<span class="nm">${esc(s.name)}${showClub && s.club ? `<small>${esc(s.club)}</small>` : ''}</span>`;
    else if (s.bye) name = '<span class="nm from">Freilos</span>';
    else name = `<span class="nm from">${esc(s.from || 'offen')}</span>`;
    return `<div class="bk-s ${cls}${s.win ? ' win' : ''}">${name}${note ? `<span class="nt">${esc(note)}</span>` : ''}</div>`;
  }

  function match(m, opts) {
    if (m.empty) return '<div class="bk-m empty"><div class="bk-s w"><span class="nm from">–</span></div><div class="bk-s b"><span class="nm from">–</span></div></div>';
    const cls = ['bk-m'];
    if (m.live) cls.push('live');
    if (m.done) cls.push('done');
    if (m.walkover) cls.push('walkover');
    const noteW = m.live ? m.liveText : m.white.win && m.done ? m.reason : '';
    const noteB = !m.live && m.blue.win && m.done ? m.reason : '';
    return `<div class="${cls.join(' ')}" title="${esc(m.label)}">${side(m.white, 'w', noteW, opts.club)}${side(m.blue, 'b', noteB, opts.club)}</div>`;
  }

  function column(c, opts, extraCls) {
    return `<div class="bk-col${extraCls ? ' ' + extraCls : ''}"><div class="bk-h">${esc(c.title)}</div><div class="bk-ms">${c.matches.map((m) => match(m, opts)).join('')}</div></div>`;
  }

  function podium(model) {
    const items = model.podium
      .map((p, i) => {
        const fallback = p.place === 1 ? 'offen' : p.place === 2 ? 'offen' : model.system === 'ko' && model.extra.length ? `Sieger Platz 3 ${i === 2 ? 'A' : 'B'}` : `Verlierer HF ${i - 1}`;
        return `<div class="bk-pod"><i class="p${p.place}">${p.place}</i><span${p.name ? '' : ' class="from"'}>${esc(p.name || fallback)}</span></div>`;
      })
      .join('');
    return `<div class="bk-col bk-places"><div class="bk-h">Platzierung</div><div class="bk-ms"><div class="bk-podium">${items}</div></div></div>`;
  }

  function pools(model, opts) {
    if (!model.pools) return '';
    return `<div class="bk-pools">${model.pools
      .map(
        (p) => `<div class="bk-pool"><div class="bk-h">${esc(p.title)}${p.complete ? '' : ' <em>läuft</em>'}</div><table>${p.rows
          .map(
            (r) =>
              `<tr class="${r.tie ? 'tie' : ''}"><td class="pl">${r.place == null ? '–' : r.place}</td><td class="pn">${esc(r.name)}${opts.club && r.club ? `<small>${esc(r.club)}</small>` : ''}</td><td>${r.wins} S</td><td>${r.points} P</td></tr>`
          )
          .join('')}</table></div>`
      )
      .join('')}</div>`;
  }

  /** opts: { club: Verein zeigen } */
  function treeHtml(model, opts) {
    opts = opts || {};
    if (!model) return '';
    const maxN = Math.max(1, ...model.columns.map((c) => c.matches.length));
    const main = `<div class="bk-main">${model.columns.map((c) => column(c, opts)).join('')}${podium(model)}</div>`;
    const extra = model.extra && model.extra.length ? `<div class="bk-extra">${model.extra.map((c) => column(c, opts, c.matches.length > 1 ? 'two' : '')).join('')}</div>` : '';
    return `<div class="bk bk-${esc(model.system)}" style="--n:${maxN}">${pools(model, opts)}${main}${extra}</div>`;
  }

  // Eigenständige Druckseite (A4 quer), Stile direkt eingebettet
  function printHtml(model, settings, css) {
    settings = settings || {};
    return `<!doctype html>
<html lang="de"><head><meta charset="utf-8"><title>Turnierbaum ${esc(model.label)}</title>
<style>
  @page { size: A4 landscape; margin: 10mm 12mm; }
  * { box-sizing: border-box; }
  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { margin: 0; font-family: system-ui, -apple-system, "Segoe UI", Arial, sans-serif; color: #111; }
  .top { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 0.6mm solid #111; padding-bottom: 2mm; margin-bottom: 4mm; }
  .title { font-size: 18pt; font-weight: 800; }
  .sub { font-size: 10pt; color: #444; }
  .cls { font-size: 22pt; font-weight: 900; }
  ${css || ''}
  .bk { font-size: ${model.columns.length > 4 ? 7.5 : 9}pt; }
</style></head>
<body class="bk-print">
<div class="top"><div><div class="title">${esc(settings.tournament || 'Judo')}</div><div class="sub">${esc(model.systemLabel)} · ${model.players} Kämpfer</div></div><div class="cls">${esc(model.label)}</div></div>
${treeHtml(model, { club: true })}
</body></html>`;
  }

  root.JudoBracketView = { treeHtml, printHtml };
})(typeof self !== 'undefined' ? self : this);
