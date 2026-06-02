'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (data) => ipcRenderer.invoke('settings:save', data),
  secretsStatus: () => ipcRenderer.invoke('secrets:status'),
  getStatus: () => ipcRenderer.invoke('vpn:status'),
  connect: (sudoPw, remember) => ipcRenderer.invoke('vpn:connect', sudoPw, remember),
  disconnect: () => ipcRenderer.invoke('vpn:disconnect'),
  onStatus: (cb) => ipcRenderer.on('vpn:status', (_e, s) => cb(s)),
  onLog: (cb) => ipcRenderer.on('vpn:log', (_e, l) => cb(l)),
  onCert: (cb) => ipcRenderer.on('vpn:cert', (_e, d) => cb(d)),
  setLogOpen: (open) => ipcRenderer.send('ui:logOpen', open),
  platform: process.platform,
});
