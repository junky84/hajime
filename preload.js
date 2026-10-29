// Brücke zwischen Fenstern und Hauptprozess (sicher, ohne Node im Renderer).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('judoBridge', {
  // Bedienfenster -> Anzeige
  sendView: (view) => ipcRenderer.send('view', view),
  // Anzeige
  onView: (cb) => ipcRenderer.on('view', (_e, v) => cb(v)),
  boardReady: () => ipcRenderer.send('board-ready'),
  // Fenster- und Bildschirmsteuerung
  getDisplays: () => ipcRenderer.invoke('displays'),
  showBoard: (opts) => ipcRenderer.invoke('board-show', opts),
  toggleBoardFullscreen: () => ipcRenderer.invoke('board-fullscreen-toggle'),
  setBoardFullscreen: (flag) => ipcRenderer.invoke('board-fullscreen', flag),
  onBoardStatus: (cb) => ipcRenderer.on('board-status', (_e, s) => cb(s)),
  onDisplaysChanged: (cb) => ipcRenderer.on('displays-changed', () => cb()),
  onMenu: (cb) => ipcRenderer.on('menu', (_e, cmd) => cb(cmd)),
  // Datei speichern (Excel-Vorlage, Protokoll, Sicherung)
  saveFile: (name, bytes) => ipcRenderer.invoke('save-file', { name, bytes }),
  // mehrere Dateien in einen Ordner (Excel je Matte)
  saveFiles: (files) => ipcRenderer.invoke('save-files', files),
  // Versionsnummer für „Über Hajime“
  appVersion: () => ipcRenderer.invoke('app-version'),
  // Aushang, Siegerliste, Urkunden als PDF speichern
  savePdf: (name, html, size, landscape) => ipcRenderer.invoke('save-pdf', { name, html, size, landscape }),
  // Sprache für Menü und Dialoge
  setLang: (lang) => ipcRenderer.send('set-lang', lang),
  // Zentrale (Matten im Netz)
  hubStart: (opts) => ipcRenderer.invoke('hub-start', opts),
  hubStop: () => ipcRenderer.invoke('hub-stop'),
  hubSend: (id, msg) => ipcRenderer.invoke('hub-send', id, msg),
  hubOverview: (data) => ipcRenderer.send('hub-overview', data),
  onHubEvent: (cb) => ipcRenderer.on('hub-event', (_e, ev) => cb(ev)),
  // Suche nach einer Zentrale im Netz
  finderStart: () => ipcRenderer.invoke('finder-start'),
  finderStop: () => ipcRenderer.invoke('finder-stop'),
  onHubsFound: (cb) => ipcRenderer.on('hubs-found', (_e, list) => cb(list)),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
});
