/*
 * Verbindung Bedienfenster <-> Anzeigefenster.
 * Electron: IPC über preload.js (window.judoBridge).
 * Browser (Notbetrieb ohne Installation): Popup-Fenster + postMessage.
 */
(function (root) {
  'use strict';
  const E = root.judoBridge || null;
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

  function openBoardBrowser() {
    const w = root.open('board.html', 'judoBoard', 'popup=yes,width=1280,height=720');
    if (w) boardWin = w;
    return !!w;
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
    boardListen,
    toggleFullscreen,
    send,
    openBoardBrowser,
    boardOpen: () => !!(boardWin && !boardWin.closed),
    setOnNeedView: (fn) => (onNeedView = fn),
    saveFile,
  };
})(typeof self !== 'undefined' ? self : this);
