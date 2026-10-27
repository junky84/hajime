// Electron-Hauptprozess: Bedienfenster + Publikumsanzeige auf dem zweiten Bildschirm.
const { app, BrowserWindow, ipcMain, screen, Menu, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');

const isMac = process.platform === 'darwin';
let controlWin = null;
let boardWin = null;
let lastView = null;
let quitting = false;

const selftestDir = process.env.HAJIME_SELFTEST || '';
function log(msg) {
  if (!selftestDir) return;
  try {
    fs.appendFileSync(path.join(selftestDir, 'selftest.log'), `[${process.uptime().toFixed(2)} s] ${msg}\n`);
  } catch (err) {
    /* Protokoll ist nur Zusatz */
  }
}
log(`Start ${process.platform} ${process.arch} Electron ${process.versions.electron} exe=${process.execPath}`);

// Fehler nicht stillschweigend schlucken: anzeigen (und im Test protokollieren)
process.on('uncaughtException', (err) => {
  log('FEHLER: ' + (err && err.stack ? err.stack : err));
  try {
    dialog.showErrorBox('Hajime – Fehler', String(err && err.stack ? err.stack : err));
  } catch (e) {
    /* vor app.ready nicht möglich */
  }
});

// Portable Windows-Version: Daten neben der .exe ablegen statt im Benutzerprofil –
// nur wenn der Ordner beschreibbar ist (z. B. nicht direkt aus einem ZIP oder schreibgeschützten Stick).
if (process.env.PORTABLE_EXECUTABLE_DIR) {
  const dataDir = path.join(process.env.PORTABLE_EXECUTABLE_DIR, 'Hajime-Daten');
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.accessSync(dataDir, fs.constants.W_OK);
    app.setPath('userData', dataDir);
  } catch (err) {
    log('Datenordner neben der .exe nicht beschreibbar, nutze Standard: ' + err.message);
  }
}
log('userData=' + app.getPath('userData'));

// Ausweichbetrieb ohne Grafikbeschleunigung (Grafiktreiber-Probleme, virtuelle Maschinen).
// Wird automatisch aktiviert, wenn der Grafikprozess abstürzt; manuell mit Startparameter --no-gpu.
const noGpuFlag = path.join(app.getPath('userData'), 'ohne-grafikbeschleunigung');
const noGpu = process.argv.includes('--no-gpu') || fs.existsSync(noGpuFlag);
if (noGpu) {
  app.disableHardwareAcceleration();
  log('Grafikbeschleunigung aus');
}
app.on('child-process-gone', (_e, d) => {
  log(`Hilfsprozess beendet: ${d.type} ${d.reason} (${d.exitCode})`);
  if (d.type === 'GPU' && !noGpu && !['clean-exit', 'killed'].includes(d.reason)) {
    try {
      fs.mkdirSync(path.dirname(noGpuFlag), { recursive: true });
      fs.writeFileSync(noGpuFlag, 'Grafikprozess abgestürzt: ' + d.reason + '\n');
    } catch (err) {
      /* dann eben nur dieser Neustart */
    }
    quitting = true;
    app.relaunch({ args: process.argv.slice(1).concat('--no-gpu') });
    app.exit(0);
  }
});

const webPrefs = {
  preload: path.join(__dirname, 'preload.js'),
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  backgroundThrottling: false,
  autoplayPolicy: 'no-user-gesture-required',
};

function displayList() {
  const all = screen.getAllDisplays();
  const primary = screen.getPrimaryDisplay();
  const ctrl = controlWin && !controlWin.isDestroyed() ? screen.getDisplayMatching(controlWin.getBounds()) : primary;
  const brd = boardWin && !boardWin.isDestroyed() ? screen.getDisplayMatching(boardWin.getBounds()) : null;
  return all.map((d, i) => {
    const tags = [];
    if (d.id === primary.id) tags.push('Haupt');
    if (d.id === ctrl.id) tags.push('Bedienung');
    const name = d.label ? ` ${d.label}` : '';
    return {
      id: d.id,
      label: `Bildschirm ${i + 1}:${name} ${d.size.width}×${d.size.height}${tags.length ? ' (' + tags.join(', ') + ')' : ''}`,
      isControl: d.id === ctrl.id,
      isBoard: !!brd && d.id === brd.id,
    };
  });
}

