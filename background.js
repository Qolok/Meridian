let meridianTabId = null;

function getMeridianUrl() {
  return chrome.runtime.getURL('newtab.html');
}

function isMeridianTab(tab) {
  const url = getMeridianUrl();
  return tab.url === url || tab.pendingUrl === url ||
         tab.url === 'chrome://newtab/' || tab.pendingUrl === 'chrome://newtab/';
}

async function ensureMeridianTab() {
  const tabs = await chrome.tabs.query({ pinned: true });
  const existing = tabs.find(isMeridianTab);
  if (existing) {
    meridianTabId = existing.id;
    chrome.storage.local.set({ meridianTabId: existing.id });
    return;
  }
  // Use the direct extension URL so Chrome doesn't redirect to the homepage
  const tab = await chrome.tabs.create({ pinned: true, index: 0, url: getMeridianUrl() });
  meridianTabId = tab.id;
  chrome.storage.local.set({ meridianTabId: tab.id });
}

async function resolveMeridianTabId() {
  if (meridianTabId !== null) return;
  // Check persisted ID first — survives service worker restarts
  const { meridianTabId: storedId } = await chrome.storage.local.get('meridianTabId');
  if (storedId) {
    try {
      const tab = await chrome.tabs.get(storedId);
      if (tab && tab.pinned) { meridianTabId = storedId; return; }
    } catch (_) { /* tab gone */ }
  }
  const tabs = await chrome.tabs.query({ pinned: true });
  const m = tabs.find(isMeridianTab);
  if (m) {
    meridianTabId = m.id;
    chrome.storage.local.set({ meridianTabId: m.id });
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function captureTab(tabId, windowId) {
  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: 'jpeg', quality: 60 });
    await chrome.storage.local.set({ ['thumb_' + tabId]: dataUrl });
    console.log('[Meridian] Saved thumbnail for tab', tabId);
  } catch (err) {
    console.warn('[Meridian] captureVisibleTab failed for tab', tabId, ':', err.message);
  }
}

chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason !== 'install') {
    // On reload/update: navigate the existing Meridian tab back to the extension page
    const { meridianTabId: storedId } = await chrome.storage.local.get('meridianTabId');
    if (storedId) {
      try {
        await chrome.tabs.update(storedId, { url: getMeridianUrl() });
        meridianTabId = storedId;
        return;
      } catch (_) { /* tab was closed, fall through to create */ }
    }
  }
  ensureMeridianTab();
});

chrome.runtime.onStartup.addListener(ensureMeridianTab);

chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.local.remove('thumb_' + tabId);
  if (tabId === meridianTabId) {
    meridianTabId = null;
    chrome.storage.local.remove('meridianTabId');
    setTimeout(ensureMeridianTab, 500);
  }
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'focus-meridian') return;
  await resolveMeridianTabId();
  if (meridianTabId !== null) {
    chrome.tabs.update(meridianTabId, { active: true });
  } else {
    ensureMeridianTab();
  }
});

let isRefreshing = false;
let lastActivation = { tabId: null, windowId: null, time: 0 };

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  if (isRefreshing) return;
  await resolveMeridianTabId();
  if (activeInfo.tabId === meridianTabId) return;
  const captureTime = Date.now();
  lastActivation = { tabId: activeInfo.tabId, windowId: activeInfo.windowId, time: captureTime };
  await sleep(600);
  if (lastActivation.time !== captureTime) return;
  await captureTab(activeInfo.tabId, activeInfo.windowId);
});

let lastUpdate = { tabId: null, windowId: null, time: 0 };

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (isRefreshing) return;
  if (changeInfo.status !== 'complete' || !tab.active) return;
  await resolveMeridianTabId();
  if (tabId === meridianTabId) return;
  const captureTime = Date.now();
  lastUpdate = { tabId, windowId: tab.windowId, time: captureTime };
  await sleep(400);
  if (lastUpdate.time !== captureTime) return;
  await captureTab(tabId, tab.windowId);
});

async function refreshAllThumbnails() {
  await resolveMeridianTabId();
  const allTabs = await chrome.tabs.query({});
  const capturable = allTabs.filter(t =>
    t.id !== meridianTabId &&
    t.url && !t.url.startsWith('chrome://') &&
    !t.url.startsWith('chrome-extension://') &&
    !t.url.startsWith('about:')
  );

  const activeTabs = await chrome.tabs.query({ active: true });
  const originalActive = new Map(activeTabs.map(t => [t.windowId, t.id]));

  isRefreshing = true;
  try {
    for (const tab of capturable) {
      await chrome.tabs.update(tab.id, { active: true });
      await sleep(800);
      await captureTab(tab.id, tab.windowId);
    }
  } finally {
    isRefreshing = false;
  }

  for (const [windowId, tabId] of originalActive) {
    await chrome.tabs.update(tabId, { active: true }).catch(() => {});
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'GET_TABS') {
    chrome.tabs.query({}).then(tabs => sendResponse(tabs));
    return true;
  }
  if (msg.type === 'CLOSE_TAB') {
    chrome.tabs.remove(msg.tabId);
  }
  if (msg.type === 'REFRESH_THUMBNAILS') {
    refreshAllThumbnails().then(() => sendResponse({ done: true }));
    return true;
  }
});
