// ==================================================
// FLUX – main.js
// ==================================================
const { app, BrowserWindow, ipcMain, nativeTheme, shell, session, dialog, protocol } = require('electron');
const path = require('path');
const fs = require('fs');

process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true';

// ==================================================
// SETTINGS STORE
// ==================================================
app.setName('Flux');

let mainWindow;
const windows = new Set();

let appSettings = {};

const DEFAULT_SETTINGS = {
  theme: 'dark',
  palette: 'neutral',
  homeUrl: 'flux://home',
  searchEngine: 'duckduckgo',
  saveHistory: true,
  blockTrackers: true,
  blockFingerprint: true,
  dnt: true
};

function getSettingsFilePath() {
  return path.join(app.getPath('userData'), 'flux-settings.json');
}

function loadSettingsFromDisk() {
  try {
    const file = getSettingsFilePath();
    console.log('[Flux main] Ładuję ustawienia z:', file);
    if (fs.existsSync(file)) {
      const raw = fs.readFileSync(file, 'utf-8');
      const parsed = JSON.parse(raw);
      console.log('[Flux main] Wczytane z pliku:', parsed);
      return parsed;
    }
    console.log('[Flux main] Plik nie istnieje, używam domyślnych');
  } catch (err) {
    console.error('[Flux main] Błąd ładowania:', err);
  }
  return {};
}

function saveSettingsToDisk() {
  try {
    const file = getSettingsFilePath();
    fs.writeFileSync(file, JSON.stringify(appSettings, null, 2));
    console.log('[Flux main] Zapisane do pliku:', appSettings);
  } catch (err) {
    console.error('[Flux main] Błąd zapisu:', err);
  }
}

function getAppSetting(key, fallback) {
  return key in appSettings ? appSettings[key] : fallback;
}

function setAppSetting(key, value) {
  console.log('[Flux main] setAppSetting:', key, '=', value);
  appSettings[key] = value;
  saveSettingsToDisk();

  BrowserWindow.getAllWindows().forEach(win => {
    if (!win.isDestroyed()) {
      win.webContents.send('settings:changed', { key, value });
    }
  });
}

// ==================================================
// ADBLOCK
// ==================================================
const adblockState = new Map();
const perSiteExceptions = new Set();
const BLOCKED_HOSTS = new Set();
const BLOCKED_PATTERNS = [];

function loadBlockLists() {
  const blocklistPath = path.join(__dirname, 'blocklist.txt');
  if (fs.existsSync(blocklistPath)) {
    const lines = fs.readFileSync(blocklistPath, 'utf-8').split('\n');
    lines.forEach(line => {
      line = line.trim();
      if (!line || line.startsWith('#')) return;
      BLOCKED_HOSTS.add(line);
    });
    console.log(`[Flux] Załadowano ${BLOCKED_HOSTS.size} domen z blocklisty`);
  }
  BLOCKED_PATTERNS.push(
    /\/pagead\//i, /\/adserver\//i, /\/adsystem\//i, /\/analytics\./i,
    /\/track(ing)?\//i, /\/pixel\./i, /\/beacon\./i, /\/telemetry\//i,
    /doubleclick\.net/i, /googletagmanager\.com/i, /google-analytics\.com/i,
    /googlesyndication\.com/i, /googleadservices\.com/i, /facebook\.com\/tr/i,
    /connect\.facebook\.net/i, /scorecardresearch\.com/i, /hotjar\.com/i,
    /mixpanel\.com/i, /segment\.io/i, /amplitude\.com/i, /fullstory\.com/i,
    /mouseflow\.com/i, /crazyegg\.com/i, /quantserve\.com/i, /adnxs\.com/i,
    /criteo\.com/i, /taboola\.com/i, /outbrain\.com/i, /pubmatic\.com/i,
    /rubiconproject\.com/i, /openx\.net/i, /casalemedia\.com/i, /adform\.net/i,
    /smartadserver\.com/i, /teads\.tv/i, /sharethrough\.com/i, /yieldmo\.com/i,
    /bidswitch\.net/i, /amazon-adsystem\.com/i
  );
}

function shouldBlock(url) {
  try {
    const u = new URL(url);
    if (BLOCKED_HOSTS.has(u.hostname)) return true;
    for (const host of BLOCKED_HOSTS) {
      if (u.hostname.endsWith('.' + host)) return true;
    }
    for (const pattern of BLOCKED_PATTERNS) {
      if (pattern.test(url)) return true;
    }
    return false;
  } catch { return false; }
}