function boardIsFullscreen() {
  if (!boardWin || boardWin.isDestroyed()) return false;
  return isMac ? boardWin.isSimpleFullScreen() || boardWin.isFullScreen() : boardWin.isFullScreen();
}

function setBoardFullscreen(flag) {
  if (!boardWin || boardWin.isDestroyed()) return;
  // macOS: "einfaches" Vollbild ohne eigenen Space – zuverlässiger auf dem Zweitbildschirm
  if (isMac) boardWin.setSimpleFullScreen(flag);
  else boardWin.setFullScreen(flag);
  setTimeout(sendBoardStatus, 300);
}

function sendBoardStatus() {
  if (!controlWin || controlWin.isDestroyed()) return;
  const open = !!boardWin && !boardWin.isDestroyed();
  controlWin.webContents.send('board-status', { open, fullscreen: open && boardIsFullscreen() });
}

function targetDisplay(displayId) {
  const all = screen.getAllDisplays();
  if (displayId) {
    const d = all.find((x) => x.id === displayId);
    if (d) return d;
  }
  const ctrl = controlWin ? screen.getDisplayMatching(controlWin.getBounds()) : screen.getPrimaryDisplay();
  return all.find((d) => d.id !== ctrl.id) || null; // null = kein zweiter Bildschirm
}

function placeBoard(display) {
  const ctrl = controlWin ? screen.getDisplayMatching(controlWin.getBounds()) : screen.getPrimaryDisplay();
  const external = display && display.id !== ctrl.id;
  const d = display || ctrl;
  const wa = d.workArea;
  const apply = () => {
    if (external) {
      boardWin.setBounds(d.bounds);
      setBoardFullscreen(true);
    } else {
      // gleicher Bildschirm wie Bedienung: als Fenster (16:9) öffnen
      const w = Math.min(1280, Math.round(wa.width * 0.6));
      const h = Math.round((w * 9) / 16);
      boardWin.setBounds({ x: wa.x + wa.width - w - 20, y: wa.y + 40, width: w, height: h });
    }
    sendBoardStatus();
  };
  if (boardIsFullscreen()) {
    setBoardFullscreen(false);
    setTimeout(apply, isMac ? 400 : 150);
  } else apply();
}

// Fenster sicher anzeigen: auf 'ready-to-show' warten, aber nie länger als 3 s.
// (Auf manchen Windows-Rechnern/VMs kommt 'ready-to-show' nie – dann bliebe alles unsichtbar.)
function whenShowable(win, name, fn) {
  let done = false;
  const go = (why) => {
    if (done || win.isDestroyed()) return;
    done = true;
    log(`${name} anzeigen (${why})`);
    fn();
  };
  win.once('ready-to-show', () => go('ready-to-show'));
  win.webContents.once('did-finish-load', () => setTimeout(() => go('geladen'), 500));
  setTimeout(() => go('Zeitlimit'), 3000);
}

function createBoard(displayId) {
  if (boardWin && !boardWin.isDestroyed()) {
    placeBoard(targetDisplay(displayId));
    boardWin.showInactive();
    return;
  }
  boardWin = new BrowserWindow({
    width: 1280,
    height: 720,
    show: false,
    title: 'Hajime – Anzeige',
    backgroundColor: '#000000',
    autoHideMenuBar: true,
    fullscreenable: true,
    webPreferences: webPrefs,
  });
  boardWin.setMenuBarVisibility(false);
  boardWin.loadFile(path.join(__dirname, 'src', 'board.html'));
  whenShowable(boardWin, 'Anzeige', () => {
    placeBoard(targetDisplay(displayId));
    boardWin.showInactive();
    if (controlWin && !controlWin.isDestroyed()) controlWin.focus();
  });
  boardWin.on('enter-full-screen', sendBoardStatus);
  boardWin.on('leave-full-screen', sendBoardStatus);
  boardWin.on('closed', () => {
    boardWin = null;
    sendBoardStatus();
  });
}

