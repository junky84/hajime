/*
 * Darstellung der Anzeigetafel. Wird im Publikumsfenster (Vollbild) und als
 * verkleinerte Vorschau im Bedienfenster benutzt. Bekommt eine "view" vom
 * Bedienfenster und rechnet nur noch die laufenden Uhren selbst hoch.
 */
(function (root) {
  'use strict';
  const C = root.JudoCore;
  const I18n = root.HajimeI18n;

  const TEMPLATE = `
  <div class="jb-in">
    <header class="jb-top">
      <img class="jb-logo" alt="">
      <div class="jb-title"></div>
      <div class="jb-meta"></div>
    </header>
    <div class="jb-teambar">
      <div class="jb-tm w"><b></b><small></small></div>
      <div class="jb-tm-score"><b></b><small></small></div>
      <div class="jb-tm b"><b></b><small></small></div>
    </div>
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
    <div class="jb-callbar"><span class="jb-cb-lbl">AUFRUF</span><b class="jb-cb-msg"></b></div>
    <div class="jb-train">
      <div class="jb-tr-top"><div class="jb-tr-title"></div><div class="jb-tr-sum"></div></div>
      <div class="jb-tr-next"><small></small><b></b></div>
      <div class="jb-tr-phase"></div>
      <div class="jb-tr-time">0:00</div>
      <div class="jb-tr-round"></div>
      <div class="jb-tr-note"></div>
      <div class="jb-tr-dots"></div>
      <div class="jb-tr-bar"><i></i></div>
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
    // Sprache der Anzeige (Einstellungen → Bedienung)
    let t = I18n ? I18n.make('de') : Object.assign((x) => x, { phrase: (x) => x || '' });
    const tx = (k, p) => t(k, p);
    tx.phrase = (x) => t.phrase(x);
    function setLang(lang) {
      if (!I18n || t.lang === I18n.resolve(lang)) return;
      t = I18n.make(lang);
      container.querySelector('.jb-cb-lbl').textContent = t('AUFRUF');
    }

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
      if (container.querySelector('.jb-callbar.on')) fitText($('.jb-cb-msg'), 0.056, 0.026);
      // Turnierbaum auf der Anzeige: Schrift so groß, dass alles in den Bildschirm passt
      const bk = container.querySelector('.jb-tb-grid .bk');
      if (bk && container.classList.contains('is-table')) {
        const grid = bk.parentElement;
        const H = container.clientHeight || 1;
        let size = H * 0.032;
        bk.style.fontSize = size + 'px';
        let guard = 60;
        while (guard-- > 0 && bk.scrollHeight > grid.clientHeight + 1 && size > H * 0.008) {
          size *= 0.94;
          bk.style.fontSize = size + 'px';
        }
      }
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
      row.querySelector('.jb-name').textContent = C.displayName(c, side, t);
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
      row.querySelector('.jb-badge').textContent = win ? tx('SIEGER') : '';
    }

    function statusText(f, r) {
      if (f.status === 'finished') {
        if (f.winner === 'draw') return { text: tx('UNENTSCHIEDEN'), cls: 'neutral' };
        const name = C.displayName(f[f.winner], f.winner, t);
        return { text: tx('{name} gewinnt · {reason}', { name, reason: C.reasonText(f.reason, t) }), cls: 'win-' + f.winner };
      }
      if (f.status === 'timeup') {
        if (f.clock.mode === 'regular' && r.golden) return { text: 'GOLDEN SCORE', cls: 'gold' };
        return { text: tx('HANTEI – Kampfrichterentscheid'), cls: 'gold' };
      }
      if (f.status === 'ready') return { text: '', cls: '' };
      if (f.status === 'paused') return { text: 'MATE', cls: 'mate' };
      return { text: '', cls: '' };
    }

    function render() {
      if (!view) return;
      const { fight: f, rules: r, settings: s } = view;
      setLang(s.langBoard);
      container.classList.toggle('swap', !!s.swap);
      container.classList.toggle('lvl-simple', s.level === 'simple');
      container.classList.toggle('no-yuko', !r.yuko && !f.white.yuko && !f.blue.yuko);
      container.classList.toggle('is-idle', view.screen === 'idle');
      container.classList.toggle('is-table', view.screen === 'table');
      container.classList.toggle('is-training', view.screen === 'training' && !!view.training);
      container.classList.toggle('golden', f.clock.mode === 'golden');

      const logo = $('.jb-logo');
      if (s.logo) {
        if (logo.getAttribute('src') !== s.logo) logo.src = s.logo;
        logo.style.display = '';
      } else logo.style.display = 'none';
      $('.jb-title').textContent = s.tournament || 'Judo';
      const meta = s.level === 'simple' ? [] : [t.phrase(s.mat), f.ageClass, f.gender, f.category, f.no ? tx('Kampf {no}', { no: f.no }) : ''].filter(Boolean);
      $('.jb-meta').innerHTML = meta.map((m) => `<span>${esc(m)}</span>`).join('');

      renderRow('white', f, r, s);
      renderRow('blue', f, r, s);

      const st = statusText(f, r);
      const stEl = $('.jb-status');
      stEl.textContent = st.text;
      stEl.className = 'jb-status ' + st.cls;

      const next = s.level === 'simple' ? null : (view.next || [])[0];
      const nextEl = $('.jb-next');
      const nextSize = s.nextSize || 'large';
      container.classList.toggle('next-large', !!(s.showNext && next) && nextSize === 'large');
      container.classList.toggle('next-xlarge', !!(s.showNext && next) && nextSize === 'xlarge');
      if (s.showNext && next) {
        const cat = C.classLabel(next);
        let html;
        if (nextSize === 'small') {
          const fmt = (p) => esc(p.name || '?') + (s.showClub && p.club ? ` <small>(${esc(p.club)})</small>` : '');
          html = `<b>${esc(tx('Nächster Kampf'))}${cat ? ' · ' + esc(cat) : ''}:</b> ${fmt(next.white)} <span class="vs">–</span> ${fmt(next.blue)}`;
        } else {
          // zweizeilig: Signalzeile oben, Namen groß mit Farbmarke Weiß/Blau
          const person = (p, side) =>
            `<div class="jb-nx-p ${side}"><i></i><b>${esc(p.name || '?')}</b>${s.showClub && p.club ? `<small>${esc(p.club)}</small>` : ''}</div>`;
          html =
            `<div class="jb-nx-head">${esc(tx('Nächster Kampf'))}${cat ? ' · ' + esc(cat) : ''} · ${esc(tx('bitte bereitmachen'))}</div>` +
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
      $('.jb-idle-mat').textContent = t.phrase(s.mat);
      const list = (view.next || []).slice(0, 6);
      $('.jb-idle-list').innerHTML = list.length
        ? `<h3>${esc(tx('Nächste Kämpfe'))}</h3>` +
          list
            .map(
              (n) =>
                `<div class="it"><span class="cat">${esc(C.classLabel(n))}</span><span class="w">${esc(
                  n.white.name || '?'
                )}</span><span class="vs">–</span><span class="b">${esc(n.blue.name || '?')}</span></div>`
            )
            .join('')
        : '';

      renderTable(view.table, s);
      renderCallBar(view.call);
      renderTeam(view.team, s);
      renderTraining(view.training, s);

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
        box.querySelector('.jb-tb-sub').textContent = tx('Gruppentabelle');
        box.querySelector('.jb-tb-title').textContent = s.tournament || 'Judo';
        box.querySelector('.jb-tb-grid').innerHTML = `<div class="jb-tb-empty">${esc(tx('Noch keine Gruppe in der Kampfliste'))}</div>`;
        box.querySelector('.jb-tb-foot').textContent = '';
        return;
      }
      const tree = t.tree && root.JudoBracketView;
      const sub = [
        tree ? tx(t.tree.systemLabel) : tx('Gruppentabelle'),
        t.label,
        tx(t.complete ? 'nach {done} von {total} Kämpfen' : 'Zwischenstand nach {done} von {total} Kämpfen', { done: t.done, total: t.total }),
      ];
      box.querySelector('.jb-tb-sub').textContent = sub.join(' · ');
      box.querySelector('.jb-tb-title').textContent = s.tournament || 'Judo';
      box.classList.toggle('is-tree', !!tree);
      if (tree) {
        const grid = box.querySelector('.jb-tb-grid');
        const html = root.JudoBracketView.treeHtml(t.tree, { club: s.showClub, t: tx });
        if (grid.innerHTML !== html) grid.innerHTML = html;
        box.querySelector('.jb-tb-foot').textContent = tx('Sieger rücken automatisch weiter, sobald ein Kampf beendet ist.');
        return;
      }
      const yuko = t.yuko !== false;
      const djb = t.scheme !== 'ijf' && t.scheme !== 'custom';
      const head = `<div class="jb-tb-row jb-tb-head"><span>${esc(tx('Platz'))}</span><span>${esc(tx('Name'))}</span><span>${esc(tx(djb ? 'Siegpunkte' : 'Siege'))}</span><span>${esc(
        tx(djb ? 'Wertungspunkte' : 'Punkte')
      )}</span></div>`;
      const rows = t.rows
        .map(
          (r) =>
            `<div class="jb-tb-row${r.tie ? ' tie' : ''}"><span class="pl p${r.place}">${r.place == null ? '–' : r.place}</span><span class="nm"><b>${esc(r.name)}</b>${
              s.showClub && r.club ? `<small>${esc(r.club)}</small>` : ''
            }${r.tie ? `<em>${esc(tx('Stichkampf'))}</em>` : ''}</span><span>${r.wins}</span><span>${r.points}</span></div>`
        )
        .join('');
      const grid = box.querySelector('.jb-tb-grid');
      grid.style.setProperty('--rows', Math.max(4, t.rows.length));
      const html = head + rows;
      if (grid.innerHTML !== html) grid.innerHTML = html;
      const foot = box.querySelector('.jb-tb-foot');
      if (t.ties && t.ties.length) {
        foot.innerHTML = `<b>${esc(tx('Gleichstand: {names} – Stichkampf nötig', { names: t.ties.map((x) => x.join(', ')).join(' / ') }))}</b>`;
      } else foot.textContent = schemeText(t, yuko);
    }

    // Fußzeile der Gruppentabelle: wie gerechnet wird
    function schemeText(tb, yuko) {
      const p = tb.winPoints || {};
      const y = yuko ? ' · Yuko ' + p.yuko : '';
      if (tb.scheme === 'ijf')
        return tx('IJF: Punkte für beide Kämpfer – Ippon {i} · Waza-ari {w}{y} (max. 100 je Kampf) · Rangfolge: Siege, Punkte, direkter Vergleich, kürzere Kampfzeit', { i: p.ippon, w: p.wazaari, y });
      if (tb.scheme === 'custom') {
        const order = tb.rankOrder === 'direct' ? tx('bei gleichen Siegen entscheidet der direkte Vergleich, dann die Wertungspunkte') : tx('bei gleichen Siegen entscheiden die Wertungspunkte, dann der direkte Vergleich');
        return tx('Wertungspunkte je Sieg: Ippon {i} · Waza-ari {w}{y} · Entscheidung {d}', { i: p.ippon, w: p.wazaari, y, d: p.decision }) + ' · ' + order;
      }
      return tx('DJB: Wertungspunkte für den Sieger – Ippon {i} · Waza-ari {w}{y} · Hantei 0 · Rangfolge: Siegpunkte, Wertungspunkte, direkter Vergleich', { i: p.ippon, w: p.wazaari, y });
    }

    // Aufrufzeile oben über die ganze Breite; blinkt kurz, wenn ein neuer Aufruf kommt
    let lastCall = '';
    function renderCallBar(c) {
      const msg = (c && c.message) || '';
      const bar = $('.jb-callbar');
      bar.classList.toggle('on', !!msg);
      $('.jb-cb-msg').textContent = msg;
      if (msg && msg !== lastCall) {
        bar.classList.remove('flash');
        void bar.offsetWidth;
        bar.classList.add('flash');
      }
      lastCall = msg;
    }

    // Mannschaftskampf: Stand unter der Kopfzeile
    function renderTeam(tm, s) {
      const on = !!tm && s.level !== 'simple';
      container.classList.toggle('is-team', on);
      if (!on) return;
      const bar = $('.jb-teambar');
      const side = (k, lbl) => {
        const x = tm[k];
        bar.querySelector(`.jb-tm.${k === 'white' ? 'w' : 'b'} b`).textContent = x.name || tx(lbl);
        bar.querySelector(`.jb-tm.${k === 'white' ? 'w' : 'b'} small`).textContent = tx('{side} · {wins} Siege · {points} Wertungspunkte', { side: tx(lbl), wins: x.wins, points: x.points });
      };
      side('white', 'Weiß');
      side('blue', 'Blau');
      bar.querySelector('.jb-tm-score b').textContent = `${tm.white.wins} : ${tm.blue.wins}`;
      let sub = '';
      if (tm.winner === 'draw') sub = tx('Unentschieden');
      else if (tm.winner) sub = tx('Sieger: {name}', { name: tm[tm.winner].name || tx(tm.winner === 'white' ? 'Weiß' : 'Blau') });
      else if (tm.current) sub = tx('Kampf {n} von {m}', { n: tm.current, m: tm.total });
      else sub = tx('{n} von {m} Kämpfen', { n: tm.done, m: tm.total });
      bar.querySelector('.jb-tm-score small').textContent = sub;
      bar.classList.toggle('won-white', tm.winner === 'white');
      bar.classList.toggle('won-blue', tm.winner === 'blue');
    }

    // Trainingsmodus: feste Teile; die Uhr zählt loop() herunter
    let lastTrainSound = null;
    function renderTraining(tr, s) {
      if (!tr) return;
      const box = $('.jb-train');
      const fmt = (sec) => Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');
      $('.jb-tr-title').textContent = tx('Training') + ' · ' + tx(tr.name);
      $('.jb-tr-sum').textContent = `${tr.rounds} × ${fmt(tr.roundSec)}` + (tr.pauseSec ? ' · ' + tx('Pause {t}', { t: fmt(tr.pauseSec) }) : '');
      const last = tr.round >= tr.rounds;
      let next = '';
      if (tr.phase === 'round') next = last ? tx('Ende') : tr.pauseSec ? [tx('Pause {t}', { t: fmt(tr.pauseSec) }), tx(tr.pauseNote)].filter(Boolean).join(' · ') : tx('Runde {n}', { n: tr.round + 1 });
      else if (tr.phase === 'pause') next = [tx('Runde {n}', { n: tr.round + 1 }), tx(tr.roundNote)].filter(Boolean).join(' · ');
      else if (tr.phase === 'ready') next = [tx('Runde {n}', { n: 1 }), tx(tr.roundNote)].filter(Boolean).join(' · ');
      $('.jb-tr-next small').textContent = next ? tx('danach') : '';
      $('.jb-tr-next b').textContent = tr.phase === 'ready' ? '' : next;
      const label = { ready: tx('BEREIT'), round: 'HAJIME', pause: tx('PAUSE'), done: 'SOREMADE' }[tr.phase] || '';
      $('.jb-tr-phase').textContent = label;
      $('.jb-tr-round').textContent = tr.phase === 'done' ? tx('Training beendet') : tx('Runde {n} von {m}', { n: tr.phase === 'pause' ? tr.round : tr.round, m: tr.rounds });
      $('.jb-tr-note').textContent = tr.phase === 'round' ? tx(tr.roundNote || '') : tr.phase === 'pause' ? tx(tr.pauseNote || '') : '';
      const dots = tr.rounds <= 24 ? Array.from({ length: tr.rounds }, (_, i) => {
        const n = i + 1;
        const cls = tr.phase === 'done' || n < tr.round || (n === tr.round && tr.phase === 'pause') ? 'done' : n === tr.round && tr.phase === 'round' ? 'cur' : '';
        return `<i class="${cls}"></i>`;
      }).join('') : '';
      const dEl = $('.jb-tr-dots');
      if (dEl.innerHTML !== dots) dEl.innerHTML = dots;
      box.classList.toggle('ph-ready', tr.phase === 'ready');
      box.classList.toggle('ph-round', tr.phase === 'round');
      box.classList.toggle('ph-pause', tr.phase === 'pause');
      box.classList.toggle('ph-done', tr.phase === 'done');
      box.classList.toggle('running', !!tr.running);
      // Ton der Trainingsuhr im Publikumsfenster
      const snd = tr.sound;
      const key = snd ? snd.id + ':' + snd.at : null;
      if (snd && key !== lastTrainSound) {
        lastTrainSound = key;
        const wanted = s.soundOn && (s.soundTarget === 'board' || s.soundTarget === 'both');
        if (opts.sound && wanted && Date.now() - snd.at < 2500 && root.JudoSound) root.JudoSound.play(snd.kind);
      } else if (!snd) lastTrainSound = null;
    }
    function tickTraining(now) {
      const tr = view.training;
      const left = tr.running ? Math.max(0, tr.endsAt - now) : tr.leftMs;
      const sec = Math.ceil(left / 1000 - 1e-6);
      const txt = Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');
      const el = $('.jb-tr-time');
      if (el.textContent !== txt) el.textContent = txt;
      $('.jb-train').classList.toggle('warn', tr.phase === 'round' && left <= 10000 && tr.roundSec > 20);
      const pct = tr.phase === 'done' ? 100 : tr.phase === 'ready' ? 0 : Math.min(100, Math.max(0, 100 - (left / (tr.totalMs || 1)) * 100));
      $('.jb-tr-bar i').style.width = pct + '%';
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
      if (view.screen === 'training' && view.training) return tickTraining(Date.now());
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
