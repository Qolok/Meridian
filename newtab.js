import { createSearchBar } from './components/SearchBar.js';
import { createWorkspaceLane } from './components/WorkspaceLane.js';
import { createSettingsPanel } from './components/SettingsPanel.js';
import { clusterTabsByDomain } from './utils/domainCluster.js';
import { getAllThumbnails } from './utils/thumbnailCache.js';

async function handleNewTabBehavior() {
  const { newTabBehavior } = await chrome.storage.sync.get('newTabBehavior');
  if (newTabBehavior !== 'focus-pinned') return;
  const currentTab = await chrome.tabs.getCurrent();
  const [pinned] = await chrome.tabs.query({ pinned: true });
  if (pinned && currentTab && pinned.id !== currentTab.id) {
    await chrome.tabs.update(pinned.id, { active: true });
    window.close();
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
      handleNewChromeGroup();
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

async function handleNewChromeGroup() {
  const name = prompt('New tab group name:');
  if (!name?.trim()) return;
  // Create group with the focused/first visible card's tab if possible
  const focused = document.activeElement;
  const tabId = focused?.dataset?.tabId ? parseInt(focused.dataset.tabId, 10) : null;
  if (tabId) {
    const groupId = await chrome.tabs.group({ tabIds: [tabId] });
    await chrome.tabGroups.update(groupId, { title: name.trim() });
    await render();
  }
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

async function render() {
  const container = document.getElementById('workspace-container');
  container.innerHTML = '';

  const { groupByDomain } = await chrome.storage.sync.get('groupByDomain');

  const [allTabs, chromeGroups, thumbnails] = await Promise.all([
    chrome.tabs.query({}),
    chrome.tabGroups.query({}),
    getAllThumbnails(),
  ]);

  const meridianUrl = chrome.runtime.getURL('newtab.html');
  const visibleTabs = allTabs.filter(t =>
    t.url !== meridianUrl && t.pendingUrl !== meridianUrl &&
    t.url !== 'chrome://newtab/' && t.pendingUrl !== 'chrome://newtab/'
  );

  const groupMap = new Map(chromeGroups.map(g => [g.id, g]));
  const groupedMap = new Map();
  const ungroupedTabs = [];

  for (const tab of visibleTabs) {
    if (tab.groupId !== -1) {
      if (!groupedMap.has(tab.groupId)) groupedMap.set(tab.groupId, []);
      groupedMap.get(tab.groupId).push(tab);
    } else {
      ungroupedTabs.push(tab);
    }
  }

  // Ungrouped tabs first (Unsorted or domain clusters)
  if (groupByDomain) {
    const clusters = clusterTabsByDomain(ungroupedTabs);
    for (const [name, clusterTabs] of clusters) {
      const workspace = { id: `dc_${name}`, name };
      const lane = createWorkspaceLane(workspace, clusterTabs, thumbnails, handleTabClosed);
      lane.addEventListener('workspace-reassigned', render);
      container.appendChild(lane);
    }
  } else if (ungroupedTabs.length > 0) {
    const workspace = { id: 'unsorted', name: 'Unsorted' };
    const lane = createWorkspaceLane(workspace, ungroupedTabs, thumbnails, handleTabClosed);
    lane.addEventListener('workspace-reassigned', render);
    container.appendChild(lane);
  }

  // Chrome tab group lanes below
  for (const [groupId, tabs] of groupedMap) {
    const group = groupMap.get(groupId);
    const name = group?.title?.trim() || colorLabel(group?.color);
    const workspace = { id: `cg_${groupId}`, name };
    const lane = createWorkspaceLane(workspace, tabs, thumbnails, handleTabClosed, { chromeGroup: group });
    lane.addEventListener('workspace-reassigned', render);
    container.appendChild(lane);
  }
}

async function init() {
  await handleNewTabBehavior();

  searchBarApi = createSearchBar(document.getElementById('search-bar'));

  const settingsOverlay = document.getElementById('settings-overlay');
  const settingsContainer = document.getElementById('settings-panel');
  const settingsBtn = document.getElementById('settings-btn');

  createSettingsPanel(settingsContainer, closeSettings);

  settingsBtn.addEventListener('click', openSettings);
  settingsOverlay.addEventListener('click', (e) => {
    if (e.target === settingsOverlay) closeSettings();
  });

  setupKeyboardNav();

  await render();

  chrome.tabs.onCreated.addListener(render);
  chrome.tabs.onRemoved.addListener(render);
  chrome.tabs.onUpdated.addListener((id, info) => {
    if (info.title || info.favIconUrl || info.groupId !== undefined) render();
  });
  chrome.tabGroups.onCreated.addListener(render);
  chrome.tabGroups.onRemoved.addListener(render);
  chrome.tabGroups.onUpdated.addListener(render);

  window.addEventListener('settings-changed', render);

  // Re-render when Meridian regains focus so new thumbnails appear
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) render();
  });

  // Re-render whenever a thumbnail is written to storage
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && Object.keys(changes).some(k => k.startsWith('thumb_'))) {
      render();
    }
  });
}

init();
