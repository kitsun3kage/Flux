// ==================================================
// FLUX – renderer.js
// ==================================================

let tabs = [];
let activeTabId = null;
let nextId = 1;

// ===== Palety kolorów =====
const PALETTES = {
  neutral: { name: 'Neutral',   desc: 'Domyślny',  grad: ['#8AB4F8', '#669DF6', '#1A73E8'], rgb: [138, 180, 248] },
  default: { name: 'Flux Blue', desc: 'Klasyczny', grad: ['#4A9EFF', '#1E6FDC', '#0A2A6B'], rgb: [46, 125, 224] },
  emerald: { name: 'Emerald',   desc: 'Świeży',    grad: ['#6EE7B7', '#10B981', '#064E3B'], rgb: [22, 163, 74]  },
  violet:  { name: 'Violet',    desc: 'Kreatywny', grad: ['#A78BFA', '#7C3AED', '#4C1D95'], rgb: [147, 51, 234] },
  rose:    { name: 'Rose',      desc: 'Ciepły',    grad: ['#F472B6', '#E11D48', '#881337'], rgb: [225, 29, 72]  },
  amber:   { name: 'Amber',     desc: 'Słoneczny', grad: ['#FCD34D', '#F59E0B', '#78350F'], rgb: [217, 119, 6]  },
  cyan:    { name: 'Cyan',      desc: 'Chłodny',   grad: ['#67E8F9', '#06B6D4', '#164E63'], rgb: [8, 145, 178]  }
};

// ===== DOM =====
const tabsEl          = document.getElementById('tabs');
const contentEl       = document.getElementById('content');
const urlInput        = document.getElementById('url');
const urlAutocomplete = document.getElementById('url-autocomplete');
const urlShield       = document.getElementById('url-shield');
const urlShieldCount  = document.getElementById('url-shield-count');
const btnBack         = document.getElementById('back');
const btnForward      = document.getElementById('forward');
const btnReload       = document.getElementById('reload');
const btnHome         = document.getElementById('home');
const btnNewTab       = document.getElementById('new-tab');
const btnMenu         = document.getElementById('menu-toggle');
const btnShield       = document.getElementById('shield-button');
const btnBookmark     = document.getElementById('bookmark-star');
const menuEl          = document.getElementById('main-menu');
const menuOverlay     = document.getElementById('menu-overlay');
const shieldEl        = document.getElementById('shield-panel');
const shieldOverlay   = document.getElementById('shield-overlay');
const shieldCounter   = document.getElementById('shield-counter');
const reloadIcon      = document.getElementById('reload-icon');
const stopIcon        = document.getElementById('stop-icon');

const bookmarksListEl = document.getElementById('bookmarks-list');
const passwordsListEl = document.getElementById('passwords-list');

let currentBlockedCount = 0;

// ===== Cache ustawień =====
let settingsCache = {
  theme: 'dark',
  palette: 'neutral',
  homeUrl: 'flux://home',
  searchEngine: 'duckduckgo',
  saveHistory: true,
  blockTrackers: true,
  blockFingerprint: true,
  dnt: true
};

async function initSettings() {
  if (window.flux?.settings) {
    try {
      const all = await window.flux.settings.getAll();
      console.log('[Flux] Wczytane ustawienia:', all);
      settingsCache = { ...settingsCache, ...all };
    } catch (err) {
      console.error('[Flux] Błąd ładowania ustawień:', err);
    }
  }
}

function getSetting(key) {
  return settingsCache[key];
}

async function setSetting(key, value) {
  settingsCache[key] = value;
  if (window.flux?.settings) {
    try {
      await window.flux.settings.set(key, value);
    } catch (err) {
      console.error('[Flux] Błąd zapisu ustawienia:', err);
    }
  }
}

const SEARCH_ENGINES = {
  duckduckgo: 'https://duckduckgo.com/?q=',
  google: 'https://www.google.com/search?q=',
  bing: 'https://www.bing.com/search?q='
};

const isPrivate = new URLSearchParams(location.search).get('private') === '1';
if (isPrivate) document.body.setAttribute('data-private', 'true');

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

function getFaviconUrl(pageUrl) {
  try {
    if (pageUrl.startsWith('flux://')) return null;
    const u = new URL(pageUrl);
    return `https://www.google.com/s2/favicons?domain=${u.hostname}&sz=32`;
  } catch { return null; }
}

// ===== Historia =====
function loadHistory() {
  if (isPrivate) return [];
  try { return JSON.parse(localStorage.getItem('flux-history') || '[]'); }
  catch { return []; }
}

function saveHistory(history) {
  if (isPrivate) return;
  if (history.length > 500) history = history.slice(-500);
  localStorage.setItem('flux-history', JSON.stringify(history));
}

