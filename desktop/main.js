/**
 * Emberwake desktop app (Electron). Starts the bundled game server, so the
 * app can host LAN games, then opens the game in its own window.
 */
const { app, BrowserWindow, shell, Menu } = require('electron');
const path = require('node:path');

if (!app.requestSingleInstanceLock()) app.quit();

let win = null;

async function createWindow() {
  const { start } = require('../server.js');
  // Port 8080 if free, so friends can use the usual address; otherwise any free port.
  const port = await start(8080);

  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 500,
    title: 'Emberwake',
    backgroundColor: '#0b0807',
    icon: path.join(__dirname, '..', 'assets', 'icons', 'icon-512.png'),
    autoHideMenuBar: true,
    show: false,
    webPreferences: { contextIsolation: true, sandbox: true },
  });
  Menu.setApplicationMenu(null);

  // Links that leave the game (help pages, Node.js, etc.) open in the browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\/[^/]*\.firebaseapp\.com\//.test(url)) return { action: 'allow' };
    shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(`http://localhost:${port}/`)) { e.preventDefault(); shell.openExternal(url); }
  });
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && input.key === 'F11') win.setFullScreen(!win.isFullScreen());
  });

  win.once('ready-to-show', () => win.show());
  await win.loadURL(`http://localhost:${port}/play.html`);
}

app.on('second-instance', () => {
  if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
});
app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
