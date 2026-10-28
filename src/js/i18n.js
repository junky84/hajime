/*
 * Mehrsprachigkeit.
 * Deutsch ist die Ausgangssprache: Die deutschen Texte stehen im Programm und sind
 * zugleich die Schlüssel der Sprachdateien (src/lang/en.js, …). Fehlt eine Übersetzung,
 * gilt Englisch, sonst der deutsche Text. Judo-Begriffe (Hajime, Mate, Ippon …) bleiben japanisch.
 *
 * Neue Sprache: src/lang/en.js kopieren, z. B. als fr.js, Sprachkürzel und Namen in der
 * ersten Zeile ändern, rechte Seite übersetzen und die Datei in control.html und board.html
 * eintragen (nach js/i18n.js).
 */
(function (root) {
  'use strict';
  const dicts = { de: {} };
  const names = { de: 'Deutsch' };

  function register(lang, name, dict) {
    dicts[lang] = Object.assign(dicts[lang] || {}, dict || {});
    if (name) names[lang] = name;
  }

  const languages = () => Object.keys(names).map((id) => ({ id, name: names[id] }));

  // Sprache des Betriebssystems bzw. Browsers, sonst Englisch
  function detect() {
    const nav = root.navigator || {};
    const list = [].concat(nav.languages || [], nav.language || [], (typeof process !== 'undefined' && process.env && (process.env.LANG || '').replace(/[_.].*/, '')) || []);
    for (const l of list) {
      const id = String(l || '').slice(0, 2).toLowerCase();
      if (names[id]) return id;
    }
    return 'en';
  }
  const resolve = (lang) => (lang && names[lang] ? lang : detect());

  function fill(s, params) {
    if (!params) return s;
    return s.replace(/\{(\w+)\}/g, (m, k) => (params[k] == null ? m : String(params[k])));
  }

  // Übersetzungsfunktion für eine Sprache: t('Nächster Kampf'), t('{n} Kämpfe', { n: 3 })
  function make(lang) {
    const id = resolve(lang);
    const own = dicts[id] || {};
    const en = dicts.en || {};
    const t = (key, params) => {
      key = String(key == null ? '' : key);
      const s = id === 'de' ? key : own[key] != null && own[key] !== '' ? own[key] : en[key] != null && en[key] !== '' ? en[key] : key;
      return fill(s, params);
    };
    t.lang = id;
    t.has = (key) => id === 'de' || !!(own[key] || en[key]);
    return t;
  }

  /*
   * Feste Texte einer Seite übersetzen (Textknoten, title, placeholder, aria-label).
   * Der deutsche Ursprungstext wird gemerkt, damit ein Sprachwechsel jederzeit geht.
   * Elemente mit translate="no" bleiben unverändert.
   */
  const orig = typeof WeakMap !== 'undefined' ? new WeakMap() : null;
  const ATTRS = ['title', 'placeholder', 'aria-label', 'label'];
  function translateDom(el, t) {
    if (!el || !orig) return;
    const doc = el.ownerDocument || el;
    const walker = doc.createTreeWalker(el, 1 | 4, {
      acceptNode(n) {
        if (n.nodeType === 1) {
          if (/^(SCRIPT|STYLE|TEXTAREA)$/.test(n.tagName) || n.getAttribute('translate') === 'no') return 2; // ablehnen samt Kindern
          return 1;
        }
        return 1;
      },
    });
    let n = walker.currentNode;
    while (n) {
      if (n.nodeType === 3) {
        const v = n.nodeValue;
        if (/[A-Za-zÄÖÜäöüß]/.test(v)) {
          let src = orig.get(n);
          if (!src || (src.done !== v && src.text !== v)) src = { text: v };
          const m = src.text.match(/^(\s*)([\s\S]*?)(\s*)$/);
          const out = m[1] + t(m[2]) + m[3];
          src.done = out;
          orig.set(n, src);
          if (v !== out) n.nodeValue = out;
        }
      } else if (n.nodeType === 1) {
        ATTRS.forEach((a) => {
          if (!n.hasAttribute(a)) return;
          const key = 'data-i18n-' + a;
          const cur = n.getAttribute(a);
          let src = n.getAttribute(key);
          // Attribut wurde inzwischen vom Programm neu gesetzt: das ist der neue Ursprung
          if (src == null || (n.getAttribute(key + '-done') !== cur && src !== cur)) src = cur;
          const out = t(src);
          n.setAttribute(key, src);
          n.setAttribute(key + '-done', out);
          if (cur !== out) n.setAttribute(a, out);
        });
      }
      n = walker.nextNode();
    }
  }

  root.HajimeI18n = { register, languages, detect, resolve, make, translateDom };
})(typeof globalThis !== 'undefined' ? globalThis : this);