function addToHistory(url, title) {
  if (isPrivate) return;
  if (!getSetting('saveHistory')) return;
  if (!url || url === 'about:blank' || url.startsWith('file://')) return;
  if (url.startsWith('flux://')) return;

  const history = loadHistory();
  if (history.length > 0 && history[history.length - 1].url === url) return;

  history.push({ url, title: title || url, ts: Date.now() });
  saveHistory(history);
}

// ===== Zakładki =====
function loadBookmarks() {
  try { return JSON.parse(localStorage.getItem('flux-bookmarks') || '[]'); }
  catch { return []; }
}

function saveBookmarks(bookmarks) {
  localStorage.setItem('flux-bookmarks', JSON.stringify(bookmarks));
}

function isBookmarked(url) {
  return loadBookmarks().some(b => b.url === url);
}

function toggleBookmark(url, title) {
  if (!url) return;
  if (url.startsWith('flux://')) return;
  const bookmarks = loadBookmarks();
  const idx = bookmarks.findIndex(b => b.url === url);
  if (idx >= 0) bookmarks.splice(idx, 1);
  else bookmarks.push({ url, title: title || url, ts: Date.now() });
  saveBookmarks(bookmarks);
  updateBookmarkStar();
}

function updateBookmarkStar() {
  const tab = tabs.find(t => t.id === activeTabId);
  if (!tab) return;

  let url = tab.url;
  try {
    if (typeof tab.webview.getURL === 'function') {
      url = tab.webview.getURL() || tab.url;
    }
  } catch (e) {}

  btnBookmark.classList.toggle('active', isBookmarked(url));
}

// ==================================================
// MOTYW
// ==================================================
function applyTheme(theme) {
  // ⬇️ Tryb prywatny ZAWSZE ciemny
  if (isPrivate) {
    document.documentElement.setAttribute('data-theme', 'dark');
    if (window.flux && window.flux.theme) window.flux.theme.set('dark');
    return;
  }

  let resolved = theme;
  if (theme === 'system') {
    const prefersLight = window.matchMedia('(prefers-color-scheme: light)').matches;
    resolved = prefersLight ? 'light' : 'dark';
    if (window.flux && window.flux.theme) window.flux.theme.set('system');
  } else {
    if (window.flux && window.flux.theme) window.flux.theme.set(theme);
  }
  document.documentElement.setAttribute('data-theme', resolved);
}

// ==================================================
// PALETA
// ==================================================
function applyPalette(paletteId) {
  if (!PALETTES[paletteId]) paletteId = 'neutral';
  document.documentElement.setAttribute('data-palette', paletteId);
  updateAllLogos(paletteId);
}

function updateAllLogos(paletteId) {
  const palette = PALETTES[paletteId] || PALETTES.neutral;
  const [g1, g2, g3] = palette.grad;

  const svg = `<svg width="256" height="256" viewBox="0 0 256 256" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <clipPath id="flux-clip-${paletteId}"><circle cx="128" cy="128" r="112" /></clipPath>
    <linearGradient id="flux-base-${paletteId}" x1="0" y1="0" x2="256" y2="256" gradientUnits="userSpaceOnUse">
      <stop stop-color="#1A2233"/><stop offset="1" stop-color="#0A0E1A"/>
    </linearGradient>
    <linearGradient id="flux-brand-${paletteId}" x1="0" y1="40" x2="256" y2="256" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="${g1}"/>
      <stop offset="50%" stop-color="${g2}"/>
      <stop offset="100%" stop-color="${g3}"/>
    </linearGradient>
    <linearGradient id="flux-glass-${paletteId}" x1="128" y1="16" x2="128" y2="240" gradientUnits="userSpaceOnUse">
      <stop stop-color="#E8EEF9" stop-opacity="0.3"/>
      <stop offset="1" stop-color="#E8EEF9" stop-opacity="0.02"/>
    </linearGradient>
  </defs>
  <circle cx="128" cy="134" r="112" fill="#000000" fill-opacity="0.3" filter="blur(8px)" />
  <circle cx="128" cy="128" r="112" fill="url(#flux-base-${paletteId})" />
  <g clip-path="url(#flux-clip-${paletteId})">
    <path d="M-20,140 Q 60,70 140,150 T 300,120 L 300,260 L -20,260 Z" fill="url(#flux-brand-${paletteId})" opacity="0.6"/>
    <path d="M-20,180 Q 80,100 160,190 T 300,150 L 300,260 L -20,260 Z" fill="url(#flux-brand-${paletteId})"/>
    <path d="M-20,50 C 90,-30 160,160 280,40 L 280,-20 L -20,-20 Z" fill="url(#flux-brand-${paletteId})" opacity="0.15"/>
    <path d="M104,80 L164,80 L164,104 L128,104 L128,124 L154,124 L154,148 L128,148 L128,185 Q116,180 104,175 Z" fill="#E8EEF9" opacity="0.95" />
  </g>
  <circle cx="128" cy="128" r="111" fill="none" stroke="url(#flux-glass-${paletteId})" stroke-width="2"/>
</svg>`;

  const blob = new Blob([svg], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);

  document.querySelectorAll('.logo-dynamic, .menu-logo, .settings-logo, .about-hero-logo').forEach(img => {
    if (img.tagName === 'IMG') img.src = url;
  });
}

