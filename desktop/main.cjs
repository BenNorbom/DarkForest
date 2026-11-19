const { app, BrowserWindow, dialog, ipcMain, shell, utilityProcess } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('node:path');

let window;
let simulation;
let pageUrl;
let quitting = false;
let update = { phase: app.isPackaged ? 'idle' : 'unavailable' };

function publishUpdate(phase, details) {
  update = { phase, ...details };
  if (window && !window.isDestroyed()) window.webContents.send('updates:state', update);
}

autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = false;
autoUpdater.on('error', (error) => {
  console.error(error);
  if (update.phase === 'installing') publishUpdate('install-error');
});
autoUpdater.on('download-progress', ({ percent }) => {
  if (update.phase === 'downloading') {
    publishUpdate('downloading', { version: update.version, percent: Math.round(percent) });
  }
});

ipcMain.handle('updates:action', async (event, action) => {
  const frame = event.senderFrame;
  if (!frame || event.sender !== window?.webContents || frame.parent ||
      frame.url.split('#', 1)[0] !== pageUrl) {
    throw new Error('Invalid update request');
  }

  try {
    if (action === 'check' && ['idle', 'current', 'error'].includes(update.phase)) {
      publishUpdate('checking');
      const result = await autoUpdater.checkForUpdates();
      if (result?.isUpdateAvailable) publishUpdate('available', { version: result.updateInfo.version });
      else publishUpdate('current', { version: app.getVersion() });
    } else if (action === 'download' && update.phase === 'available') {
      const { version } = update;
      publishUpdate('downloading', { version, percent: 0 });
      await autoUpdater.downloadUpdate();
      publishUpdate('ready', { version });
    } else if (action === 'install' && ['ready', 'install-error'].includes(update.phase)) {
      publishUpdate('installing');
      autoUpdater.quitAndInstall(true, true);
    }
  } catch (error) {
    console.error(error);
    publishUpdate(action === 'install' ? 'install-error' : 'error');
  }

  return update;
});

function showStartupError(error) {
  if (quitting) return;
  console.error(error);
  dialog.showErrorBox('Dark Forest', error.message);
  app.quit();
}

function startSimulation() {
  const root = app.isPackaged ? path.join(process.resourcesPath, 'simulation') : app.getAppPath();
  simulation = utilityProcess.fork(path.join(root, 'server.mjs'), [], {
    env: {
      ...process.env,
      DARK_FOREST_STORE: process.env.DARK_FOREST_STORE || path.join(app.getPath('userData'), 'runs'),
    },
    serviceName: 'Dark Forest Simulation',
  });

  return new Promise((resolve, reject) => {
    simulation.once('message', (port) => resolve(`http://127.0.0.1:${port}/`));
    simulation.once('exit', (code) => {
      const error = new Error(`The Dark Forest simulation stopped (exit code ${code}).`);
      if (pageUrl) showStartupError(error);
      else reject(error);
    });
  });
}

async function openWindow() {
  app.setAppUserModelId('com.bennorbom.darkforest');
  pageUrl = await startSimulation();
  window = new BrowserWindow({
    width: 1440,
    height: 950,
    minWidth: 620,
    minHeight: 560,
    backgroundColor: '#090e16',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  window.removeMenu();
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url === new URL('balance-report.json', pageUrl).href) {
      void shell.openExternal(url).catch(console.error);
    }
    return { action: 'deny' };
  });
  await window.loadURL(pageUrl);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!window || window.isDestroyed()) return;
    if (window.isMinimized()) window.restore();
    window.focus();
  });
  app.on('before-quit', () => {
    quitting = true;
    simulation?.kill();
  });
  app.on('window-all-closed', () => app.quit());
  app.whenReady().then(openWindow).catch(showStartupError);
}
