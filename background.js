let meridianTabId = null;

async function ensureMeridianTab() {
  const tabs = await chrome.tabs.query({ pinned: true });
  const existing = tabs.find(
    t => t.url === 'chrome://newtab/' || t.pendingUrl === 'chrome://newtab/'
  );
  if (existing) {
    meridianTabId = existing.id;
    return;
  }
  const tab = await chrome.tabs.create({ pinned: true, index: 0, url: 'chrome://newtab/' });
  meridianTabId = tab.id;
}

chrome.runtime.onInstalled.addListener(ensureMeridianTab);
chrome.runtime.onStartup.addListener(ensureMeridianTab);

chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.local.remove('thumb_' + tabId);
  if (tabId === meridianTabId) {
    meridianTabId = null;
    setTimeout(() => ensureMeridianTab(), 500);
  }
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'focus-meridian') return;
  const tabs = await chrome.tabs.query({ pinned: true });
  const meridian = tabs.find(
    t => t.url === 'chrome://newtab/' || t.pendingUrl === 'chrome://newtab/'
  );
  if (meridian) {
    chrome.tabs.update(meridian.id, { active: true });
  } else {
    ensureMeridianTab();
  }
});

chrome.tabs.onActivated.addListener((activeInfo) => {
  if (activeInfo.tabId === meridianTabId) return;
  setTimeout(() => {
    chrome.tabs.captureVisibleTab(activeInfo.windowId, { format: 'jpeg', quality: 60 })
      .then(dataUrl => chrome.storage.local.set({ ['thumb_' + activeInfo.tabId]: dataUrl }))
      .catch(() => {});
  }, 300);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.active && tabId !== meridianTabId) {
    setTimeout(() => {
      chrome.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: 60 })
        .then(dataUrl => chrome.storage.local.set({ ['thumb_' + tabId]: dataUrl }))
        .catch(() => {});
    }, 500);
  }
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
