import { search, getPreviousTab } from '../utils/browserSearch.js';

const PROVIDER_URLS = {
  google: 'https://www.google.com/search?q=',
  duckduckgo: 'https://duckduckgo.com/?q=',
  bing: 'https://www.bing.com/search?q=',
  brave: 'https://search.brave.com/search?q=',
};

const GROUP_COLORS = {
  grey: '#9aa0a6',
  blue: '#4285f4',
  red: '#ea4335',
  yellow: '#fbbc04',
  green: '#34a853',
  pink: '#e91e63',
  purple: '#9c27b0',
  cyan: '#00bcd4',
  orange: '#ff9800',
};

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let query = '';
let previousTab = null;
let allTabs = [];
let workspaceData = null;
let chromeGroups = [];
let isSearching = false;
let meridianTabId = null;
let draggedTabId = null;
let collapsedSections = new Set();

const COLLAPSED_KEY = 'sidebarCollapsed';

const hasNativeGroups = typeof chrome.tabGroups !== 'undefined';

// ---------------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------------

async function loadAll() {
  const [tabs, groups, wsStore, localStore, prev] = await Promise.all([
    chrome.tabs.query({ currentWindow: true }),
    hasNativeGroups ? chrome.tabGroups.query({ windowId: chrome.windows.WINDOW_ID_CURRENT }) : Promise.resolve([]),
    chrome.storage.local.get('workspaces'),
    chrome.storage.local.get('meridianTabId'),
    getPreviousTab().catch(() => null),
  ]);

  meridianTabId = localStore.meridianTabId ?? null;
  allTabs = tabs.filter((t) => t.id !== meridianTabId);
  chromeGroups = groups;
  workspaceData = wsStore.workspaces ?? null;
  previousTab = prev?.id === meridianTabId ? null : prev;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function faviconUrl(url) {
  try {
    const domain = new URL(url).hostname;
    return `https://www.google.com/s2/favicons?domain=${domain}&sz=16`;
  } catch {
    return '';
  }
}

function makeFaviconImg(url, favIconUrl) {
  const img = document.createElement('img');
  img.className = 'tab-favicon';
  const src = favIconUrl || (url ? faviconUrl(url) : '');
  if (src) img.src = src;
  img.onerror = () => {
    img.style.display = 'none';
  };
  return img;
}

function makeSection(label, colorDot) {
  const section = document.createElement('div');
  section.className = 'tab-section';

  if (label) {
    if (collapsedSections.has(label)) section.classList.add('collapsed');

    const labelRow = document.createElement('div');
    labelRow.className = 'section-label';

    if (colorDot) {
      const dot = document.createElement('span');
      dot.className = 'group-dot';
      dot.style.background = colorDot;
      labelRow.appendChild(dot);
    }

    const text = document.createElement('span');
    text.textContent = label;
    labelRow.appendChild(text);

    const chevron = document.createElement('span');
    chevron.className = 'section-chevron';
    chevron.innerHTML = `<svg viewBox="0 0 10 6" width="10" height="6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M1 1l4 4 4-4"/></svg>`;
    labelRow.appendChild(chevron);

    labelRow.addEventListener('click', () => {
      const isNowCollapsed = section.classList.toggle('collapsed');
      if (isNowCollapsed) {
        collapsedSections.add(label);
      } else {
        collapsedSections.delete(label);
      }
      chrome.storage.local.set({ [COLLAPSED_KEY]: [...collapsedSections] });
    });

    section.appendChild(labelRow);
  }

  return section;
}

// ---------------------------------------------------------------------------
// Drag and drop
// ---------------------------------------------------------------------------

function attachDragEvents(row, tab) {
  row.draggable = true;

  row.addEventListener('dragstart', (e) => {
    draggedTabId = tab.id;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(tab.id));
    requestAnimationFrame(() => row.classList.add('dragging'));
  });

  row.addEventListener('dragend', () => {
    draggedTabId = null;
    row.classList.remove('dragging');
    document.querySelectorAll('.drag-over').forEach((el) => el.classList.remove('drag-over'));
  });

  row.addEventListener('dragover', (e) => {
    if (!draggedTabId || draggedTabId === tab.id) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    document.querySelectorAll('.drag-over').forEach((el) => el.classList.remove('drag-over'));
    row.classList.add('drag-over');
  });

  row.addEventListener('dragleave', (e) => {
    if (!row.contains(e.relatedTarget)) row.classList.remove('drag-over');
  });

  row.addEventListener('drop', async (e) => {
    e.preventDefault();
    row.classList.remove('drag-over');
    const sourceId = parseInt(e.dataTransfer.getData('text/plain'), 10);
    if (!sourceId || sourceId === tab.id) return;
    try {
      await chrome.tabs.move(sourceId, { index: tab.index });
    } catch (_) {}
  });
}