function createControl() {
  const primary = screen.getPrimaryDisplay().workArea;
  controlWin = new BrowserWindow({
    width: Math.min(1500, primary.width),
    height: Math.min(960, primary.height),
    minWidth: 1000,
    minHeight: 640,
    title: 'Hajime – Bedienung',
    backgroundColor: '#0f1218',
    show: false,
    webPreferences: webPrefs,
  });
  controlWin.loadFile(path.join(__dirname, 'src', 'control.html'));
  whenShowable(controlWin, 'Bedienung', () => {
    controlWin.show();
    createBoard();
  });
  controlWin.on('close', (e) => {
    if (quitting) return;
    const choice = dialog.showMessageBoxSync(controlWin, {
      type: 'question',
      buttons: ['Beenden', 'Abbrechen'],
      defaultId: 1,
      cancelId: 1,
      title: 'Beenden',
      message: 'Hajime beenden?',
      detail: 'Der aktuelle Stand ist gespeichert und wird beim nächsten Start wiederhergestellt.',
    });
    if (choice !== 0) e.preventDefault();
    else quitting = true;
  });
  controlWin.on('closed', () => {
    controlWin = null;
    if (boardWin && !boardWin.isDestroyed()) boardWin.destroy();
    app.quit();
  });
  // Links nie im App-Fenster öffnen
  controlWin.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
}