// ==================================================
// NASŁUCH na zmiany z main process
// ==================================================
function setupSyncListeners() {
  if (window.flux?.settings) {
    window.flux.settings.onChange(({ key, value }) => {
      console.log('[Flux] Zmiana ustawienia:', key, '=', value);
      settingsCache[key] = value;

      // W trybie prywatnym ignoruj zmianę motywu
      if (key === 'theme') {
        if (!isPrivate) applyTheme(value);
        return;
      }
      if (key === 'palette') applyPalette(value);
    });
  }

  window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
    if (!isPrivate && getSetting('theme') === 'system') {
      applyTheme('system');
    }
  });
}

// ==================================================
// NORMALIZACJA URL – z blokadami
// ==================================================
function normalizeUrl(input) {
  const value = input.trim();
  const homeUrl = getSetting('homeUrl') || 'flux://home';
  if (!value) return homeUrl;

  // ⬇️ Blokada flux://privacy w ZWYKŁYM oknie
  if (/^flux:\/\/privacy\/?$/i.test(value) && !isPrivate) {
    return 'flux://private-blocked?page=privacy';
  }

  // ⬇️ Blokada flux://settings i flux://history w PRYWATNYM oknie
  if (isPrivate) {
    if (/^flux:\/\/settings\/?$/i.test(value)) {
      return 'flux://private-blocked?page=settings';
    }
    if (/^flux:\/\/history\/?$/i.test(value)) {
      return 'flux://private-blocked?page=history';
    }
  }

  if (/^flux:\/\//i.test(value)) return value;
  if (/^https?:\/\//i.test(value)) return value;
  if (/^[\w-]+\.[\w.-]+/.test(value) && !value.includes(' ')) return 'https://' + value;
  const engine = getSetting('searchEngine') || 'duckduckgo';
  return (SEARCH_ENGINES[engine] || SEARCH_ENGINES.duckduckgo) + encodeURIComponent(value);
}

// ==================================================
// FAVICON
// ==================================================
function updateTabFavicon(id, faviconUrl) {
  const tab = tabs.find(t => t.id === id);
  if (!tab) return;
  if (!faviconUrl) return;

  let img = tab.tabEl.querySelector('img.favicon');

  if (img) {
    img.src = faviconUrl;
    img.style.display = '';
    img.onerror = () => { img.style.display = 'none'; };
    return;
  }

  const placeholder = tab.tabEl.querySelector('.favicon-placeholder');
  if (!placeholder) return;

  img = document.createElement('img');
  img.className = 'favicon';
  img.src = faviconUrl;
  img.onerror = () => { img.style.display = 'none'; };
  placeholder.replaceWith(img);
}

function tryFallbackFavicon(id) {
  const tab = tabs.find(t => t.id === id);
  if (!tab) return;

  let currentUrl = tab.url;
  try {
    if (typeof tab.webview.getURL === 'function') {
      currentUrl = tab.webview.getURL() || tab.url;
    }
  } catch (e) {}

  if (!currentUrl || currentUrl.startsWith('flux://') || currentUrl.startsWith('file://')) return;
  if (currentUrl === 'about:blank') return;

  try {
    const u = new URL(currentUrl);
    const faviconUrl = `https://www.google.com/s2/favicons?domain=${u.hostname}&sz=64`;
    updateTabFavicon(id, faviconUrl);
  } catch (e) {}
}

// ==================================================
// TWORZENIE ZAKŁADKI
// ==================================================
function createTab(url) {
  const id = nextId++;

  let startUrl;
  if (url) {
    startUrl = url;
  } else if (isPrivate && tabs.length === 0) {
    startUrl = 'flux://privacy';
  } else {
    startUrl = getSetting('homeUrl') || 'flux://home';
  }

  const webview = document.createElement('webview');
  webview.setAttribute('src', startUrl);
  webview.setAttribute('allowpopups', '');
  webview.style.display = 'none';
  webview.style.width = '100%';
  webview.style.height = '100%';
  webview.dataset.id = id;
  contentEl.appendChild(webview);

  const tabEl = document.createElement('div');
  tabEl.className = 'tab';
  tabEl.dataset.id = id;
  tabEl.innerHTML = `
    <span class="favicon-placeholder"></span>
    <span class="title">Nowa karta</span>
    <button class="close" aria-label="Zamknij">×</button>
  `;
  tabEl.addEventListener('click', (e) => {
    if (e.target.classList.contains('close')) closeTab(id);
    else activateTab(id);
  });
  tabsEl.appendChild(tabEl);

  const tab = { id, webview, tabEl, title: 'Nowa karta', url: startUrl };
  tabs.push(tab);

  // ==================================================
  // ZDARZENIA WEBVIEW
  // ==================================================
  webview.addEventListener('did-navigate', (e) => {
    const url = e.url;

    // ⬇️ Blokada flux://privacy w ZWYKŁYM oknie
    if (!isPrivate && /^flux:\/\/privacy\/?$/i.test(url)) {
      webview.loadURL('flux://private-blocked?page=privacy');
      return;
    }

    // ⬇️ Blokada flux://settings i flux://history w PRYWATNYM oknie
    if (isPrivate) {
      if (/^flux:\/\/settings\/?$/i.test(url)) {
        webview.loadURL('flux://private-blocked?page=settings');
        return;
      }
      if (/^flux:\/\/history\/?$/i.test(url)) {
        webview.loadURL('flux://private-blocked?page=history');
        return;
      }
    }

    updateTabUrl(id, url);
    if (activeTabId === id) {
      addToHistory(url, tab.title);
      updateBookmarkStar();
      resetShieldCounter();
    }
    setTimeout(() => tryFallbackFavicon(id), 500);
  });

  webview.addEventListener('did-navigate-in-page', (e) => {
    updateTabUrl(id, e.url);
    if (activeTabId === id) updateBookmarkStar();
  });

  webview.addEventListener('page-title-updated', (e) => {
    updateTabTitle(id, e.title);
    if (activeTabId === id) addToHistory(tab.webview.getURL(), e.title);
  });

  webview.addEventListener('page-favicon-updated', (e) => {
    if (e.favicons && e.favicons.length > 0) {
      updateTabFavicon(id, e.favicons[0]);
    } else {
      tryFallbackFavicon(id);
    }
  });

  webview.addEventListener('did-start-loading', () => {
    if (activeTabId === id) setLoadingState(true);
  });

  webview.addEventListener('did-stop-loading', () => {
    if (activeTabId === id) setLoadingState(false);
    setTimeout(() => tryFallbackFavicon(id), 300);
  });

  webview.addEventListener('zoom-changed', () => {
    if (activeTabId === id) updateZoomDisplay();
  });

  // ⬇️ Otwieranie linków zewnętrznych w przeglądarce systemowej
  webview.addEventListener('new-window', (e) => {
    e.preventDefault();
    if (e.url && (e.url.startsWith('http://') || e.url.startsWith('https://'))) {
      if (window.flux?.shell) {
        window.flux.shell.openExternal(e.url);
      }
    }
  });

  activateTab(id);
  return tab;
}

function setLoadingState(isLoading) {
  if (isLoading) {
    reloadIcon.style.display = 'none';
    stopIcon.style.display = 'block';
  } else {
    reloadIcon.style.display = 'block';
    stopIcon.style.display = 'none';
  }
}

function activateTab(id) {
  activeTabId = id;
  tabs.forEach(t => {
    const isActive = t.id === id;
    t.webview.style.display = isActive ? 'flex' : 'none';
    t.tabEl.classList.toggle('active', isActive);
    if (isActive) {
      let currentUrl = t.url;
      try {
        if (typeof t.webview.getURL === 'function') {
          currentUrl = t.webview.getURL() || t.url;
        }
      } catch (e) {}
      urlInput.value = currentUrl;

      let loading = false;
      try {
        if (typeof t.webview.isLoading === 'function') {
          loading = t.webview.isLoading();
        }
      } catch (e) {}
      setLoadingState(loading);

      updateNavButtons();
      updateBookmarkStar();
      updateZoomDisplay();
      updateUrlShield();
    }
  });
}

function closeTab(id) {
  const idx = tabs.findIndex(t => t.id === id);
  if (idx === -1) return;
  const [tab] = tabs.splice(idx, 1);
  tab.webview.remove();
  tab.tabEl.remove();

  if (tabs.length === 0) {
    if (isPrivate) {
      if (window.flux?.window) window.flux.window.close();
      return;
    }
    createTab();
  } else if (activeTabId === id) {
    const next = tabs[Math.max(0, idx - 1)];
    activateTab(next.id);
  }
}

function updateTabUrl(id, url) {
  const tab = tabs.find(t => t.id === id);
  if (!tab) return;
  tab.url = url;
  if (activeTabId === id) {
    urlInput.value = url;
    updateNavButtons();
    updateUrlShield();
  }
}

function updateTabTitle(id, title) {
  const tab = tabs.find(t => t.id === id);
  if (!tab) return;
  tab.title = title || 'Nowa karta';
  tab.tabEl.querySelector('.title').textContent = tab.title;
}

function updateNavButtons() {
  const tab = tabs.find(t => t.id === activeTabId);
  if (!tab) return;

  let canBack = false, canForward = false;
  try {
    if (typeof tab.webview.canGoBack === 'function') canBack = tab.webview.canGoBack();
    if (typeof tab.webview.canGoForward === 'function') canForward = tab.webview.canGoForward();
  } catch (e) {}

  btnBack.disabled = !canBack;
  btnForward.disabled = !canForward;
}

// ===== Wskaźnik blokady =====
function resetShieldCounter() {
  currentBlockedCount = 0;
  updateUrlShield();
}

function incrementShieldCounter() {
  currentBlockedCount++;
  updateUrlShield();
}

function updateUrlShield() {
  if (currentBlockedCount > 0) {
    urlShield.classList.add('visible');
    urlShieldCount.textContent = currentBlockedCount;
    shieldCounter.textContent = currentBlockedCount;
    shieldCounter.dataset.count = currentBlockedCount;
  } else {
    urlShield.classList.remove('visible');
    shieldCounter.textContent = '';
    shieldCounter.dataset.count = 0;
  }
}

if (window.flux && window.flux.adblock) {
  window.flux.adblock.onBlocked(() => incrementShieldCounter());
}

urlShield.addEventListener('click', () => openShield());

// ===== Autouzupełnianie =====
let autocompleteItems = [];
let autocompleteIndex = -1;

function showAutocomplete(query) {
  const value = query.trim().toLowerCase();
  if (!value) { hideAutocomplete(); return; }

  const history = loadHistory();
  const bookmarks = loadBookmarks();
  const seen = new Set();
  const suggestions = [];

  const FLUX_PAGES = [
    { url: 'flux://home',      title: 'Strona startowa Flux', type: 'Flux' },
    { url: 'flux://downloads', title: 'Pobrane Flux',         type: 'Flux' },
    { url: 'flux://about',     title: 'O Flux',               type: 'Flux' }
  ];

  // ⬇️ Dodaj strony w zależności od trybu
  if (isPrivate) {
    FLUX_PAGES.push({ url: 'flux://privacy', title: 'Tryb prywatny Flux', type: 'Flux' });
  } else {
    FLUX_PAGES.push({ url: 'flux://settings', title: 'Ustawienia Flux', type: 'Flux' });
    FLUX_PAGES.push({ url: 'flux://history', title: 'Historia Flux', type: 'Flux' });
  }

  FLUX_PAGES.forEach(p => {
    if (p.url.includes(value) || p.title.toLowerCase().includes(value)) {
      seen.add(p.url);
      suggestions.push(p);
    }
  });

  bookmarks.forEach(b => {
    if (seen.has(b.url)) return;
    seen.add(b.url);
    if (b.url.toLowerCase().includes(value) || (b.title || '').toLowerCase().includes(value)) {
      suggestions.push({ ...b, type: 'Zakładka' });
    }
  });

  history.slice().reverse().forEach(h => {
    if (seen.has(h.url)) return;
    if (suggestions.length >= 8) return;
    if (h.url.toLowerCase().includes(value) || (h.title || '').toLowerCase().includes(value)) {
      seen.add(h.url);
      suggestions.push({ ...h, type: 'Historia' });
    }
  });

  if (suggestions.length === 0) {
    suggestions.push({ url: normalizeUrl(value), title: `Szukaj: ${value}`, type: 'Szukaj' });
  }

  renderAutocomplete(suggestions.slice(0, 8));
}

function renderAutocomplete(items) {
  autocompleteItems = items;
  autocompleteIndex = -1;
  if (items.length === 0) { hideAutocomplete(); return; }

  urlAutocomplete.innerHTML = '';
  items.forEach((item, i) => {
    const el = document.createElement('div');
    el.className = 'autocomplete-item';
    el.dataset.index = i;
    const fav = getFaviconUrl(item.url);
    const isFlux = item.type === 'Flux';
    el.innerHTML = `
      <span class="autocomplete-icon">
        ${fav ? `<img src="${fav}" onerror="this.replaceWith(document.createTextNode('🌐'))"/>` : (item.type === 'Szukaj' ? '🔍' : isFlux ? '⚡' : '🌐')}
      </span>
      <div class="autocomplete-content">
        <div class="autocomplete-title">${escapeHtml(item.title || item.url)}</div>
        <div class="autocomplete-url">${escapeHtml(item.url)}</div>
      </div>
      <span class="autocomplete-type">${item.type}</span>
    `;
    el.addEventListener('mousedown', (e) => { e.preventDefault(); selectAutocomplete(i); });
    urlAutocomplete.appendChild(el);
  });

  urlAutocomplete.classList.add('visible');
}

function hideAutocomplete() {
  urlAutocomplete.classList.remove('visible');
  autocompleteItems = [];
  autocompleteIndex = -1;
}

function selectAutocomplete(index) {
  const item = autocompleteItems[index];
  if (!item) return;
  const tab = tabs.find(t => t.id === activeTabId);
  if (tab) tab.webview.loadURL(item.url);
  urlInput.value = item.url;
  hideAutocomplete();
  urlInput.blur();
}

function updateAutocompleteSelection() {
  document.querySelectorAll('.autocomplete-item').forEach((el, i) => {
    el.classList.toggle('selected', i === autocompleteIndex);
  });
}

// ===== Nawigacja =====
btnBack.addEventListener('click', () => {
  const tab = tabs.find(t => t.id === activeTabId);
  if (tab?.webview.canGoBack && tab.webview.canGoBack()) tab.webview.goBack();
});

btnForward.addEventListener('click', () => {
  const tab = tabs.find(t => t.id === activeTabId);
  if (tab?.webview.canGoForward && tab.webview.canGoForward()) tab.webview.goForward();
});

btnReload.addEventListener('click', () => {
  const tab = tabs.find(t => t.id === activeTabId);
  if (!tab) return;
  let loading = false;
  try { loading = tab.webview.isLoading(); } catch (e) {}
  if (loading) tab.webview.stop();
  else tab.webview.reload();
});

btnHome.addEventListener('click', () => {
  const tab = tabs.find(t => t.id === activeTabId);
  if (tab) tab.webview.loadURL(getSetting('homeUrl') || 'flux://home');
});

btnNewTab.addEventListener('click', () => createTab());

btnBookmark.addEventListener('click', () => {
  const tab = tabs.find(t => t.id === activeTabId);
  if (!tab) return;
  let url = tab.url;
  try { url = tab.webview.getURL() || tab.url; } catch (e) {}
  if (url) toggleBookmark(url, tab.title);
});

urlInput.addEventListener('input', () => showAutocomplete(urlInput.value));
urlInput.addEventListener('focus', () => { if (urlInput.value) showAutocomplete(urlInput.value); });
urlInput.addEventListener('blur', () => setTimeout(hideAutocomplete, 150));

urlInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    if (autocompleteIndex >= 0 && autocompleteItems[autocompleteIndex]) {
      selectAutocomplete(autocompleteIndex);
      return;
    }
    hideAutocomplete();
    const tab = tabs.find(t => t.id === activeTabId);
    if (tab) tab.webview.loadURL(normalizeUrl(urlInput.value));
  } else if (e.key === 'ArrowDown') {
    e.preventDefault();
    if (autocompleteItems.length === 0) return;
    autocompleteIndex = Math.min(autocompleteIndex + 1, autocompleteItems.length - 1);
    updateAutocompleteSelection();
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    if (autocompleteItems.length === 0) return;
    autocompleteIndex = Math.max(autocompleteIndex - 1, -1);
    updateAutocompleteSelection();
  } else if (e.key === 'Escape') {
    hideAutocomplete();
  }
});

