'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getStatus:  () => ipcRenderer.invoke('get-status'),
  getLogs:    () => ipcRenderer.invoke('get-logs'),
  getConfig:  () => ipcRenderer.invoke('get-config'),
  getPort:    () => ipcRenderer.invoke('get-port'),
  getVersion: () => ipcRenderer.invoke('get-version'),

  startService:   () => ipcRenderer.invoke('start-service'),
  stopService:    () => ipcRenderer.invoke('stop-service'),
  restartService: () => ipcRenderer.invoke('restart-service'),

  saveConfig:       (c) => ipcRenderer.invoke('save-config', c),
  openConfigFolder: ()  => ipcRenderer.invoke('open-config-folder'),
  openInBrowser:    ()  => ipcRenderer.invoke('open-in-browser'),

  getReleases:           ()       => ipcRenderer.invoke('get-releases'),
  downloadAndInstall:    (url, n) => ipcRenderer.invoke('download-and-install', url, n),
  hotUpdate:             (url)    => ipcRenderer.invoke('hot-update', url),
  onDownloadProgress:    (cb)     => ipcRenderer.on('download-progress', (_e, v) => cb(v)),

  onServiceStatus: (cb) => ipcRenderer.on('svc-status',   (_e, v) => cb(v)),
  onLog:           (cb) => ipcRenderer.on('log',          (_e, v) => cb(v)),
  onInitLogs:      (cb) => ipcRenderer.once('init-logs',  (_e, v) => cb(v)),
  onInitConfig:    (cb) => ipcRenderer.once('init-config',(_e, v) => cb(v)),
  onInitPort:      (cb) => ipcRenderer.once('init-port',  (_e, v) => cb(v)),
});
