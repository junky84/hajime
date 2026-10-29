/*
 * Verbindung Bedienfenster <-> Anzeigefenster.
 * Electron: IPC über preload.js (window.judoBridge).
 * Browser (Webversion und „Hajime für Windows“): Popup-Fenster + postMessage.
 */
(function (root) {
  'use strict';
  const E = root.judoBridge || null;
  let tr = (s) => s; // Übersetzung (setzt die Bedienung)
  const isElectron = !!E;

  /* ----- Anzeige-Seite ----- */
  function boardListen(cb) {
    if (isElectron) {
      E.onView(cb);
      E.boardReady();
      return;
    }
    let received = false;
    root.addEventListener('message', (e) => {
      if (e.data && e.data.type === 'judo-view') {
        received = true;
        cb(e.data.view);
      }
    });
    const hello = () => {
      try {
        if (root.opener && !root.opener.closed) root.opener.postMessage({ type: 'judo-board-hello', needView: !received }, '*');
      } catch (err) {
        /* Bedienfenster weg */
      }
    };
    hello();
    setInterval(hello, 2000);
  }

  function toggleFullscreen() {
    if (isElectron) return E.toggleBoardFullscreen();
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen().catch(() => {});
  }

  /* ----- Bedien-Seite ----- */
  let boardWin = null;
  let onNeedView = null;
  if (!isElectron) {
    root.addEventListener('message', (e) => {
      if (!e.data || e.data.type !== 'judo-board-hello') return;
      const isNew = boardWin !== e.source;
      boardWin = e.source;
      if ((isNew || e.data.needView) && onNeedView) onNeedView();
    });
  }

  function send(view) {
    if (isElectron) return E.sendView(view);
    if (boardWin && !boardWin.closed) {
      try {
        boardWin.postMessage({ type: 'judo-view', view }, '*');
      } catch (err) {
        boardWin = null;
      }
    }
  }

  /*
   * Bildschirme im Browser (Chrome/Edge: Window Management API).
   * Ohne Erlaubnis oder in anderen Browsern: null – dann öffnet die Anzeige
   * als normales Fenster und wird von Hand verschoben.
   */
  let screenDetails = null;
  const screenId = (s) => `${s.left},${s.top}`;
  async function browserScreens(ask) {
    if (isElectron || typeof root.getScreenDetails !== 'function') return null;
    if (!screenDetails) {
      if (!ask) {
        try {
          const p = await navigator.permissions.query({ name: 'window-management' });
          if (p.state !== 'granted') return null;
        } catch (err) {
          return null;
        }
      }
      try {
        screenDetails = await root.getScreenDetails();
      } catch (err) {
        return null;
      }
    }
    const cur = screenDetails.currentScreen;
    return screenDetails.screens.map((s, i) => {
      const own = s === cur || screenId(s) === screenId(cur);
      const name = (s.label || `${tr('Bildschirm')} ${i + 1}`) + ` (${s.width}×${s.height})`;
      return { id: screenId(s), label: own ? `${name} – ${tr('Bedienung')}` : name, isControl: own, screen: s };
    });
  }
  function onScreensChanged(fn) {
    if (screenDetails) screenDetails.addEventListener('screenschange', fn);
  }

  function geometry(s) {
    return `left=${s.availLeft},top=${s.availTop},width=${s.availWidth},height=${s.availHeight}`;
  }

  // Muss direkt im Klick passieren (sonst blockiert der Browser das Pop-up)
  function openBoardBrowser(screen) {
    if (boardWin && !boardWin.closed) {
      boardWin.focus();
      return true;
    }
    const feat = screen ? `popup=yes,${geometry(screen)}` : 'popup=yes,width=1280,height=720';
    const w = root.open('board.html', 'judoBoard', feat);
    if (w) boardWin = w;
    return !!w;
  }

  function placeBoardBrowser(screen) {
    if (!screen || !boardWin || boardWin.closed) return;
    try {
      boardWin.moveTo(screen.availLeft, screen.availTop);
      boardWin.resizeTo(screen.availWidth, screen.availHeight);
      boardWin.focus();
    } catch (err) {
      /* Browser verbietet das Verschieben */
    }
  }

  // Mehrere Dateien: App fragt einmal nach dem Ordner, Browser lädt nacheinander herunter
  async function saveFiles(files) {
    if (isElectron && E.saveFiles) return E.saveFiles(files.map((f) => ({ name: f.name, bytes: f.bytes })));
    for (const f of files) {
      await saveFile(f.name, f.bytes);
      await new Promise((r) => setTimeout(r, 400));
    }
    return true;
  }

  async function saveFile(name, bytes, mime) {
    if (isElectron) return E.saveFile(name, bytes);
    const blob = new Blob([bytes], { type: mime || 'application/octet-stream' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 1000);
    return true;
  }

  root.JudoTransport = {
    isElectron,
    bridge: E,
    // Matten im Netz: Electron-App oder „Hajime für Windows“ (native.js); die reine Webversion hat keins
    netBridge: E || root.judoNative || null,
    boardListen,
    toggleFullscreen,
    send,
    openBoardBrowser,
    placeBoardBrowser,
    browserScreens,
    onScreensChanged,
    boardOpen: () => !!(boardWin && !boardWin.closed),
    setOnNeedView: (fn) => (onNeedView = fn),
    saveFile,
    saveFiles,
    setTranslator: (fn) => (tr = fn),
  };
})(typeof self !== 'undefined' ? self : this);