// ===== Menu =====
function openMenu() {
  menuEl.classList.add('open');
  menuOverlay.classList.add('visible');
  menuEl.setAttribute('aria-hidden', 'false');
  updateZoomDisplay();
}

function closeMenu() {
  menuEl.classList.remove('open');
  menuOverlay.classList.remove('visible');
  menuEl.setAttribute('aria-hidden', 'true');
}

function toggleMenu() {
  if (menuEl.classList.contains('open')) closeMenu();
  else openMenu();
}

btnMenu.addEventListener('click', (e) => { e.stopPropagation(); toggleMenu(); });
menuOverlay.addEventListener('click', closeMenu);

// ===== Shield =====
function openShield() {
  shieldEl.classList.add('open');
  shieldOverlay.classList.add('visible');
  shieldEl.setAttribute('aria-hidden', 'false');
  updateShieldStats();
  updateShieldToggle();
}

function closeShield() {
  shieldEl.classList.remove('open');
  shieldOverlay.classList.remove('visible');
  shieldEl.setAttribute('aria-hidden', 'true');
}

function toggleShield() {
  if (shieldEl.classList.contains('open')) closeShield();
  else openShield();
}

btnShield.addEventListener('click', (e) => { e.stopPropagation(); toggleShield(); });
shieldOverlay.addEventListener('click', closeShield);

