import { createSearchBar } from './components/SearchBar.js';
import { createWorkspaceLane } from './components/WorkspaceLane.js';
import { createSettingsPanel } from './components/SettingsPanel.js';
import { clusterTabsByDomain } from './utils/domainCluster.js';
import { getAllThumbnails } from './utils/thumbnailCache.js';
import { getWorkspaceData, createWorkspace, assignTab } from './utils/workspaceManager.js';
import { show as showContextMenu } from './components/ContextMenu.js';

const hasNativeGroups = typeof chrome.tabGroups !== 'undefined';

async function handleNewTabBehavior() {
  const { newTabBehavior, homepageUrl } = await chrome.storage.sync.get(['newTabBehavior', 'homepageUrl']);
  if (newTabBehavior === 'focus-pinned') {
    const currentTab = await chrome.tabs.getCurrent();
    const [pinned] = await chrome.tabs.query({ pinned: true });
    if (pinned && currentTab && pinned.id !== currentTab.id) {
      await chrome.tabs.update(pinned.id, { active: true });
      window.close();
    }
  } else if (newTabBehavior === 'open-homepage' && homepageUrl?.trim()) {
    const [currentTab, { meridianTabId }] = await Promise.all([
      chrome.tabs.getCurrent(),
      chrome.storage.local.get('meridianTabId'),
    ]);
    if (!currentTab || currentTab.id === meridianTabId) return;
    await chrome.tabs.update(currentTab.id, { url: homepageUrl.trim() });
  }
}

let searchBarApi = null;

