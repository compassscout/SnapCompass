/* SnapCompass Desktop — preload bridge */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('snapApi', {
  captureScreen: () => ipcRenderer.invoke('capture-screen'),
  captureRegionStart: () => ipcRenderer.invoke('capture-region-start'),
  getDesktopSources: () => ipcRenderer.invoke('get-desktop-sources'),
  onScreenshot: (cb) => ipcRenderer.on('screenshot', (_e, payload) => cb(payload)),
  // used by the region-selection overlay window
  sendRegionSelected: (rect) => ipcRenderer.send('region-selected', rect),
  sendRegionCancelled: () => ipcRenderer.send('region-cancelled')
});