async function updateShieldStats() {
  if (!window.flux || !window.flux.adblock) return;
  try {
    const stats = await window.flux.adblock.getStats();
    const blockedEl = document.getElementById('shield-blocked-count');
    const trackersEl = document.getElementById('shield-trackers-count');
    if (blockedEl) blockedEl.textContent = stats.total;
    if (trackersEl) trackersEl.textContent = Math.floor(stats.total * 0.6);
  } catch {}
}

async function updateShieldToggle() {
  if (!window.flux || !window.flux.adblock) return;
  try {
    const enabled = await window.flux.adblock.isEnabled();
    const toggle = document.getElementById('shield-adblock-toggle');
    if (toggle) toggle.checked = enabled;
    shieldEl.classList.toggle('disabled', !enabled);
    const sub = document.getElementById('shield-subtitle');
    if (sub) sub.textContent = enabled ? 'Aktywna na tej stronie' : 'Wyłączona';
  } catch {}
}

document.getElementById('shield-reset-stats')?.addEventListener('click', () => {
  if (window.flux && window.flux.adblock) {
    window.flux.adblock.resetStats();
    updateShieldStats();
    resetShieldCounter();
  }
});

document.getElementById('shield-adblock-toggle')?.addEventListener('change', async (e) => {
  if (window.flux && window.flux.adblock) {
    await window.flux.adblock.setEnabled(e.target.checked);
    shieldEl.classList.toggle('disabled', !e.target.checked);
    const sub = document.getElementById('shield-subtitle');
    if (sub) sub.textContent = e.target.checked ? 'Aktywna na tej stronie' : 'Wyłączona';
    const tab = tabs.find(t => t.id === activeTabId);
    if (tab) tab.webview.reload();
  }
});