function buildMenu() {
  const sendMenu = (cmd) => controlWin && controlWin.webContents.send('menu', cmd);
  const about = { label: 'Über Hajime', click: () => sendMenu('about') };
  const template = [
    ...(isMac
      ? [
          {
            label: 'Hajime',
            submenu: [
              about,
              { type: 'separator' },
              { role: 'services', label: 'Dienste' },
              { type: 'separator' },
              { role: 'hide', label: 'Hajime ausblenden' },
              { role: 'hideOthers', label: 'Andere ausblenden' },
              { role: 'unhide', label: 'Alle einblenden' },
              { type: 'separator' },
              { role: 'quit', label: 'Hajime beenden' },
            ],
          },
        ]
      : []),
    {
      label: 'Bearbeiten',
      submenu: [
        { label: 'Rückgängig', accelerator: 'CmdOrCtrl+Z', click: () => sendMenu('undo') },
        { type: 'separator' },
        { role: 'cut', label: 'Ausschneiden' },
        { role: 'copy', label: 'Kopieren' },
        { role: 'paste', label: 'Einfügen' },
        { role: 'selectAll', label: 'Alles auswählen' },
      ],
    },
    {
      label: 'Anzeige',
      submenu: [
        { label: 'Anzeige öffnen', click: () => createBoard() },
        { label: 'Anzeige Vollbild an/aus', accelerator: 'CmdOrCtrl+F', click: () => setBoardFullscreen(!boardIsFullscreen()) },
        { type: 'separator' },
        { role: 'toggleDevTools', label: 'Entwicklerwerkzeuge' },
      ],
    },
    ...(isMac ? [{ role: 'windowMenu', label: 'Fenster' }] : [{ label: 'Hilfe', submenu: [about] }]),
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/* ---------- IPC ---------- */

ipcMain.on('view', (_e, v) => {
  lastView = v;
  if (boardWin && !boardWin.isDestroyed()) boardWin.webContents.send('view', v);
});
ipcMain.on('board-ready', (e) => {
  if (lastView) e.sender.send('view', lastView);
});
ipcMain.handle('displays', () => displayList());
ipcMain.handle('app-version', () => app.getVersion());
// Aushang: HTML in einem unsichtbaren Fenster als PDF ausgeben, speichern und öffnen
ipcMain.handle('save-pdf', async (_e, { name, html, size }) => {
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, javascript: false } });
  try {
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    const pdf = await win.webContents.printToPDF({
      landscape: true,
      pageSize: size === 'A3' ? 'A3' : 'A4',
      printBackground: true,
      preferCSSPageSize: true,
    });
    const res = await dialog.showSaveDialog(controlWin, {
      defaultPath: path.join(app.getPath('documents'), name),
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    if (res.canceled || !res.filePath) return false;
    fs.writeFileSync(res.filePath, pdf);
    shell.openPath(res.filePath);
    return true;
  } finally {
    win.destroy();
  }
});
ipcMain.handle('board-show', (_e, opts) => createBoard(opts && opts.displayId));
ipcMain.handle('board-fullscreen-toggle', () => setBoardFullscreen(!boardIsFullscreen()));
ipcMain.handle('board-fullscreen', (_e, flag) => setBoardFullscreen(!!flag));
ipcMain.handle('save-file', async (_e, { name, bytes }) => {
  const res = await dialog.showSaveDialog(controlWin, {
    defaultPath: path.join(app.getPath('documents'), name),
  });
  if (res.canceled || !res.filePath) return false;
  fs.writeFileSync(res.filePath, Buffer.from(bytes));
  return true;
});

/* ---------- Start ---------- */

app.on('web-contents-created', (_e, wc) => {
  wc.on('render-process-gone', (_ev, d) => log(`Fensterprozess beendet: ${d.reason} (${d.exitCode})`));
  wc.on('did-fail-load', (_ev, code, desc, url) => log(`Laden fehlgeschlagen: ${code} ${desc} ${url}`));
  wc.on('did-finish-load', () => log('geladen: ' + wc.getURL().split('/').pop()));
});

app.whenReady().then(() => {
  buildMenu();
  createControl();
  const changed = () => {
    if (controlWin) controlWin.webContents.send('displays-changed');
    // Anzeige-Bildschirm abgezogen? Dann auf die Bedienung holen.
    if (boardWin && !boardWin.isDestroyed()) {
      const b = boardWin.getBounds();
      const visible = screen.getAllDisplays().some((d) => {
        const r = d.bounds;
        return b.x < r.x + r.width && b.x + b.width > r.x && b.y < r.y + r.height && b.y + b.height > r.y;
      });
      if (!visible) placeBoard(null);
    }
  };
  screen.on('display-added', changed);
  screen.on('display-removed', changed);
  screen.on('display-metrics-changed', changed);

  // README-Screenshots (nur Entwicklung, scripts/ ist nicht Teil der fertigen App)
  if (process.env.HAJIME_SCREENSHOTS) {
    require('./scripts/screenshots')({
      getControl: () => controlWin,
      getBoard: () => boardWin,
      quit: () => {
        quitting = true;
        app.quit();
      },
    }).catch((err) => {
      console.error(err);
      quitting = true;
      app.quit();
    });
  }

  // Selbsttest für die Entwicklung: Screenshots beider Fenster, dann beenden
  if (selftestDir) {
    log('ready, Bildschirme: ' + screen.getAllDisplays().length);
    // Langsame Rechner (CI, portable .exe): bis zu 30 s auf die Verbindung warten
    const connected = async () => {
      try {
        return boardWin && !boardWin.isDestroyed() && (await boardWin.webContents.executeJavaScript('document.getElementById("wait").style.display')) === 'none';
      } catch (err) {
        return false;
      }
    };
    setTimeout(async () => {
      try {
        for (let i = 0; i < 60 && !(await connected()); i++) await new Promise((r) => setTimeout(r, 500));
        if (controlWin) fs.writeFileSync(path.join(selftestDir, 'control.png'), (await controlWin.webContents.capturePage()).toPNG());
        if (boardWin) fs.writeFileSync(path.join(selftestDir, 'board.png'), (await boardWin.webContents.capturePage()).toPNG());
        const board = boardWin ? await boardWin.webContents.executeJavaScript('document.getElementById("wait").style.display') : 'kein Fenster';
        log(`Screenshots geschrieben, Anzeige verbunden: ${board === 'none' ? 'ja' : 'NEIN'}`);
      } catch (err) {
        log('FEHLER beim Selbsttest: ' + err.stack);
      }
      quitting = true;
      app.quit();
    }, Number(process.env.HAJIME_SELFTEST_DELAY || 3500));
  }
});

app.on('before-quit', () => {
  quitting = true;
});
app.on('window-all-closed', () => app.quit());
