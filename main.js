// Electron-Hauptprozess: Bedienfenster + Publikumsanzeige auf dem zweiten Bildschirm.
const { app, BrowserWindow, ipcMain, screen, Menu, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');

const isMac = process.platform === 'darwin';

// Sprache für Menü und Dialoge: Sprachdateien wie im Fenster (src/lang/*.js)
require('./src/js/i18n.js');
const I18N = globalThis.HajimeI18n;
try {
  fs.readdirSync(path.join(__dirname, 'src', 'lang'))
    .filter((f) => f.endsWith('.js'))
    .forEach((f) => require(path.join(__dirname, 'src', 'lang', f)));
} catch (err) {
  /* ohne Übersetzungen: Deutsch */
}
let tm = I18N.make('de');
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
    dialog.showErrorBox(tm('Hajime – Fehler'), String(err && err.stack ? err.stack : err));
  } catch (e) {
    /* vor app.ready nicht möglich */
  }
});

// Zweite Instanz zum Testen der Vernetzung auf einem Rechner: HAJIME_USERDATA=<Ordner>
if (process.env.HAJIME_USERDATA) app.setPath('userData', path.resolve(process.env.HAJIME_USERDATA));
// Screenshots nie mit den echten Daten der App: eigener, frischer Ordner
else if (process.env.HAJIME_SCREENSHOTS) {
  const shotData = path.join(require('os').tmpdir(), 'hajime-screenshots');
  fs.rmSync(shotData, { recursive: true, force: true });
  app.setPath('userData', shotData);
}

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
    if (d.id === primary.id) tags.push(tm('Haupt'));
    if (d.id === ctrl.id) tags.push(tm('Bedienung'));
    const name = d.label ? ` ${d.label}` : '';
    return {
      id: d.id,
      label: `${tm('Bildschirm')} ${i + 1}:${name} ${d.size.width}×${d.size.height}${tags.length ? ' (' + tags.join(', ') + ')' : ''}`,
      isControl: d.id === ctrl.id,
      isBoard: !!brd && d.id === brd.id,
    };
  });
}

function isFullscreen(win) {
  if (!win || win.isDestroyed()) return false;
  return isMac ? win.isSimpleFullScreen() || win.isFullScreen() : win.isFullScreen();
}
function setFullscreen(win, flag) {
  if (!win || win.isDestroyed()) return;
  // macOS: "einfaches" Vollbild ohne eigenen Space – zuverlässiger auf dem Zweitbildschirm
  if (isMac) win.setSimpleFullScreen(flag);
  else win.setFullScreen(flag);
  setTimeout(sendBoardStatus, 300);
}
const boardIsFullscreen = () => isFullscreen(boardWin);
const setBoardFullscreen = (flag) => setFullscreen(boardWin, flag);

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
    title: tm('Hajime – Anzeige'),
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
    title: tm('Hajime – Bedienung'),
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
      buttons: [tm('Beenden'), tm('Abbrechen')],
      defaultId: 1,
      cancelId: 1,
      title: tm('Beenden'),
      message: tm('Hajime beenden?'),
      detail: tm('Der aktuelle Stand ist gespeichert und wird beim nächsten Start wiederhergestellt.'),
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
  const about = { label: tm('Über Hajime'), click: () => sendMenu('about') };
  const template = [
    ...(isMac
      ? [
          {
            label: 'Hajime',
            submenu: [
              about,
              { type: 'separator' },
              { role: 'services', label: tm('Dienste') },
              { type: 'separator' },
              { role: 'hide', label: tm('Hajime ausblenden') },
              { role: 'hideOthers', label: tm('Andere ausblenden') },
              { role: 'unhide', label: tm('Alle einblenden') },
              { type: 'separator' },
              { role: 'quit', label: tm('Hajime beenden') },
            ],
          },
        ]
      : []),
    {
      label: tm('Bearbeiten'),
      submenu: [
        { label: tm('Rückgängig'), accelerator: 'CmdOrCtrl+Z', click: () => sendMenu('undo') },
        { type: 'separator' },
        { role: 'cut', label: tm('Ausschneiden') },
        { role: 'copy', label: tm('Kopieren') },
        { role: 'paste', label: tm('Einfügen') },
        { role: 'selectAll', label: tm('Alles auswählen') },
      ],
    },
    {
      label: tm('Anzeige'),
      submenu: [
        { label: tm('Anzeige öffnen'), click: () => createBoard() },
        { label: tm('Anzeige Vollbild an/aus'), accelerator: 'CmdOrCtrl+F', click: () => setBoardFullscreen(!boardIsFullscreen()) },
        { type: 'separator' },
        { role: 'toggleDevTools', label: tm('Entwicklerwerkzeuge') },
      ],
    },
    ...(isMac ? [{ role: 'windowMenu', label: tm('Fenster') }] : [{ label: tm('Hilfe'), submenu: [about] }]),
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
// Sprache der Bedienung: Menü und Dialoge folgen
ipcMain.on('set-lang', (_e, lang) => {
  if (tm.lang === I18N.resolve(lang)) return;
  tm = I18N.make(lang);
  buildMenu();
  if (boardWin && !boardWin.isDestroyed()) boardWin.setTitle(tm('Hajime – Anzeige'));
  if (controlWin && !controlWin.isDestroyed()) controlWin.setTitle(tm('Hajime – Bedienung'));
});
ipcMain.handle('app-version', () => app.getVersion());
// Aushang, Siegerliste, Urkunden: HTML in einem unsichtbaren Fenster als PDF ausgeben, speichern und öffnen.
// Über eine temporäre Datei statt data:-URL, weil Urkunden mit Hintergrundbild zu groß für eine URL werden.
ipcMain.handle('save-pdf', async (_e, { name, html, size, landscape }) => {
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, javascript: false } });
  const tmp = path.join(app.getPath('temp'), `hajime-druck-${process.pid}-${Date.now()}.html`);
  try {
    fs.writeFileSync(tmp, html, 'utf8');
    await win.loadFile(tmp);
    const pdf = await win.webContents.printToPDF({
      landscape: landscape !== false,
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
    fs.rm(tmp, { force: true }, () => {});
  }
});
ipcMain.handle('board-show', (_e, opts) => createBoard(opts && opts.displayId));
// Vollbild: aus der Bedienung oder der Anzeige gilt es immer für die Anzeige
const fsTarget = (e) => {
  const w = BrowserWindow.fromWebContents(e.sender);
  return w && w !== controlWin ? w : boardWin;
};
ipcMain.handle('board-fullscreen-toggle', (e) => {
  const w = fsTarget(e);
  setFullscreen(w, !isFullscreen(w));
});
ipcMain.handle('board-fullscreen', (e, flag) => setFullscreen(fsTarget(e), !!flag));
ipcMain.handle('save-files', async (_e, files) => {
  const res = await dialog.showOpenDialog(controlWin, {
    title: tm('Ordner für die Dateien wählen'),
    defaultPath: app.getPath('documents'),
    properties: ['openDirectory', 'createDirectory'],
    buttonLabel: tm('Hier speichern'),
  });
  if (res.canceled || !res.filePaths[0]) return false;
  const dir = res.filePaths[0];
  const exist = files.filter((f) => fs.existsSync(path.join(dir, path.basename(f.name))));
  if (exist.length) {
    const c = dialog.showMessageBoxSync(controlWin, {
      type: 'question',
      buttons: [tm('Ersetzen'), tm('Abbrechen')],
      defaultId: 0,
      cancelId: 1,
      message: tm('Dateien ersetzen?'),
      detail: tm('{files} gibt es in diesem Ordner schon.', { files: exist.map((f) => f.name).join(', ') }),
    });
    if (c !== 0) return false;
  }
  files.forEach((f) => fs.writeFileSync(path.join(dir, path.basename(f.name)), Buffer.from(f.bytes)));
  shell.openPath(dir);
  return true;
});
ipcMain.handle('save-file', async (_e, { name, bytes }) => {
  const res = await dialog.showSaveDialog(controlWin, {
    defaultPath: path.join(app.getPath('documents'), name),
  });
  if (res.canceled || !res.filePath) return false;
  fs.writeFileSync(res.filePath, Buffer.from(bytes));
  return true;
});

