const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('flux', {
  version: '0.1.1',
  name: 'Flux',

  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    maximize: () => ipcRenderer.send('window:maximize'),
    close:    () => ipcRenderer.send('window:close'),
    newWindow:  () => ipcRenderer.send('window:new'),
    newPrivate: () => ipcRenderer.send('window:newPrivate'),
    onMaximizeChange: (cb) => ipcRenderer.on('window:maximized', (_e, v) => cb(v))
  },

  theme: {
    set: (theme) => ipcRenderer.send('theme:set', theme)
  },

  shell: {
    openExternal: (url) => ipcRenderer.send('shell:openExternal', url)
  },

  adblock: {
    isEnabled:  () => ipcRenderer.invoke('adblock:isEnabled'),
    setEnabled: (enabled) => ipcRenderer.invoke('adblock:setEnabled', enabled),
    getStats:   () => ipcRenderer.invoke('adblock:getStats'),
    resetStats: () => ipcRenderer.send('adblock:resetStats'),
    setSiteException:  (hostname, exclude) => ipcRenderer.invoke('adblock:setSiteException', hostname, exclude),
    isSiteExcluded:    (hostname) => ipcRenderer.invoke('adblock:isSiteExcluded', hostname),
    onBlocked: (cb) => ipcRenderer.on('adblock:blocked', (_e, data) => cb(data))
  },

  privacy: {
    clearData: (options) => ipcRenderer.invoke('privacy:clearData', options)
  },

  passwords: {
    list:   () => ipcRenderer.invoke('passwords:list'),
    save:   (entry) => ipcRenderer.invoke('passwords:save', entry),
    remove: (host, username) => ipcRenderer.invoke('passwords:remove', host, username)
  },

  sync: {
    export: () => ipcRenderer.invoke('sync:export')
  },

  downloads: {
    list: () => ipcRenderer.invoke('downloads:list'),
    onUpdate: (cb) => ipcRenderer.on('download:update', (_e, data) => cb(data))
  },

  settings: {
    get:     (key, fallback) => ipcRenderer.invoke('settings:get', key, fallback),
    getAll:  () => ipcRenderer.invoke('settings:getAll'),
    set:     (key, value) => ipcRenderer.invoke('settings:set', key, value),
    onChange: (cb) => ipcRenderer.on('settings:changed', (_e, data) => cb(data))
  },

  defaultBrowser: {
    isDefault: () => ipcRenderer.invoke('default:isDefault'),
    setAsDefault: () => ipcRenderer.invoke('default:setAsDefault'),
    openSettings: () => ipcRenderer.invoke('default:openSettings')
  },

  // ⬇️ NOWE: Auto-update
  update: {
    check: () => ipcRenderer.invoke('update:check'),
    download: () => ipcRenderer.invoke('update:download'),
    install: () => ipcRenderer.send('update:install'),
    getCurrentVersion: () => ipcRenderer.invoke('update:getCurrentVersion'),

    onChecking: (cb) => ipcRenderer.on('update:checking', () => cb()),
    onAvailable: (cb) => ipcRenderer.on('update:available', (_e, data) => cb(data)),
    onNotAvailable: (cb) => ipcRenderer.on('update:not-available', (_e, data) => cb(data)),
    onProgress: (cb) => ipcRenderer.on('update:progress', (_e, data) => cb(data)),
    onDownloaded: (cb) => ipcRenderer.on('update:downloaded', (_e, data) => cb(data)),
    onError: (cb) => ipcRenderer.on('update:error', (_e, data) => cb(data))
  },

  app: {
    getVersion: () => ipcRenderer.invoke('app:getVersion'),
    getPlatform: () => ipcRenderer.invoke('app:getPlatform'),
    isPackaged: () => ipcRenderer.invoke('app:isPackaged'),
    onOpenUrl: (cb) => ipcRenderer.on('open-url', (_e, url) => cb(url))
  }
});