setInterval(() => {
  if (shieldEl.classList.contains('open')) updateShieldStats();
}, 2000);

// ===== Menu clicks =====
menuEl.addEventListener('click', (e) => {
  const zoomBtn = e.target.closest('[data-action]');
  if (!zoomBtn) return;

  const action = zoomBtn.dataset.action;

  if (action === 'zoom-in' || action === 'zoom-out' || action === 'zoom-reset') {
    e.stopPropagation();
    handleZoom(action);
    return;
  }

  if (action === 'fullscreen') {
    e.stopPropagation();
    toggleFullscreen();
    return;
  }

  const item = e.target.closest('.menu-item');
  if (item) {
    closeMenu();
    handleMenuAction(item.dataset.action);
  }
});

function handleZoom(action) {
  const tab = tabs.find(t => t.id === activeTabId);
  if (!tab) return;
  let current = 0;
  try { current = tab.webview.getZoomLevel ? tab.webview.getZoomLevel() : 0; } catch (e) {}
  let newLevel = current;
  if (action === 'zoom-in')    newLevel = Math.min(current + 0.5, 5);
  if (action === 'zoom-out')   newLevel = Math.max(current - 0.5, -3);
  if (action === 'zoom-reset') newLevel = 0;
  try { tab.webview.setZoomLevel(newLevel); } catch (e) {}
  updateZoomDisplay();
}

