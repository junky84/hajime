/*
 * Darstellung der Anzeigetafel. Wird im Publikumsfenster (Vollbild) und als
 * verkleinerte Vorschau im Bedienfenster benutzt. Bekommt eine "view" vom
 * Bedienfenster und rechnet nur noch die laufenden Uhren selbst hoch.
 */
(function (root) {
  'use strict';
  const C = root.JudoCore;

  const TEMPLATE = `
  <div class="jb-in">
    <header class="jb-top">
      <img class="jb-logo" alt="">
      <div class="jb-title"></div>
      <div class="jb-meta"></div>
    </header>
    <section class="jb-rows">
      ${['white', 'blue']
        .map(
          (s) => `
      <div class="jb-row" data-side="${s}">
        <div class="jb-info">
          <div class="jb-name"></div>
          <div class="jb-club"></div>
        </div>
        <div class="jb-badge"></div>
        <div class="jb-pen"></div>
        <div class="jb-sc" data-k="ippon"><span class="jb-v"></span><span class="jb-l">IPPON</span></div>
        <div class="jb-sc" data-k="wazaari"><span class="jb-v"></span><span class="jb-l">WAZA-ARI</span></div>
        <div class="jb-sc" data-k="yuko"><span class="jb-v"></span><span class="jb-l">YUKO</span></div>
        <div class="jb-flash"></div>
      </div>`
        )
        .join('')}
    </section>
    <footer class="jb-bottom">
      <div class="jb-clock"><span class="jb-gs">GS</span><span class="jb-time">0:00</span></div>
      <div class="jb-mid">
        <div class="jb-status"></div>
        <div class="jb-osae">
          <div class="jb-osae-head"><span class="jb-osae-lbl">OSAEKOMI</span><span class="jb-osae-t">0</span></div>
          <div class="jb-osae-bar"><i></i></div>
        </div>
      </div>
    </footer>
    <div class="jb-next"></div>
    <div class="jb-idle">
      <img class="jb-idle-logo" alt="">
      <div class="jb-idle-title"></div>
      <div class="jb-idle-mat"></div>
      <div class="jb-idle-list"></div>
    </div>
    <div class="jb-table">
      <div class="jb-tb-sub"></div>
      <div class="jb-tb-title"></div>
      <div class="jb-tb-grid"></div>
      <div class="jb-tb-foot"></div>
    </div>
  </div>`;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  }

  function mount(container, opts) {
    opts = opts || {};
    container.classList.add('jb');
    container.innerHTML = TEMPLATE;
    const $ = (sel) => container.querySelector(sel);
    const rows = {
      white: container.querySelector('.jb-row[data-side="white"]'),
      blue: container.querySelector('.jb-row[data-side="blue"]'),
    };
    let view = null;
    let lastFlashId = null;
    let lastSoundId = null;
    let raf = 0;
    let fitPending = true;

    function fitText(el, maxRatio, minRatio) {
      const H = container.clientHeight || 1;
      let size = H * maxRatio;
      const min = H * minRatio;
      el.style.fontSize = size + 'px';
      let guard = 40;
      while (guard-- > 0 && el.scrollWidth > el.clientWidth + 1 && size > min) {
        size *= 0.93;
        el.style.fontSize = size + 'px';
      }
    }

    function fitAll() {
      fitPending = false;
      ['white', 'blue'].forEach((s) => {
        fitText(rows[s].querySelector('.jb-name'), 0.105, 0.035);
        fitText(rows[s].querySelector('.jb-club'), 0.045, 0.022);
      });
      fitText($('.jb-title'), 0.048, 0.022);
      const size = (view && view.settings.nextSize) || 'large';
      if (size === 'small') fitText($('.jb-next'), 0.033, 0.018);
      else {
        const head = $('.jb-nx-head');
        if (head) fitText(head, size === 'xlarge' ? 0.034 : 0.028, 0.016);
        if (size === 'large') {
          const names = $('.jb-nx-names');
          if (names) fitText(names, 0.06, 0.022);
        } else {
          // beide Kämpfer gleich groß: der längere Name bestimmt die Schrift
          const ps = Array.from(container.querySelectorAll('.jb-nx-p'));
          ps.forEach((p) => fitText(p, 0.072, 0.026));
          const min = Math.min(...ps.map((p) => parseFloat(p.style.fontSize) || Infinity));
          if (isFinite(min)) ps.forEach((p) => (p.style.fontSize = min + 'px'));
        }
      }
    }

    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => fitAll()) : null;
    if (ro) ro.observe(container);

    function renderRow(side, f, r, s) {
      const row = rows[side];
      const c = f[side];
      row.querySelector('.jb-name').textContent = C.displayName(c, side);
      row.querySelector('.jb-name').classList.toggle('is-placeholder', !c.name);
      const club = row.querySelector('.jb-club');
      club.textContent = s.showClub ? c.club || '' : '';
      row.querySelector('.jb-sc[data-k="ippon"] .jb-v').textContent = c.ippon;
      row.querySelector('.jb-sc[data-k="wazaari"] .jb-v').textContent = c.wazaari;
      row.querySelector('.jb-sc[data-k="yuko"] .jb-v').textContent = c.yuko;
      row.querySelector('.jb-sc[data-k="ippon"]').classList.toggle('is-zero', !c.ippon);
      row.querySelector('.jb-sc[data-k="wazaari"]').classList.toggle('is-zero', !c.wazaari);
      row.querySelector('.jb-sc[data-k="yuko"]').classList.toggle('is-zero', !c.yuko);
      const pen = row.querySelector('.jb-pen');
      const hsk = C.isHansoku(c, r);
      let cards = '';
      if (hsk) cards = '<i class="card red"></i>';
      else for (let i = 0; i < Math.min(c.shido, 5); i++) cards += '<i class="card yellow"></i>';
      pen.innerHTML = cards;
      const win = f.status === 'finished' && f.winner === side;
      const lose = f.status === 'finished' && f.winner && f.winner !== 'draw' && f.winner !== side;
      row.classList.toggle('is-winner', win);
      row.classList.toggle('is-loser', lose);
      row.querySelector('.jb-badge').textContent = win ? 'SIEGER' : '';
    }

    function statusText(f, r) {
      if (f.status === 'finished') {
        if (f.winner === 'draw') return { text: 'UNENTSCHIEDEN', cls: 'neutral' };
        const name = C.displayName(f[f.winner], f.winner);
        return { text: `${name} gewinnt · ${f.reason}`, cls: 'win-' + f.winner };
      }
      if (f.status === 'timeup') {
        if (f.clock.mode === 'regular' && r.golden) return { text: 'GOLDEN SCORE', cls: 'gold' };
        return { text: 'HANTEI – Kampfrichterentscheid', cls: 'gold' };
      }
      if (f.status === 'ready') return { text: '', cls: '' };
      if (f.status === 'paused') return { text: 'MATE', cls: 'mate' };
      return { text: '', cls: '' };
    }

    function render() {
      if (!view) return;
      const { fight: f, rules: r, settings: s } = view;
      container.classList.toggle('swap', !!s.swap);
      container.classList.toggle('no-yuko', !r.yuko && !f.white.yuko && !f.blue.yuko);
      container.classList.toggle('is-idle', view.screen === 'idle');
      container.classList.toggle('is-table', view.screen === 'table');
      container.classList.toggle('golden', f.clock.mode === 'golden');

      const logo = $('.jb-logo');
      if (s.logo) {
        if (logo.getAttribute('src') !== s.logo) logo.src = s.logo;
        logo.style.display = '';
      } else logo.style.display = 'none';
      $('.jb-title').textContent = s.tournament || 'Judo';
      const meta = [s.mat, f.ageClass, f.category, f.no ? 'Kampf ' + f.no : ''].filter(Boolean);
      $('.jb-meta').innerHTML = meta.map((m) => `<span>${esc(m)}</span>`).join('');

      renderRow('white', f, r, s);
      renderRow('blue', f, r, s);

      const st = statusText(f, r);
      const stEl = $('.jb-status');
      stEl.textContent = st.text;
      stEl.className = 'jb-status ' + st.cls;

      const next = (view.next || [])[0];
      const nextEl = $('.jb-next');
      const nextSize = s.nextSize || 'large';
      container.classList.toggle('next-large', !!(s.showNext && next) && nextSize === 'large');
      container.classList.toggle('next-xlarge', !!(s.showNext && next) && nextSize === 'xlarge');
      if (s.showNext && next) {
        const cat = [next.ageClass, next.category].filter(Boolean).join(' ');
        let html;
        if (nextSize === 'small') {
          const fmt = (p) => esc(p.name || '?') + (s.showClub && p.club ? ` <small>(${esc(p.club)})</small>` : '');
          html = `<b>Nächster Kampf${cat ? ' · ' + esc(cat) : ''}:</b> ${fmt(next.white)} <span class="vs">–</span> ${fmt(next.blue)}`;
        } else {
          // zweizeilig: Signalzeile oben, Namen groß mit Farbmarke Weiß/Blau
          const person = (p, side) =>
            `<div class="jb-nx-p ${side}"><i></i><b>${esc(p.name || '?')}</b>${s.showClub && p.club ? `<small>${esc(p.club)}</small>` : ''}</div>`;
          html =
            `<div class="jb-nx-head">Nächster Kampf${cat ? ' · ' + esc(cat) : ''} · bitte bereitmachen</div>` +
            `<div class="jb-nx-names">${person(next.white, 'w')}${nextSize === 'large' ? '<span class="vs">–</span>' : ''}${person(next.blue, 'b')}</div>`;
        }
        if (nextEl.innerHTML !== html) nextEl.innerHTML = html;
        nextEl.style.display = '';
      } else {
        nextEl.innerHTML = '';
        nextEl.style.display = 'none';
      }

      // Pausenbild
      const il = $('.jb-idle-logo');
      if (s.logo) {
        if (il.getAttribute('src') !== s.logo) il.src = s.logo;
        il.style.display = '';
      } else il.style.display = 'none';
      $('.jb-idle-title').textContent = s.tournament || 'Judo';
      $('.jb-idle-mat').textContent = s.mat || '';
      const list = (view.next || []).slice(0, 6);
      $('.jb-idle-list').innerHTML = list.length
        ? '<h3>Nächste Kämpfe</h3>' +
          list
            .map(
              (n) =>
                `<div class="it"><span class="cat">${esc([n.ageClass, n.category].filter(Boolean).join(' '))}</span><span class="w">${esc(
                  n.white.name || '?'
                )}</span><span class="vs">–</span><span class="b">${esc(n.blue.name || '?')}</span></div>`
            )
            .join('')
        : '';

      renderTable(view.table, s);

      // Wertungs-Einblendung
      const fl = f.flash;
      const flKey = fl ? f.id + ':' + fl.id : null;
      if (fl && flKey !== lastFlashId) {
        lastFlashId = flKey;
        if (s.flashScores && Date.now() - fl.at < 2500) showFlash(fl);
      }
      // Ton (nur im Publikumsfenster, wenn so eingestellt)
      const snd = f.sound;
      const sndKey = snd ? f.id + ':' + snd.id : null;
      if (snd && sndKey !== lastSoundId) {
        lastSoundId = sndKey;
        const wanted = s.soundOn && (s.soundTarget === 'board' || s.soundTarget === 'both');
        if (opts.sound && wanted && Date.now() - snd.at < 2500 && root.JudoSound) root.JudoSound.play(snd.kind);
      }

      fitPending = true;
      requestAnimationFrame(() => fitPending && fitAll());
      if (!raf) loop();
    }

    // Gruppentabelle („Jeder gegen jeden“) als eigener Bildschirm
    function renderTable(t, s) {
      const box = $('.jb-table');
      if (!t) {
        box.querySelector('.jb-tb-sub').textContent = 'Gruppentabelle';
        box.querySelector('.jb-tb-title').textContent = s.tournament || 'Judo';
        box.querySelector('.jb-tb-grid').innerHTML = '<div class="jb-tb-empty">Noch keine Gruppe in der Kampfliste</div>';
        box.querySelector('.jb-tb-foot').textContent = '';
        return;
      }
      const sub = ['Gruppentabelle', t.label, t.complete ? `nach ${t.done} von ${t.total} Kämpfen` : `Zwischenstand nach ${t.done} von ${t.total} Kämpfen`];
      box.querySelector('.jb-tb-sub').textContent = sub.join(' · ');
      box.querySelector('.jb-tb-title').textContent = s.tournament || 'Judo';
      const head =
        '<div class="jb-tb-row jb-tb-head"><span>Platz</span><span>Name</span><span>Siege</span><span>Wertungen</span><span>Ippon · Waza-ari · Yuko</span></div>';
      const rows = t.rows
        .map(
          (r) =>
            `<div class="jb-tb-row${r.tie ? ' tie' : ''}"><span class="pl p${r.place}">${r.place == null ? '–' : r.place}</span><span class="nm"><b>${esc(r.name)}</b>${
              s.showClub && r.club ? `<small>${esc(r.club)}</small>` : ''
            }${r.tie ? '<em>Stichkampf</em>' : ''}</span><span>${r.wins}</span><span>${r.points}</span><span class="iwy">${r.ippon} · ${r.wazaari} · ${r.yuko}</span></div>`
        )
        .join('');
      const grid = box.querySelector('.jb-tb-grid');
      grid.style.setProperty('--rows', Math.max(4, t.rows.length));
      const html = head + rows;
      if (grid.innerHTML !== html) grid.innerHTML = html;
      const p = t.winPoints || {};
      const order =
        t.rankOrder === 'direct'
          ? 'bei gleichen Siegen entscheidet der direkte Vergleich, dann die Wertungspunkte'
          : 'bei gleichen Siegen entscheiden die Wertungspunkte, dann der direkte Vergleich';
      const foot = box.querySelector('.jb-tb-foot');
      if (t.ties && t.ties.length) {
        foot.innerHTML = `<b>Gleichstand: ${t.ties.map((x) => esc(x.join(', '))).join(' / ')} – Stichkampf nötig</b>`;
      } else {
        foot.textContent = `Wertungspunkte je Sieg: Ippon ${p.ippon} · Waza-ari ${p.wazaari} · Yuko ${p.yuko} · Entscheidung ${p.decision} · ${order}`;
      }
    }

    function showFlash(fl) {
      const row = rows[fl.side];
      if (!row) return;
      const el = row.querySelector('.jb-flash');
      el.textContent = fl.text;
      el.classList.remove('on');
      void el.offsetWidth;
      el.classList.add('on');
    }

    function loop() {
      raf = requestAnimationFrame(loop);
      if (!view) return;
      const f = view.fight;
      const r = view.rules;
      const now = Date.now();
      const ms = C.clockMs(f.clock, now);
      const timeEl = $('.jb-time');
      const t = C.formatClock(ms, f.clock.mode);
      if (timeEl.textContent !== t) timeEl.textContent = t;
      const clk = $('.jb-clock');
      const running = C.clockRunning(f.clock) && (f.clock.mode === 'golden' || ms > 0);
      clk.classList.toggle('running', running);
      clk.classList.toggle('stopped', !running);

      const o = f.osae;
      const box = $('.jb-osae');
      const showLast = !o.side && o.lastSide && now - o.lastAt < 6000 && f.status !== 'ready';
      if (o.side || showLast) {
        const side = o.side || o.lastSide;
        const oms = C.osaeMs(o, now);
        const sec = Math.floor(oms / 1000);
        box.className = 'jb-osae on side-' + side + (o.side ? ' live' : ' last');
        const tEl = box.querySelector('.jb-osae-t');
        if (tEl.textContent !== String(sec)) tEl.textContent = sec;
        const max = r.osaeIppon || 20;
        box.querySelector('.jb-osae-bar i').style.width = Math.min(100, (oms / (max * 1000)) * 100) + '%';
        box.querySelector('.jb-osae-lbl').textContent = o.side ? 'OSAEKOMI' : 'TOKETA';
        $('.jb-status').classList.add('hidden');
      } else {
        box.className = 'jb-osae';
        $('.jb-status').classList.remove('hidden');
      }
    }

    function markers() {
      // Schwellen-Markierungen im Osaekomi-Balken
      const bar = $('.jb-osae-bar');
      bar.querySelectorAll('b').forEach((b) => b.remove());
      if (!view) return;
      const r = view.rules;
      const max = r.osaeIppon || 20;
      [r.yuko ? r.osaeYuko : null, r.osaeWazaari].filter((x) => x && x < max).forEach((sec) => {
        const b = document.createElement('b');
        b.style.left = (sec / max) * 100 + '%';
        bar.appendChild(b);
      });
    }

    return {
      update(v) {
        const rulesChanged = !view || JSON.stringify(view.rules) !== JSON.stringify(v.rules);
        view = v;
        if (rulesChanged) markers();
        render();
      },
      destroy() {
        cancelAnimationFrame(raf);
        if (ro) ro.disconnect();
      },
    };
  }

  root.JudoBoard = { mount };
})(typeof self !== 'undefined' ? self : this);