// ---------------------------------------------------------------------------
// Tab row builder
// ---------------------------------------------------------------------------

function buildTabRow(tab) {
  const row = document.createElement('div');
  row.className = 'tab-row';
  row.title = tab.title || tab.url || '';

  row.appendChild(makeFaviconImg(tab.url, tab.favIconUrl));

  const body = document.createElement('div');
  body.className = 'tab-body';

  const title = document.createElement('div');
  title.className = 'tab-title';
  title.textContent = tab.title || tab.url || 'Untitled';
  body.appendChild(title);
  row.appendChild(body);

  const closeBtn = document.createElement('button');
  closeBtn.className = 'tab-close-btn';
  closeBtn.setAttribute('aria-label', 'Close tab');
  closeBtn.textContent = '×';
  closeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    chrome.tabs.remove(tab.id);
  });
  row.appendChild(closeBtn);

  row.addEventListener('click', () => chrome.tabs.update(tab.id, { active: true }));

  attachDragEvents(row, tab);
  return row;
}

// ---------------------------------------------------------------------------
// Render — default tab list
// ---------------------------------------------------------------------------

function renderTabList() {
  const container = document.getElementById('tab-list');
  container.innerHTML = '';

  // Previous tab shortcut
  if (previousTab) {
    const section = makeSection(null);
    section.classList.add('prev-section');

    const row = document.createElement('div');
    row.className = 'tab-row';

    const label = document.createElement('span');
    label.className = 'prev-label';
    label.textContent = '↩';
    row.appendChild(label);

    row.appendChild(makeFaviconImg(previousTab.url, previousTab.favIconUrl));

    const body = document.createElement('div');
    body.className = 'tab-body';
    const title = document.createElement('div');
    title.className = 'tab-title';
    title.textContent = previousTab.title || previousTab.url || 'Previous tab';
    body.appendChild(title);
    row.appendChild(body);

    row.addEventListener('click', () => chrome.tabs.update(previousTab.id, { active: true }));
    section.appendChild(row);
    container.appendChild(section);
  }

  // Separate Chrome-grouped tabs from ungrouped
  const groupedMap = new Map();
  const ungrouped = [];

  for (const tab of allTabs) {
    if (hasNativeGroups && tab.groupId != null && tab.groupId !== -1) {
      if (!groupedMap.has(tab.groupId)) groupedMap.set(tab.groupId, []);
      groupedMap.get(tab.groupId).push(tab);
    } else {
      ungrouped.push(tab);
    }
  }

  if (workspaceData?.workspaces?.length > 0 && workspaceData?.assignments) {
    const { workspaces, assignments } = workspaceData;

    // Unsorted first
    const unsortedTabs = ungrouped.filter(
      (t) => (assignments[String(t.id)] ?? 'unsorted') === 'unsorted',
    );
    if (unsortedTabs.length > 0) {
      const section = makeSection('Unsorted');
      for (const tab of unsortedTabs) section.appendChild(buildTabRow(tab));
      container.appendChild(section);
    }

    // Chrome tab groups
    for (const [groupId, tabs] of groupedMap) {
      const group = chromeGroups.find((g) => g.id === groupId);
      const label =
        group?.title?.trim() ||
        (group?.color
          ? group.color.charAt(0).toUpperCase() + group.color.slice(1)
          : 'Group');
      const colorHex = GROUP_COLORS[group?.color] ?? '#9aa0a6';

      const section = makeSection(label, colorHex);
      for (const tab of tabs) section.appendChild(buildTabRow(tab));
      container.appendChild(section);
    }

    // Named Meridian workspaces
    for (const ws of workspaces) {
      if (ws.id === 'unsorted') continue;
      const wsTabs = ungrouped.filter((t) => assignments[String(t.id)] === ws.id);
      if (wsTabs.length === 0) continue;

      const section = makeSection(ws.name);
      for (const tab of wsTabs) section.appendChild(buildTabRow(tab));
      container.appendChild(section);
    }
  } else {
    // No workspace data — Chrome groups then flat ungrouped list
    for (const [groupId, tabs] of groupedMap) {
      const group = chromeGroups.find((g) => g.id === groupId);
      const label =
        group?.title?.trim() ||
        (group?.color
          ? group.color.charAt(0).toUpperCase() + group.color.slice(1)
          : 'Group');
      const colorHex = GROUP_COLORS[group?.color] ?? '#9aa0a6';

      const section = makeSection(label, colorHex);
      for (const tab of tabs) section.appendChild(buildTabRow(tab));
      container.appendChild(section);
    }

    const section = makeSection('Open Tabs');
    for (const tab of ungrouped) section.appendChild(buildTabRow(tab));
    container.appendChild(section);
  }
}