function updateZoomDisplay() {
  const tab = tabs.find(t => t.id === activeTabId);
  if (!tab) return;

  let level = 0;
  try {
    if (typeof tab.webview.getZoomLevel === 'function') {
      level = tab.webview.getZoomLevel();
    }
  } catch (e) {}

  const percent = Math.round(Math.pow(1.2, level) * 100);
  const zoomValueEl = document.querySelector('.zoom-value');
  if (zoomValueEl) zoomValueEl.textContent = percent + '%';
}

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen();
}

// ===== Modal helpers =====
function openModal(overlayId) {
  const el = document.getElementById(overlayId);
  if (el) el.classList.add('open');
}

function closeModal(overlayId) {
  const el = document.getElementById(overlayId);
  if (el) el.classList.remove('open');
}

document.querySelectorAll('.modal-close').forEach(btn => {
  btn.addEventListener('click', () => {
    const target = btn.dataset.close || btn.closest('.modal-overlay').id;
    closeModal(target);
  });
});

document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeModal(overlay.id);
  });
});

// ==================================================
// AKCJE MENU
// ==================================================
function handleMenuAction(action) {
  const tab = tabs.find(t => t.id === activeTabId);
  const go = (url) => { if (tab) tab.webview.loadURL(url); };

  switch (action) {
    case 'new-tab':      createTab(); break;
    case 'new-window':   if (window.flux?.window) window.flux.window.newWindow(); break;
    case 'new-private':  if (window.flux?.window) window.flux.window.newPrivate(); break;
    case 'focus-url':    urlInput.focus(); urlInput.select(); break;

    // ⬇️ W trybie prywatnym blokuj settings i history
    case 'history':
      go(isPrivate ? 'flux://private-blocked?page=history' : 'flux://history');
      break;
    case 'settings':
      go(isPrivate ? 'flux://private-blocked?page=settings' : 'flux://settings');
      break;

    case 'downloads':    go('flux://downloads'); break;
    case 'about':        go('flux://about'); break;

    case 'bookmarks':    renderBookmarks(); openModal('bookmarks-overlay'); break;
    case 'passwords':    renderPasswords(); openModal('passwords-overlay'); break;
    case 'sync':         openModal('sync-overlay'); break;

    case 'quit':         if (window.flux?.window) window.flux.window.close(); break;
  }
}

// ===== Zakładki (modal) =====
function renderBookmarks() {
  if (!bookmarksListEl) return;
  const bookmarks = loadBookmarks().slice().reverse();
  if (bookmarks.length === 0) {
    bookmarksListEl.innerHTML = '<div class="list-empty">Brak zakładek. Kliknij ⭐ w pasku adresu, aby dodać.</div>';
    return;
  }
  bookmarksListEl.innerHTML = '';
  bookmarks.forEach(item => {
    const el = document.createElement('div');
    el.className = 'list-item';
    const fav = getFaviconUrl(item.url);
    el.innerHTML = `
      <span class="list-item-favicon">
        ${fav ? `<img src="${fav}" width="16" height="16" onerror="this.style.display='none'"/>` : '⭐'}
      </span>
      <div class="list-item-content">
        <div class="list-item-title">${escapeHtml(item.title)}</div>
        <div class="list-item-url">${escapeHtml(item.url)}</div>
      </div>
    `;
    el.addEventListener('click', () => {
      const tab = tabs.find(t => t.id === activeTabId);
      if (tab) tab.webview.loadURL(item.url);
      closeModal('bookmarks-overlay');
    });
    bookmarksListEl.appendChild(el);
  });
}

