'use strict';

const { app, BrowserWindow, ipcMain, safeStorage } = require('electron');
const path = require('path');
const ConfigStore = require('./config-store');
const VpnManager = require('./vpn-manager');

let win = null;
let store = null;
const vpn = new VpnManager();

// 単一インスタンス
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: 460,
    height: 360,
    minWidth: 380,
    minHeight: 300,
    useContentSize: true,
    title: 'FortiKeep',
    backgroundColor: '#0f1420',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
}

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

vpn.on('status', (s) => send('vpn:status', s));
vpn.on('log', (line) => send('vpn:log', line));
vpn.on('certSuggested', (digest) => send('vpn:cert', digest));

app.whenReady().then(() => {
  store = new ConfigStore();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  vpn.shutdown();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => vpn.shutdown());

// ---- IPC ----
ipcMain.handle('settings:get', () => store.get());

ipcMain.handle('settings:save', (_e, data) => store.save(data || {}));

ipcMain.handle('secrets:status', () => ({
  encryptionAvailable: (() => { try { return safeStorage.isEncryptionAvailable(); } catch { return false; } })(),
  hasSudo: store.hasSudo(),
}));

ipcMain.handle('vpn:status', () => vpn.getStatus());

ipcMain.handle('vpn:connect', async (_e, sudoPassword, rememberSudo) => {
  const settings = store.get();

  if (!settings.host) return { ok: false, error: '接続先ホストが設定されていません（設定タブ）' };
  if (!settings.binaryPath) return { ok: false, error: 'openfortivpn バイナリパスが未設定です' };

  let sp = sudoPassword || store.getSudo();
  if (process.platform !== 'win32' && !sp) {
    return { ok: false, needSudo: true };
  }

  if (rememberSudo && sp) store.setSudo(sp);
  if (rememberSudo === false) store.clearSudo();

  vpn.connect(settings, sp);
  return { ok: true };
});

ipcMain.handle('vpn:disconnect', async () => {
  await vpn.disconnect();
  return { ok: true };
});

// ログ開閉に合わせてウィンドウの高さを伸縮
const COMPACT_H = 360;
const EXPANDED_H = 600;
ipcMain.on('ui:logOpen', (_e, open) => {
  if (!win || win.isDestroyed()) return;
  const [w] = win.getContentSize();
  win.setContentSize(w, open ? EXPANDED_H : COMPACT_H, true);
});
