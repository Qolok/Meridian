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
    return;
  }
  const tab = await chrome.tabs.create({ pinned: true, index: 0, url: 'chrome://newtab/' });
  meridianTabId = tab.id;
}

async function resolveMeridianTabId() {
  if (meridianTabId !== null) return;
  const tabs = await chrome.tabs.query({ pinned: true });
  const m = tabs.find(isMeridianTab);
  if (m) meridianTabId = m.id;
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

chrome.runtime.onInstalled.addListener(ensureMeridianTab);
chrome.runtime.onStartup.addListener(ensureMeridianTab);

chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.local.remove('thumb_' + tabId);
  if (tabId === meridianTabId) {
    meridianTabId = null;
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

let lastActivation = { tabId: null, windowId: null, time: 0 };

chrome.tabs.onActivated.addListener(async (activeInfo) => {
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
  if (changeInfo.status !== 'complete' || !tab.active) return;
  await resolveMeridianTabId();
  if (tabId === meridianTabId) return;
  const captureTime = Date.now();
  lastUpdate = { tabId, windowId: tab.windowId, time: captureTime };
  await sleep(400);
  if (lastUpdate.time !== captureTime) return;
  await captureTab(tabId, tab.windowId);
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'GET_TABS') {
    chrome.tabs.query({}).then(tabs => sendResponse(tabs));
    return true;
  }
  if (msg.type === 'CLOSE_TAB') {
    chrome.tabs.remove(msg.tabId);
  }
});