const blockStats = { total: 0 };

function setupSession(ses) {
  if (adblockState.has(ses.id)) return;
  adblockState.set(ses.id, true);

  ses.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
    if (details.url.startsWith('flux://')) { callback({}); return; }
    const adblockOn = adblockState.get(ses.id) !== false;
    if (!adblockOn) { callback({}); return; }

    let hostname = '';
    try { hostname = new URL(details.url).hostname; } catch {}
    if (perSiteExceptions.has(hostname)) { callback({}); return; }

    if (shouldBlock(details.url)) {
      blockStats.total++;
      const wc = details.webContentsId;
      if (wc) {
        BrowserWindow.getAllWindows().forEach(w => {
          if (w.webContents.id === wc) w.webContents.send('adblock:blocked', { url: details.url });
        });
      }
      callback({ cancel: true });
      return;
    }
    callback({});
  });

  ses.webRequest.onBeforeSendHeaders({ urls: ['<all_urls>'] }, (details, callback) => {
    const headers = { ...details.requestHeaders };
    delete headers['X-Client-Data'];
    delete headers['X-Goog-Api-Key'];
    if (headers['Referer']) {
      try { headers['Referer'] = new URL(headers['Referer']).origin + '/'; } catch {}
    }
    headers['DNT'] = '1';
    headers['Sec-GPC'] = '1';
    callback({ requestHeaders: headers });
  });

  ses.webRequest.onHeadersReceived({ urls: ['<all_urls>'] }, (details, callback) => {
    const headers = { ...details.responseHeaders };
    delete headers['X-Powered-By'];
    delete headers['Server'];
    delete headers['X-AspNet-Version'];
    callback({ responseHeaders: headers });
  });

  ses.setPermissionRequestHandler((wc, permission, callback) => {
    const denied = ['geolocation', 'notifications', 'midi', 'midiSysex', 'hid', 'serial', 'usb', 'bluetooth'];
    if (denied.includes(permission)) { callback(false); return; }
    callback(true);
  });
}

// ==================================================
// PROTOKÓŁ flux://
// ==================================================
function registerFluxProtocol() {
  protocol.handle('flux', async (request) => {
    let hostname = '';
    let pathname = '';
    let searchParams = '';

    try {
      const u = new URL(request.url);
      hostname = u.hostname || 'home';
      pathname = u.pathname || '';
      searchParams = u.search || '';
      console.log('[Flux] Protokół flux://', { hostname, pathname, searchParams });
    } catch (e) {
      console.error('[Flux] Błąd parsowania URL:', request.url, e);
      const raw = request.url.replace('flux://', '');
      const parts = raw.split('/');
      hostname = parts[0] || 'home';
      pathname = '/' + parts.slice(1).join('/');
    }

    if (!hostname) hostname = 'home';

    // 1) Pliki statyczne w katalogu głównym
    const staticFile = path.join(__dirname, hostname + pathname);
    if (fs.existsSync(staticFile) && fs.statSync(staticFile).isFile()) {
      const ext = path.extname(staticFile).toLowerCase();
      const mimeTypes = {
        '.html': 'text/html; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.js': 'text/javascript; charset=utf-8',
        '.svg': 'image/svg+xml',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif': 'image/gif',
        '.ico': 'image/x-icon',
        '.json': 'application/json; charset=utf-8',
        '.woff': 'font/woff',
        '.woff2': 'font/woff2'
      };
      const mime = mimeTypes[ext] || 'application/octet-stream';

      try {
        if (['.svg', '.css', '.js', '.html', '.json'].includes(ext)) {
          const content = fs.readFileSync(staticFile, 'utf-8');
          return new Response(content, { status: 200, headers: { 'content-type': mime } });
        } else {
          const content = fs.readFileSync(staticFile);
          return new Response(content, { status: 200, headers: { 'content-type': mime } });
        }
      } catch (err) {
        console.error('[Flux] Błąd czytania pliku statycznego:', staticFile, err);
      }
    }

    // 2) Strony wewnętrzne
    const filePath = path.join(__dirname, 'pages', `${hostname}.html`);
    if (fs.existsSync(filePath)) {
      try {
        let html = fs.readFileSync(filePath, 'utf-8');

        if (searchParams) {
          const metaTag = `<meta name="flux-params" content="${searchParams.replace(/"/g, '&quot;')}">`;
          if (/<head[^>]*>/i.test(html)) {
            html = html.replace(/(<head[^>]*>)/i, `$1\n  ${metaTag}`);
          } else {
            html = metaTag + html;
          }
        }

        return new Response(html, {
          status: 200,
          headers: { 'content-type': 'text/html; charset=utf-8' }
        });
      } catch (err) {
        console.error('[Flux] Błąd czytania strony:', filePath, err);
      }
    }

    // 3) 404
    return new Response(
      `<html><body style="font-family:system-ui;background:#1F1F1F;color:#E8EAED;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;flex-direction:column;gap:16px">
        <h1 style="font-size:48px;margin:0">404</h1>
        <p style="color:#9AA0A6;margin:0">Nie znaleziono: <code style="color:#8AB4F8">flux://${hostname}${pathname}</code></p>
        <p style="color:#5F6368;margin:0;font-size:12px">Dostępne: flux://home, flux://settings, flux://history, flux://downloads, flux://about, flux://privacy</p>
      </body></html>`,
      { status: 404, headers: { 'content-type': 'text/html; charset=utf-8' } }
    );
  });
}