/* ---------- Matten im Netz ---------- */

const NET = require('./hub');
let hub = null;
let finder = null;
const sendControl = (ch, data) => controlWin && !controlWin.isDestroyed() && controlWin.webContents.send(ch, data);
ipcMain.handle('hub-start', async (_e, opts) => {
  if (hub) {
    hub.update({ code: String(opts.code), tournament: opts.tournament || '' });
    return { port: hub.port(), addresses: hub.addresses(), name: hub.name() };
  }
  const h = NET.createHub({
    code: String(opts.code),
    tournament: opts.tournament || '',
    name: opts.name || require('os').hostname().replace(/\.local$/, ''),
    version: app.getVersion(),
    log,
    onMat: (ev) => sendControl('hub-event', ev),
  });
  try {
    const r = await h.start();
    hub = h;
    return r;
  } catch (err) {
    await h.stop();
    throw err;
  }
});
ipcMain.handle('hub-stop', async () => {
  if (hub) await hub.stop();
  hub = null;
});
ipcMain.handle('hub-send', (_e, id, msg) => (hub ? hub.send(id, msg) : false));
ipcMain.on('hub-overview', (_e, data) => hub && hub.setOverview(data));
ipcMain.handle('finder-start', () => {
  if (!finder) finder = NET.createFinder((list) => sendControl('hubs-found', list), log);
  else finder.rescan();
  return finder.list();
});
ipcMain.handle('finder-stop', () => {
  if (finder) finder.stop();
  finder = null;
});
ipcMain.handle('open-external', (_e, url) => {
  if (/^https?:\/\//.test(String(url))) shell.openExternal(url);
});

/* ---------- Start ---------- */

app.on('web-contents-created', (_e, wc) => {
  wc.on('render-process-gone', (_ev, d) => log(`Fensterprozess beendet: ${d.reason} (${d.exitCode})`));
  wc.on('did-fail-load', (_ev, code, desc, url) => log(`Laden fehlgeschlagen: ${code} ${desc} ${url}`));
  wc.on('did-finish-load', () => log('geladen: ' + wc.getURL().split('/').pop()));
});

app.whenReady().then(() => {
  tm = I18N.make(String(app.getLocale() || '').slice(0, 2));
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
  if (hub) hub.stop();
  if (finder) finder.stop();
});
app.on('window-all-closed', () => app.quit());
