// Electron-Hauptprozess: Bedienfenster + Publikumsanzeige auf dem zweiten Bildschirm.
const { app, BrowserWindow, ipcMain, screen, Menu, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');

const isMac = process.platform === 'darwin';
let controlWin = null;
let boardWin = null;
let lastView = null;
let quitting = false;

// Portable Windows-Version: Daten neben der .exe ablegen statt im Benutzerprofil
if (process.env.PORTABLE_EXECUTABLE_DIR) {
  app.setPath('userData', path.join(process.env.PORTABLE_EXECUTABLE_DIR, 'Judo-Anzeigetafel-Daten'));
}

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
    title: 'Judo-Anzeigetafel – Anzeige',
    backgroundColor: '#000000',
    autoHideMenuBar: true,
    fullscreenable: true,
    webPreferences: webPrefs,
  });
  boardWin.setMenuBarVisibility(false);
  boardWin.loadFile(path.join(__dirname, 'src', 'board.html'));
  boardWin.once('ready-to-show', () => {
    placeBoard(targetDisplay(displayId));
    boardWin.showInactive();
    if (controlWin) controlWin.focus();
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
    title: 'Judo-Anzeigetafel – Bedienung',
    backgroundColor: '#0f1218',
    show: false,
    webPreferences: webPrefs,
  });
  controlWin.loadFile(path.join(__dirname, 'src', 'control.html'));
  controlWin.once('ready-to-show', () => {
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
      message: 'Judo-Anzeigetafel beenden?',
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
  const template = [
    ...(isMac ? [{ role: 'appMenu', label: 'Judo-Anzeigetafel' }] : []),
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
    ...(isMac ? [{ role: 'windowMenu', label: 'Fenster' }] : []),
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
  if (process.env.JUDO_SCREENSHOTS) {
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
  if (process.env.JUDO_SELFTEST) {
    setTimeout(async () => {
      const out = process.env.JUDO_SELFTEST;
      try {
        if (controlWin) fs.writeFileSync(path.join(out, 'control.png'), (await controlWin.webContents.capturePage()).toPNG());
        if (boardWin) fs.writeFileSync(path.join(out, 'board.png'), (await boardWin.webContents.capturePage()).toPNG());
      } catch (err) {
        console.error(err);
      }
      quitting = true;
      app.quit();
    }, Number(process.env.JUDO_SELFTEST_DELAY || 3500));
  }
});

app.on('before-quit', () => {
  quitting = true;
});
app.on('window-all-closed', () => app.quit());