// ==================================================
// OKNO
// ==================================================
function createWindow(options = {}) {
  const { private: isPrivate = false } = options;

  const winOptions = {
    width: 1280,
    height: 800,
    minWidth: 700,
    minHeight: 500,
    title: isPrivate ? 'Flux (prywatne)' : 'Flux',
    backgroundColor: isPrivate ? '#1A0F1F' : '#1F1F1F',
    icon: path.join(__dirname, 'logo.svg'),
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 16, y: 14 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      disableBlinkFeatures: 'AutomationControlled'
    }
  };

  if (isPrivate) {
    winOptions.webPreferences.partition = `private-${Date.now()}-${Math.random()}`;
  }

  const win = new BrowserWindow(winOptions);

  // ⬇️ Otwieranie linków zewnętrznych z OKNA w domyślnej przeglądarce
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  setupSession(win.webContents.session);
  win.loadFile('index.html', { query: { private: isPrivate ? '1' : '0' } });
  windows.add(win);
  win.on('closed', () => windows.delete(win));

  return win;
}

// ==================================================
// PRELOAD dla webview + obsługa linków zewnętrznych
// ==================================================
app.on('web-contents-created', (event, contents) => {
  contents.on('will-attach-webview', (event, webPreferences, params) => {
    console.log('[Flux] will-attach-webview src:', params.src);

    if (params.src && params.src.startsWith('flux://')) {
      console.log('[Flux] Dodaję preload do webview dla:', params.src);
      webPreferences.preload = path.join(__dirname, 'preload.js');
    }

    delete webPreferences.preloadURL;
    webPreferences.nodeIntegration = false;
    webPreferences.contextIsolation = true;
  });

  // ⬇️ Otwieranie linków zewnętrznych z WEBVIEW w domyślnej przeglądarce
  contents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });
});

// ⚠️ Rejestracja protokołu MUSI być przed app.whenReady()
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'flux',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true
    }
  }
]);