// ===== Hasła (modal) =====
async function renderPasswords() {
  if (!passwordsListEl) return;
  if (!window.flux?.passwords) return;
  const list = await window.flux.passwords.list();
  if (!list || list.length === 0) {
    passwordsListEl.innerHTML = '<div class="list-empty">Brak zapisanych haseł</div>';
    return;
  }
  passwordsListEl.innerHTML = '';
  list.forEach(item => {
    const el = document.createElement('div');
    el.className = 'list-item';
    el.innerHTML = `
      <span class="list-item-favicon">🔒</span>
      <div class="list-item-content">
        <div class="list-item-title">${escapeHtml(item.host)}</div>
        <div class="list-item-url">${escapeHtml(item.username)}</div>
      </div>
    `;
    passwordsListEl.appendChild(el);
  });
}

// ===== Sync =====
document.getElementById('export-data')?.addEventListener('click', async () => {
  const data = {
    version: '0.1.0',
    exportedAt: new Date().toISOString(),
    settings: settingsCache,
    bookmarks: loadBookmarks(),
    history: loadHistory()
  };

  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `flux-sync-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

document.getElementById('import-data')?.addEventListener('click', () => {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/json';
  input.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        const data = JSON.parse(ev.target.result);
        if (data.settings) {
          for (const [k, v] of Object.entries(data.settings)) {
            await setSetting(k, v);
          }
        }
        if (data.bookmarks) saveBookmarks(data.bookmarks);
        if (data.history)   saveHistory(data.history);
        alert('Dane zaimportowane. Zrestartuj przeglądarkę.');
      } catch (err) {
        alert('Nie udało się zaimportować: ' + err.message);
      }
    };
    reader.readAsText(file);
  };
  input.click();
});

// ===== Skróty klawiszowe =====
document.addEventListener('keydown', (e) => {
  const ctrl = e.ctrlKey || e.metaKey;

  if (ctrl && e.shiftKey && (e.key === 'N' || e.key === 'n')) {
    e.preventDefault();
    if (window.flux?.window) window.flux.window.newPrivate();
  }
  else if (ctrl && e.key === 't') { e.preventDefault(); createTab(); }
  else if (ctrl && e.key === 'n') { e.preventDefault(); if (window.flux?.window) window.flux.window.newWindow(); }
  else if (ctrl && e.key === 'w') { e.preventDefault(); if (activeTabId) closeTab(activeTabId); }
  else if (ctrl && e.key === 'l') { e.preventDefault(); urlInput.focus(); urlInput.select(); }
  else if (ctrl && e.key === 'd') { e.preventDefault(); btnBookmark.click(); }
  else if (ctrl && e.key === 'y') { e.preventDefault(); handleMenuAction('history'); }
  else if (ctrl && e.key === 'j') { e.preventDefault(); handleMenuAction('downloads'); }
  else if (ctrl && e.key === ',') { e.preventDefault(); handleMenuAction('settings'); }
  else if (e.key === 'F5') { e.preventDefault(); const t = tabs.find(t => t.id === activeTabId); if (t) t.webview.reload(); }
  else if (ctrl && e.key === 'r') { e.preventDefault(); const t = tabs.find(t => t.id === activeTabId); if (t) t.webview.reload(); }
  else if (ctrl && (e.key === '=' || e.key === '+')) { e.preventDefault(); handleZoom('zoom-in'); }
  else if (ctrl && e.key === '-') { e.preventDefault(); handleZoom('zoom-out'); }
  else if (ctrl && e.key === '0') { e.preventDefault(); handleZoom('zoom-reset'); }
  else if (e.key === 'Escape') { closeMenu(); closeShield(); }
});

// ==================================================
// START
// ==================================================
(async () => {
  console.log('[Flux] Startuję renderer...');
  console.log('[Flux] Tryb prywatny:', isPrivate);

  await initSettings();
  console.log('[Flux] Ustawienia po initSettings:', settingsCache);

  const savedTheme = settingsCache.theme || 'dark';
  applyTheme(savedTheme);
  console.log('[Flux] Motyw:', isPrivate ? 'dark (wymuszony)' : savedTheme);

  const savedPalette = settingsCache.palette || 'neutral';
  applyPalette(savedPalette);
  console.log('[Flux] Paleta:', savedPalette);

  setupSyncListeners();
  createTab();

  console.log('[Flux] Gotowe');
})();