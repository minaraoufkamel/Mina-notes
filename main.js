// Electron entry point: opens the board app in a native macOS window.
const { app, BrowserWindow, shell, session, Menu } = require('electron');
const path = require('path');

let win = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 720,
    minHeight: 480,
    title: 'Boards',
    titleBarStyle: 'default',
    backgroundColor: '#efeeeb',
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
    },
  });

  win.loadFile(path.join(__dirname, 'index.html'));
  win.once('ready-to-show', () => win.show());

  // Links on cards (target=_blank) open in the default browser, not inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:|^mailto:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  // Block navigating the app window away from the local page.
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file://')) { e.preventDefault(); if (/^https?:/.test(url)) shell.openExternal(url); }
  });

  win.on('closed', () => { win = null; });
}

// Single instance: focus the existing window instead of opening a second copy.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });

  app.whenReady().then(() => {
    // Allow microphone (audio cards) and clipboard; deny everything else.
    session.defaultSession.setPermissionRequestHandler((wc, permission, cb) => {
      cb(['media', 'clipboard-read', 'clipboard-sanitized-write'].includes(permission));
    });
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { role: 'appMenu' },
      { role: 'fileMenu' },
      { role: 'editMenu' },
      {
        label: 'View',
        submenu: [
          { role: 'reload' }, { role: 'forceReload' }, { role: 'toggleDevTools' },
          { type: 'separator' }, { role: 'togglefullscreen' },
        ],
      },
      { role: 'windowMenu' },
    ]));
    createWindow();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });

  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}