// ==================================================
// START
// ==================================================
app.whenReady().then(() => {
  appSettings = { ...DEFAULT_SETTINGS, ...loadSettingsFromDisk() };
  console.log('[Flux main] Startowe ustawienia:', appSettings);
  console.log('[Flux main] userData:', app.getPath('userData'));

  loadBlockLists();
  registerFluxProtocol();
  mainWindow = createWindow();

  // ==================================================
  // OKNO
  // ==================================================
  ipcMain.on('window:minimize', (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (win) win.minimize();
  });

  ipcMain.on('window:maximize', (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (!win) return;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  });

  ipcMain.on('window:close', (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (win) win.close();
  });

  ipcMain.on('window:new', () => {
    const win = createWindow();
    win.once('ready-to-show', () => win.show());
  });

  ipcMain.on('window:newPrivate', () => {
    const win = createWindow({ private: true });
    win.once('ready-to-show', () => win.show());
  });

  const sendMaximizeState = (win) => {
    win.on('maximize',   () => win.webContents.send('window:maximized', true));
    win.on('unmaximize', () => win.webContents.send('window:maximized', false));
  };
  sendMaximizeState(mainWindow);

  ipcMain.on('theme:set', (_e, theme) => { nativeTheme.themeSource = theme; });

  ipcMain.on('shell:openExternal', (_e, url) => {
    if (url && /^https?:\/\//i.test(url)) shell.openExternal(url);
  });

  // ==================================================
  // SETTINGS IPC
  // ==================================================
  ipcMain.handle('settings:get', (_e, key, fallback) => getAppSetting(key, fallback));
  ipcMain.handle('settings:getAll', () => {
    console.log('[Flux main] getAll →', appSettings);
    return appSettings;
  });
  ipcMain.handle('settings:set', (_e, key, value) => {
    setAppSetting(key, value);
    return { ok: true };
  });

  // ==================================================
  // ADBLOCK
  // ==================================================
  ipcMain.handle('adblock:isEnabled', (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (!win) return true;
    return adblockState.get(win.webContents.session.id) !== false;
  });

  ipcMain.handle('adblock:setEnabled', (e, enabled) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (!win) return;
    adblockState.set(win.webContents.session.id, !!enabled);
    return !!enabled;
  });

  ipcMain.handle('adblock:getStats', () => ({ total: blockStats.total }));
  ipcMain.on('adblock:resetStats', () => { blockStats.total = 0; });

  ipcMain.handle('adblock:setSiteException', (_e, hostname, exclude) => {
    if (exclude) perSiteExceptions.add(hostname);
    else perSiteExceptions.delete(hostname);
    return { ok: true };
  });

  // ==================================================
  // PRIVACY
  // ==================================================
  ipcMain.handle('privacy:clearData', async (e, options) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (!win) return { ok: false };
    const ses = win.webContents.session;
    const tasks = [];
    if (options.cache)        tasks.push(ses.clearCache());
    if (options.cookies)      tasks.push(ses.clearStorageData({ storages: ['cookies'] }));
    if (options.localStorage) tasks.push(ses.clearStorageData({ storages: ['localstorage'] }));
    if (options.indexedDB)    tasks.push(ses.clearStorageData({ storages: ['indexdb'] }));
    if (options.all)          tasks.push(ses.clearStorageData());
    await Promise.all(tasks);
    return { ok: true };
  });

  // ==================================================
  // HASŁA
  // ==================================================
  const passwordsFile = path.join(app.getPath('userData'), 'flux-passwords.json');
  function loadPasswords() {
    try { return JSON.parse(fs.readFileSync(passwordsFile, 'utf-8')); }
    catch { return []; }
  }
  function savePasswords(pw) {
    fs.writeFileSync(passwordsFile, JSON.stringify(pw, null, 2));
  }
  ipcMain.handle('passwords:list', () => loadPasswords());
  ipcMain.handle('passwords:save', (_e, entry) => {
    const list = loadPasswords();
    const idx = list.findIndex(p => p.host === entry.host && p.username === entry.username);
    if (idx >= 0) list[idx] = entry;
    else list.push(entry);
    savePasswords(list);
    return { ok: true };
  });
  ipcMain.handle('passwords:remove', (_e, host, username) => {
    let list = loadPasswords();
    list = list.filter(p => !(p.host === host && p.username === username));
    savePasswords(list);
    return { ok: true };
  });

  // ==================================================
  // SYNC
  // ==================================================
  ipcMain.handle('sync:export', async () => {
    const { filePath } = await dialog.showSaveDialog(mainWindow, {
      title: 'Eksportuj dane Flux',
      defaultPath: 'flux-sync.json',
      filters: [{ name: 'JSON', extensions: ['json'] }]
    });
    if (!filePath) return { ok: false };
    return { ok: true, filePath };
  });

  // ==================================================
  // POBIERANIE
  // ==================================================
  const downloads = [];
  session.defaultSession.on('will-download', (event, item) => {
    const downloadItem = {
      id: Date.now(),
      filename: item.getFilename(),
      url: item.getURL(),
      totalBytes: item.getTotalBytes(),
      receivedBytes: 0,
      state: 'progressing',
      savePath: item.getSavePath()
    };
    downloads.push(downloadItem);

    item.on('updated', (e, state) => {
      downloadItem.receivedBytes = item.getReceivedBytes();
      downloadItem.state = state;
      windows.forEach(w => {
        if (!w.isDestroyed()) w.webContents.send('download:update', downloadItem);
      });
    });

    item.once('done', (e, state) => {
      downloadItem.state = state;
      downloadItem.savePath = item.getSavePath();
      windows.forEach(w => {
        if (!w.isDestroyed()) w.webContents.send('download:update', downloadItem);
      });
    });
  });

  ipcMain.handle('downloads:list', () => downloads);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow();
});