// ---------------------------------------------------------------------------
// Render — search results
// ---------------------------------------------------------------------------

function buildResultRow(item) {
  const row = document.createElement('div');
  row.className = 'tab-row';

  row.appendChild(makeFaviconImg(item.url, null));

  const body = document.createElement('div');
  body.className = 'tab-body';

  const title = document.createElement('div');
  title.className = 'tab-title';
  title.textContent = item.title || item.url || '';
  body.appendChild(title);

  const meta = document.createElement('div');
  meta.className = 'tab-meta';
  try {
    meta.textContent = new URL(item.url).hostname;
  } catch {
    meta.textContent = item.url || '';
  }
  body.appendChild(meta);

  row.appendChild(body);

  row.addEventListener('click', async () => {
    if (item.tabId != null) {
      await chrome.tabs.update(item.tabId, { active: true });
    } else {
      await chrome.tabs.create({ url: item.url });
    }
  });

  return row;
}

function renderResultSection(container, label, items) {
  if (!items.length) return;
  const section = makeSection(label);
  for (const item of items.slice(0, 10)) section.appendChild(buildResultRow(item));
  container.appendChild(section);
}

async function runSearch(q) {
  const container = document.getElementById('tab-list');
  const results = await search(q);
  const { localSearch } = await chrome.storage.sync.get("localSearch");
  const ls = localSearch ?? { tabs: true, bookmarks: true, history: true };
  if (!ls.tabs) results.tabs = [];
  if (!ls.bookmarks) results.bookmarks = [];
  if (!ls.history) results.history = [];
  container.innerHTML = '';

  const total =
    results.tabs.length + results.bookmarks.length + results.history.length;

  if (total === 0) {
    const { searchProvider } = await chrome.storage.sync.get('searchProvider');
    const baseUrl = PROVIDER_URLS[searchProvider] ?? PROVIDER_URLS.google;

    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.appendChild(document.createTextNode('No results — '));
    const btn = document.createElement('button');
    btn.className = 'search-web-btn';
    btn.textContent = 'search the web';
    btn.addEventListener('click', () =>
      chrome.tabs.create({ url: baseUrl + encodeURIComponent(q) }),
    );
    empty.appendChild(btn);
    container.appendChild(empty);
    return;
  }

  renderResultSection(container, 'Open Tabs', results.tabs);
  renderResultSection(container, 'Bookmarks', results.bookmarks);
  renderResultSection(container, 'History', results.history);
}

// ---------------------------------------------------------------------------
// Live updates
// ---------------------------------------------------------------------------

function refreshIfIdle() {
  if (isSearching) return;
  loadAll().then(renderTabList);
}

