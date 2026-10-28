/* SnapCompass Desktop — Electron main process */
const { app, BrowserWindow, ipcMain, desktopCapturer, Tray, Menu, globalShortcut, screen, nativeImage, dialog } = require('electron');
const path = require('path');

let mainWindow = null;
let regionWin = null;
let tray = null;

function iconPath() {
  return path.join(__dirname, 'build', 'icon.png');
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0d0f24',
    title: 'SnapCompass',
    icon: iconPath(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true
    }
  });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.on('closed', () => { mainWindow = null; });

  // Save dialog for anchor downloads (PNG/JPG/PDF/video exports)
  mainWindow.webContents.session.on('will-download', (event, item) => {
    const target = dialog.showSaveDialogSync(mainWindow, {
      defaultPath: path.join(app.getPath('pictures'), item.getFilename() || 'snapcompass')
    });
    if (target) item.setSavePath(target);
    else item.cancel();
  });
}

/* ------------------------------------------------------------- capture */

async function captureFullScreen() {
  const display = screen.getPrimaryDisplay();
  const thumbW = Math.round(display.bounds.width * display.scaleFactor);
  const thumbH = Math.round(display.bounds.height * display.scaleFactor);
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: thumbW, height: thumbH }
  });
  const src = sources.find((s) => s.display_id === String(display.id)) || sources[0];
  if (!src) throw new Error('No screen source found');
  const img = src.thumbnail;
  return {
    dataUrl: img.toDataURL(),
    dpr: img.getSize().width / display.bounds.width
  };
}

function closeRegionWindow() {
  if (regionWin && !regionWin.isDestroyed()) regionWin.close();
  regionWin = null;
}

function startRegionCapture() {
  if (regionWin) return;
  const display = screen.getPrimaryDisplay();
  const { x, y, width, height } = display.bounds;
  regionWin = new BrowserWindow({
    x, y, width, height,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true
    }
  });
  regionWin.setAlwaysOnTop(true, 'screen-saver');
  regionWin.loadFile(path.join(__dirname, 'renderer', 'region.html'));
  regionWin.once('closed', () => { regionWin = null; });
}

ipcMain.handle('capture-screen', async () => {
  return captureFullScreen();
});

ipcMain.handle('capture-region-start', () => {
  startRegionCapture();
});

ipcMain.on('region-cancelled', () => {
  closeRegionWindow();
});

ipcMain.on('region-selected', async (event, rect) => {
  const display = screen.getPrimaryDisplay();
  closeRegionWindow();
  try {
    const thumbW = Math.round(display.bounds.width * display.scaleFactor);
    const thumbH = Math.round(display.bounds.height * display.scaleFactor);
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: thumbW, height: thumbH }
    });
    const src = sources.find((s) => s.display_id === String(display.id)) || sources[0];
    if (!src) return;
    const img = src.thumbnail;
    const size = img.getSize();
    const scale = size.width / display.bounds.width;
    const crop = {
      x: Math.max(0, Math.round(rect.x * scale)),
      y: Math.max(0, Math.round(rect.y * scale)),
      width: Math.max(1, Math.min(size.width, Math.round(rect.w * scale))),
      height: Math.max(1, Math.min(size.height, Math.round(rect.h * scale)))
    };
    const cropped = img.crop(crop);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.focus();
      mainWindow.webContents.send('screenshot', {
        dataUrl: cropped.toDataURL(),
        dpr: scale
      });
    }
  } catch (e) {
    console.error('region capture failed', e);
  }
});

ipcMain.handle('get-desktop-sources', async () => {
  const sources = await desktopCapturer.getSources({
    types: ['screen', 'window'],
    thumbnailSize: { width: 320, height: 180 },
    fetchWindowIcons: true
  });
  return sources.map((s) => ({
    id: s.id,
    name: s.name,
    thumbnail: s.thumbnail.isEmpty() ? null : s.thumbnail.toDataURL()
  }));
});

/* ------------------------------------------------------------ tray etc */

function createTray() {
  const icon = nativeImage.createFromPath(iconPath()).resize({ width: 16, height: 16 });
  tray = new Tray(icon);
  tray.setToolTip('SnapCompass');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '截取全屏', click: async () => {
        try {
          const shot = await captureFullScreen();
          if (mainWindow) {
            mainWindow.show(); mainWindow.focus();
            mainWindow.webContents.send('screenshot', shot);
          }
        } catch (e) { console.error(e); }
      } },
    { label: '框选截图 (Ctrl+Shift+X)', click: () => startRegionCapture() },
    { type: 'separator' },
    { label: '显示主窗口', click: () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } } },
    { type: 'separator' },
    { label: '退出', click: () => app.quit() }
  ]));
  tray.on('click', () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } });
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  createMainWindow();
  createTray();
  globalShortcut.register('Control+Shift+X', () => startRegionCapture());

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});