function setupKeyboardNav() {
  document.addEventListener('keydown', (e) => {
    const tag = document.activeElement?.tagName;
    const isEditing =
      tag === 'INPUT' || tag === 'TEXTAREA' ||
      document.activeElement?.contentEditable === 'true';

    if (e.key === '/' && !isEditing) {
      e.preventDefault();
      searchBarApi?.focus();
      return;
    }

    if ((e.key === 'n' || e.key === 'N') && !isEditing) {
      e.preventDefault();
      handleNewGroup();
      return;
    }

    if (e.key === 'Escape') {
      const overlay = document.getElementById('settings-overlay');
      if (!overlay.classList.contains('hidden')) { closeSettings(); return; }
      if (document.activeElement?.tagName === 'INPUT') {
        document.activeElement.blur();
        focusFirstCard();
      }
      return;
    }

    if (['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
      if (isEditing) return;
      e.preventDefault();
      navigateCards(e.key);
    }
  });
}

function navigateCards(key) {
  const cards = [...document.querySelectorAll('.tab-card')];
  if (!cards.length) return;
  const focused = document.activeElement;
  if (!cards.includes(focused)) { cards[0].focus(); return; }

  const grid = focused.closest('.tab-grid');
  const gridCards = [...grid.querySelectorAll('.tab-card')];
  const cols = Math.round(grid.offsetWidth / (focused.offsetWidth + 10)) || 1;
  const gridIdx = gridCards.indexOf(focused);
  const allIdx = cards.indexOf(focused);

  let next = null;
  if (key === 'ArrowRight') next = cards[allIdx + 1];
  if (key === 'ArrowLeft') next = cards[allIdx - 1];
  if (key === 'ArrowDown') next = gridCards[gridIdx + cols] ?? cards[allIdx + 1];
  if (key === 'ArrowUp') next = gridIdx - cols >= 0 ? gridCards[gridIdx - cols] : cards[allIdx - 1];

  next?.focus();
}

function focusFirstCard() {
  document.querySelector('.tab-card')?.focus();
}

async function handleNewGroup() {
  const name = prompt('New group name:');
  if (!name?.trim()) return;

  if (hasNativeGroups) {
    // Create a blank inactive tab to anchor the group; user fills it in or drags tabs in
    const tab = await chrome.tabs.create({ active: false, url: 'about:blank' });
    const groupId = await chrome.tabs.group({ tabIds: [tab.id] });
    await chrome.tabGroups.update(groupId, { title: name.trim() });
    await render();
    requestAnimationFrame(() => {
      document.querySelector('.new-tab-active:not(.hidden) .new-tab-url-input')?.focus();
    });
    return;
  }

  // Fallback only when browser has no native tab group support
  await createWorkspace(name.trim());
  scheduleRender();
}

async function handleTabClosed(tabId) {
  await chrome.tabs.remove(tabId);
}

function openSettings() {
  document.getElementById('settings-overlay').classList.remove('hidden');
}

function closeSettings() {
  document.getElementById('settings-overlay').classList.add('hidden');
}

function colorLabel(color) {
  return color ? color.charAt(0).toUpperCase() + color.slice(1) : 'Group';
}

let renderScheduled = false;

function scheduleRender() {
  if (renderScheduled) return;
  renderScheduled = true;
  setTimeout(async () => {
    renderScheduled = false;
    await render();
  }, 50);
}

async function render() {
  const container = document.getElementById('workspace-container');
  container.innerHTML = '';

  const { groupByDomain } = await chrome.storage.sync.get('groupByDomain');

  const chromeGroupsPromise = hasNativeGroups ? chrome.tabGroups.query({}) : Promise.resolve([]);

  const [allTabs, chromeGroups, thumbnails, currentTab, wsData] = await Promise.all([
    chrome.tabs.query({}),
    chromeGroupsPromise,
    getAllThumbnails(),
    chrome.tabs.getCurrent(),
    getWorkspaceData(),
  ]);

  const meridianUrl = chrome.runtime.getURL('newtab.html');
  const visibleTabs = allTabs.filter(t =>
    t.id !== currentTab?.id &&
    t.url !== meridianUrl && t.pendingUrl !== meridianUrl &&
    t.url !== 'chrome://newtab/' && t.pendingUrl !== 'chrome://newtab/'
  );

  const groupMap = new Map(chromeGroups.map(g => [g.id, g]));
  const chromeGroupedMap = new Map();
  const ungroupedTabs = [];

  for (const tab of visibleTabs) {
    if (hasNativeGroups && tab.groupId !== -1) {
      if (!chromeGroupedMap.has(tab.groupId)) chromeGroupedMap.set(tab.groupId, []);
      chromeGroupedMap.get(tab.groupId).push(tab);
    } else {
      ungroupedTabs.push(tab);
    }
  }

  // Distribute ungrouped tabs into Meridian workspaces
  const customWorkspaces = wsData.workspaces.filter(w => w.id !== 'unsorted');
  const wsTabMap = new Map(customWorkspaces.map(w => [w.id, []]));
  const trulyUnsorted = [];

  for (const tab of ungroupedTabs) {
    const wsId = wsData.assignments[String(tab.id)];
    if (wsId && wsTabMap.has(wsId)) {
      wsTabMap.get(wsId).push(tab);
    } else {
      trulyUnsorted.push(tab);
    }
  }

  // 1. Unsorted / domain clusters first
  if (groupByDomain) {
    const clusters = clusterTabsByDomain(trulyUnsorted);
    for (const [name, clusterTabs] of clusters) {
      const workspace = { id: `dc_${name}`, name };
      const lane = createWorkspaceLane(workspace, clusterTabs, thumbnails, handleTabClosed);
      lane.addEventListener('workspace-reassigned', scheduleRender);
      container.appendChild(lane);
    }
  } else if (trulyUnsorted.length > 0) {
    const workspace = { id: 'unsorted', name: 'Unsorted' };
    const lane = createWorkspaceLane(workspace, trulyUnsorted, thumbnails, handleTabClosed);
    lane.addEventListener('workspace-reassigned', scheduleRender);
    container.appendChild(lane);
  }

  // 2. Meridian workspace lanes (always shown, even if empty)
  for (const ws of customWorkspaces) {
    const wsTabs = wsTabMap.get(ws.id) ?? [];
    const lane = createWorkspaceLane(
      { id: ws.id, name: ws.name },
      wsTabs,
      thumbnails,
      handleTabClosed,
      { meridianWorkspace: ws }
    );
    lane.addEventListener('workspace-reassigned', scheduleRender);
    container.appendChild(lane);
  }

  // 3. Chrome tab group lanes
  for (const [groupId, tabs] of chromeGroupedMap) {
    const group = groupMap.get(groupId);
    const name = group?.title?.trim() || colorLabel(group?.color);
    const workspace = { id: `cg_${groupId}`, name };
    const lane = createWorkspaceLane(workspace, tabs, thumbnails, handleTabClosed, { chromeGroup: group });
    lane.addEventListener('workspace-reassigned', scheduleRender);
    container.appendChild(lane);
  }

}

async function init() {
  await handleNewTabBehavior();

  searchBarApi = createSearchBar(document.getElementById('search-bar'));

  const settingsOverlay = document.getElementById('settings-overlay');
  const settingsContainer = document.getElementById('settings-panel');
  const settingsBtn = document.getElementById('settings-btn');
  const newGroupBtn = document.getElementById('new-group-btn');

  createSettingsPanel(settingsContainer, closeSettings);

  settingsBtn.addEventListener('click', openSettings);
  newGroupBtn.addEventListener('click', handleNewGroup);
  settingsOverlay.addEventListener('click', (e) => {
    if (e.target === settingsOverlay) closeSettings();
  });

  setupKeyboardNav();

  document.addEventListener('tab-context-menu', (e) => {
    showContextMenu(e.detail.tab, e.detail.x, e.detail.y);
  });

  const dropZone = document.getElementById('new-group-drop-zone');
  document.addEventListener('dragstart', () => dropZone.classList.remove('hidden'));
  document.addEventListener('dragend', () => dropZone.classList.add('hidden'));
  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('drag-over');
  });
  dropZone.addEventListener('dragleave', (e) => {
    if (!dropZone.contains(e.relatedTarget)) dropZone.classList.remove('drag-over');
  });
  dropZone.addEventListener('drop', async (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    const tabId = parseInt(e.dataTransfer.getData('text/plain'), 10);
    if (!tabId) return;
    const name = prompt('New group name:');
    if (!name?.trim()) return;
    if (hasNativeGroups) {
      const groupId = await chrome.tabs.group({ tabIds: [tabId] });
      await chrome.tabGroups.update(groupId, { title: name.trim() });
    } else {
      const ws = await createWorkspace(name.trim());
      await assignTab(tabId, ws.id);
    }
    scheduleRender();
  });

  await render();

  chrome.tabs.onCreated.addListener(scheduleRender);
  chrome.tabs.onRemoved.addListener(scheduleRender);
  chrome.tabs.onUpdated.addListener((id, info) => {
    if (info.title || info.favIconUrl || info.groupId !== undefined) scheduleRender();
  });

  if (hasNativeGroups) {
    chrome.tabGroups.onCreated.addListener(scheduleRender);
    chrome.tabGroups.onRemoved.addListener(scheduleRender);
    chrome.tabGroups.onUpdated.addListener(scheduleRender);
  }

  window.addEventListener('settings-changed', scheduleRender);

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) scheduleRender();
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    const keys = Object.keys(changes);
    if (keys.some(k => k.startsWith('thumb_') || k === 'workspaces')) {
      scheduleRender();
    }
  });
}

init();
