// Billaura desktop shell: serves the bundled web app from a secure custom scheme,
// so localStorage, fetch and Supabase behave exactly as they do on the website.
const { app, BrowserWindow, protocol, net, shell, Menu } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');

const APP_DIR = path.join(__dirname, 'app');

protocol.registerSchemesAsPrivileged([
  { scheme: 'billaura', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }
]);

function createWindow() {
  const win = new BrowserWindow({
    width: 1360, height: 860, minWidth: 980, minHeight: 640,
    backgroundColor: '#E8173C',
    title: 'Billaura',
    icon: path.join(__dirname, 'build', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, sandbox: true, spellcheck: false }
  });
  Menu.setApplicationMenu(null);
  win.loadURL('billaura://app/index.html');
  // links to other sites (WhatsApp, store links, etc.) open in the normal browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:|^mailto:|^tel:|^whatsapp:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('billaura://')) { e.preventDefault(); if (/^https?:/i.test(url)) shell.openExternal(url); }
  });
}

app.whenReady().then(() => {
  protocol.handle('billaura', req => {
    let p = decodeURIComponent(new URL(req.url).pathname);
    if (p === '/' || p === '') p = '/index.html';
    const file = path.normalize(path.join(APP_DIR, p));
    if (!file.startsWith(APP_DIR)) return new Response('Forbidden', { status: 403 });
    return net.fetch(pathToFileURL(file).toString());
  });
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

// one window only
if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => { const w = BrowserWindow.getAllWindows()[0]; if (w) { if (w.isMinimized()) w.restore(); w.focus(); } });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
