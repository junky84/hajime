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
});