chrome.tabs.onCreated.addListener(refreshIfIdle);
chrome.tabs.onRemoved.addListener(refreshIfIdle);
chrome.tabs.onMoved.addListener(refreshIfIdle);
chrome.tabs.onUpdated.addListener((_id, changeInfo) => {
  if (changeInfo.title || changeInfo.status === 'complete' || changeInfo.favIconUrl)
    refreshIfIdle();
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (changes.workspaces || changes.previousTabId))
    refreshIfIdle();
});

if (hasNativeGroups) {
  chrome.tabGroups.onCreated?.addListener(refreshIfIdle);
  chrome.tabGroups.onUpdated?.addListener(refreshIfIdle);
  chrome.tabGroups.onRemoved?.addListener(refreshIfIdle);
}

// ---------------------------------------------------------------------------
// Input listeners
// ---------------------------------------------------------------------------

function attachListeners() {
  const input = document.getElementById('search-input');

  input.addEventListener('input', async () => {
    query = input.value.trim();
    if (query === '') {
      isSearching = false;
      renderTabList();
    } else {
      isSearching = true;
      await runSearch(query);
    }
  });

  input.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter' && query) {
      e.preventDefault();
      const { searchProvider } = await chrome.storage.sync.get('searchProvider');
      const baseUrl = PROVIDER_URLS[searchProvider] ?? PROVIDER_URLS.google;
      chrome.tabs.create({ url: baseUrl + encodeURIComponent(query) });
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      document.querySelector('#tab-list .tab-row')?.focus();
      return;
    }
    if (e.key === 'Escape' && query) {
      e.preventDefault();
      input.value = '';
      query = '';
      isSearching = false;
      renderTabList();
    }
  });

  document.getElementById('new-tab-btn').addEventListener('click', () => {
    chrome.tabs.create({});
  });

  document.getElementById('meridian-btn').addEventListener('click', async () => {
    const { meridianTabId: id } = await chrome.storage.local.get('meridianTabId');
    if (id) chrome.tabs.update(id, { active: true });
  });
}

// ---------------------------------------------------------------------------
// Toolbar icon — swap to white fill in dark mode
// ---------------------------------------------------------------------------

async function updateToolbarIcon(isDark) {
  try {
    const svgUrl = chrome.runtime.getURL('img/Meridian.svg');
    let svgText = await fetch(svgUrl).then((r) => r.text());

    if (isDark) {
      svgText = svgText.replace('<svg ', '<svg fill="white" ');
    }

    const blob = new Blob([svgText], { type: 'image/svg+xml' });
    const blobUrl = URL.createObjectURL(blob);

    const imageData = Object.fromEntries(
      await Promise.all(
        [16, 32].map(
          (size) =>
            new Promise((resolve, reject) => {
              const img = new Image();
              img.onload = () => {
                const canvas = document.createElement('canvas');
                canvas.width = size;
                canvas.height = size;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, size, size);
                resolve([size, ctx.getImageData(0, 0, size, size)]);
              };
              img.onerror = reject;
              img.src = blobUrl;
            }),
        ),
      ),
    );

    URL.revokeObjectURL(blobUrl);
    await chrome.action.setIcon({ imageData });
  } catch (_) {
    // Falls back to the static PNG in manifest
  }
}

// ---------------------------------------------------------------------------
// Narrow mode (icon-only when panel is very narrow)
// ---------------------------------------------------------------------------

function setupResizeObserver() {
  const ro = new ResizeObserver(([entry]) => {
    document.body.classList.toggle('narrow', entry.contentRect.width < 64);
  });
  ro.observe(document.body);
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

async function init() {
  document.getElementById('sidebar-logo').src = chrome.runtime.getURL('img/icon32.png');

  const scheme = window.matchMedia('(prefers-color-scheme: dark)');
  updateToolbarIcon(scheme.matches);
  scheme.addEventListener('change', (e) => updateToolbarIcon(e.matches));

  const { [COLLAPSED_KEY]: saved } = await chrome.storage.local.get(COLLAPSED_KEY);
  if (Array.isArray(saved)) collapsedSections = new Set(saved);

  await loadAll();
  renderTabList();
  attachListeners();
  setupResizeObserver();

  document.getElementById('search-input').focus();
}

document.addEventListener('DOMContentLoaded', init);
