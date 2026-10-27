/* Über Hajime: Credits im Stil eines BIOS-Selbsttests der 1990er.
   Öffnen über das Menü „Über Hajime“, den Knopf in den Einstellungen oder einen Dreifachklick auf „Hajime“ oben links.
   ESC schließt, ENTF/Rücktaste öffnet GitHub, Klick überspringt die Animation. */
(function () {
  'use strict';
  const GH = 'github.com/junky84';
  const GHURL = 'https://github.com/junky84';
  // Logo als Pixelgrafik (24 × 26)
  const PIX = [
    '................##......',
    '................##......',
    '................##......',
    '................##......',
    '................##......',
    '................##......',
    '.................#......',
    '.................#......',
    '.................#......',
    '.................#......',
    '............#....#......',
    '............#...........',
    '...........##...........',
    '...........#............',
    '..........##............',
    '.........###............',
    '........###.............',
    '.......###..........#...',
    '......####..........#...',
    '.....####............#..',
    '....####.............#..',
    '...####...............#.',
    '..####................#.',
    '.###...................#',
    '##......................',
    '.......................#',
  ];
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  let dlg = null;
  let pre = null;
  let foot = null;
  let token = 0;
  let running = false;
  let finish = null;

  function pixSvg() {
    let r = '';
    PIX.forEach((row, y) => {
      let x = 0;
      while (x < row.length) {
        if (row[x] === '#') {
          const s = x;
          while (row[x] === '#') x++;
          r += `<rect x="${s}" y="${y}" width="${x - s}" height="1"/>`;
        } else x++;
      }
    });
    return `<svg viewBox="0 0 24 26" shape-rendering="crispEdges" aria-hidden="true"><g fill="currentColor">${r}</g></svg>`;
  }

  async function appVersion() {
    try {
      const b = window.judoBridge;
      if (b && b.appVersion) return await b.appVersion();
    } catch (err) {
      /* ohne Version weiter */
    }
    return window.HAJIME_VERSION || '';
  }

  function lines(ver) {
    const v = ver ? ' v' + ver : '';
    return [
      ['w', 'junky84 Modular BIOS v4.51PG, An Ippon Ally'],
      ['', `Copyright (C) 1984-${new Date().getFullYear()}, junky84`],
      ['', ''],
      ['y', `HAJIME${v} OPEN-SOURCE RELEASE`],
      ['', ''],
      ['', 'Main Processor : JudoCore 1984 @ 84MHz'],
      ['mem', ''],
      ['', ''],
      ['', 'junky84 Plug and Play BIOS Extension v1.0A'],
      ['', 'Initialize Plug and Play Cards...'],
      ['', ''],
      ['', `Detecting HDD Primary Master   ... Hajime${v}`],
      ['', `Detecting HDD Primary Slave    ... ${GH}`],
      ['', 'Detecting HDD Secondary Master ... Tatami [Ippon-ready]'],
      ['', 'Detecting HDD Secondary Slave  ... None'],
    ];
  }

  const memLine = (k, ok) => `Memory Test    :  ${k}K${ok ? ' OK' : ''}`;
  const lineHtml = ([c, t]) => (c === 'mem' ? memLine(65536, true) : c ? `<span class="${c}">${esc(t)}</span>` : esc(t));

  function renderFoot() {
    const d = new Date();
    const date = `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()}`;
    foot.innerHTML = `Press <a href="${GHURL}" target="_blank" rel="noopener">DEL</a> to visit ${GH}, ESC to exit<br>${date}-i440BX-J84-2A69KG4FC-00`;
  }

  function build() {
    dlg = document.createElement('dialog');
    dlg.className = 'bios-dlg';
    dlg.setAttribute('aria-label', 'Über Hajime');
    dlg.tabIndex = -1;
    dlg.innerHTML = `<div class="bios"><div class="bios-head"><div class="bios-mark">${pixSvg()}</div><pre class="bios-pre"></pre><div class="bios-ally">${pixSvg()}<b>junky84</b></div></div><div class="bios-foot"></div></div>`;
    document.body.appendChild(dlg);
    pre = dlg.querySelector('.bios-pre');
    foot = dlg.querySelector('.bios-foot');
    dlg.addEventListener('close', () => {
      token++;
      running = false;
    });
    dlg.addEventListener('click', (e) => {
      if (e.target.closest('a')) return;
      if (running && finish) finish();
      else dlg.close();
    });
    dlg.addEventListener('keydown', (e) => {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        window.open(GHURL, '_blank', 'noopener');
      } else if ((e.key === 'Enter' || e.key === ' ') && running && finish) {
        e.preventDefault();
        finish();
      }
    });
  }

  async function open() {
    if (!dlg) build();
    if (!dlg.open) dlg.showModal();
    dlg.focus();
    const tok = ++token;
    const L = lines(await appVersion());
    if (tok !== token) return;
    const html = [];
    let i = 0;
    foot.innerHTML = '';
    finish = () => {
      token++;
      running = false;
      pre.innerHTML = L.map(lineHtml).join('\n');
      renderFoot();
    };
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return finish();
    running = true;
    const wait = (ms, fn) => setTimeout(() => tok === token && fn(), ms);
    const show = () => (pre.innerHTML = html.join('\n'));
    const next = () => {
      if (i >= L.length) {
        running = false;
        renderFoot();
        return;
      }
      const l = L[i++];
      if (l[0] === 'mem') {
        const idx = html.push('') - 1;
        let k = 0;
        const count = () => {
          k = Math.min(65536, k + 2048);
          html[idx] = memLine(k, k >= 65536);
          show();
          wait(k < 65536 ? 28 : 260, k < 65536 ? count : next);
        };
        return count();
      }
      html.push(lineHtml(l));
      show();
      wait(l[1].startsWith('Detecting') ? 520 : l[1] === '' ? 90 : 160, next);
    };
    next();
  }

  // Dreifachklick auf den Namen oben links
  document.addEventListener('DOMContentLoaded', () => {
    const brand = document.querySelector('.topbar .brand');
    if (brand) brand.addEventListener('click', (e) => e.detail === 3 && open());
    const btn = document.getElementById('btnAbout');
    if (btn) btn.addEventListener('click', open);
    appVersion().then((v) => {
      const el = document.getElementById('aboutVersion');
      if (el) el.textContent = v ? 'Version ' + v : '';
    });
  });

  window.HajimeCredits = { open };
})();
