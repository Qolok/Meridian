import { createTabCard } from './TabCard.js';
import { createNewTabCard } from './NewTabCard.js';
import { renameWorkspace, deleteWorkspace, assignTab, unassignTab } from '../utils/workspaceManager.js';

const hasNativeGroups = typeof chrome.tabGroups !== 'undefined';

const GROUP_COLORS = {
  grey: '#9aa0a6',
  blue: '#4285f4',
  red: '#ea4335',
  yellow: '#fbbc04',
  green: '#34a853',
  pink: '#ff63b8',
  purple: '#a142f4',
  cyan: '#24c1e0',
  orange: '#ff6d00',
};

const CHEVRON = `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>`;

export function createWorkspaceLane(workspace, tabs, thumbnails, onTabClosed, { chromeGroup, meridianWorkspace } = {}) {
  const lane = document.createElement('div');
  lane.className = 'workspace-lane';
  lane.dataset.workspaceId = workspace.id;

  let collapsed = false;

  // ---- Header ----
  const header = document.createElement('div');
  header.className = 'lane-header';

  const collapseBtn = document.createElement('button');
  collapseBtn.className = 'lane-collapse-btn';
  collapseBtn.innerHTML = CHEVRON;
  collapseBtn.setAttribute('aria-label', 'Collapse lane');

  if (chromeGroup?.color) {
    const dot = document.createElement('span');
    dot.className = 'lane-group-dot';
    dot.style.background = GROUP_COLORS[chromeGroup.color] ?? '#9aa0a6';
    header.appendChild(collapseBtn);
    header.appendChild(dot);
  } else {
    header.appendChild(collapseBtn);
  }

  const title = document.createElement('button');
  title.className = 'lane-title';
  title.textContent = workspace.name;
  title.setAttribute('aria-label', `Workspace: ${workspace.name}`);

  if (!chromeGroup) {
    title.addEventListener('dblclick', () => startRename(title, workspace.id));
    title.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && title.contentEditable !== 'true') startRename(title, workspace.id);
    });
  }

  const count = document.createElement('span');
  count.className = 'lane-tab-count';
  count.textContent = `${tabs.length}`;

  header.appendChild(title);
  header.appendChild(count);

  // Delete button for user-created Meridian workspaces only
  if (meridianWorkspace) {
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'lane-delete-btn';
    deleteBtn.textContent = '×';
    deleteBtn.setAttribute('aria-label', `Delete group ${workspace.name}`);
    deleteBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm(`Delete group "${workspace.name}"? Tabs will move to Unsorted.`)) return;
      await deleteWorkspace(workspace.id);
      lane.dispatchEvent(new CustomEvent('workspace-reassigned', { bubbles: true }));
    });
    header.appendChild(deleteBtn);
  }

  lane.appendChild(header);

  // ---- Collapse logic ----
  const grid = document.createElement('div');
  grid.className = 'tab-grid';

  collapseBtn.addEventListener('click', () => {
    collapsed = !collapsed;
    grid.classList.toggle('hidden', collapsed);
    collapseBtn.classList.toggle('lane-collapse-btn--collapsed', collapsed);
    collapseBtn.setAttribute('aria-label', collapsed ? 'Expand lane' : 'Collapse lane');
  });

  // ---- Tab cards ----
  for (const tab of tabs) {
    const isPlaceholder = chromeGroup &&
      (tab.url === 'about:blank' || tab.pendingUrl === 'about:blank' || (!tab.url && !tab.pendingUrl));
    if (isPlaceholder) {
      const [, activeEl] = createNewTabCard(chromeGroup.id, tab.id);
      activeEl.classList.remove('hidden');
      grid.appendChild(activeEl); // idle "+" intentionally omitted — no duplicate
    } else {
      const thumb = thumbnails[tab.id] ?? null;
      grid.appendChild(createTabCard(tab, thumb));
    }
  }
  for (const el of createNewTabCard(chromeGroup?.id ?? null)) {
    grid.appendChild(el);
  }

  lane.appendChild(grid);

  lane.addEventListener('close-tab', (e) => onTabClosed(e.detail.tabId));

  lane.addEventListener('dragover', (e) => {
    e.preventDefault();
    lane.classList.add('drag-over');
  });
  lane.addEventListener('dragleave', (e) => {
    if (!lane.contains(e.relatedTarget)) lane.classList.remove('drag-over');
  });
  lane.addEventListener('drop', async (e) => {
    e.preventDefault();
    lane.classList.remove('drag-over');
    const tabId = parseInt(e.dataTransfer.getData('text/plain'), 10);
    if (!tabId) return;

    if (chromeGroup) {
      await chrome.tabs.group({ tabIds: [tabId], groupId: chromeGroup.id });
      await unassignTab(tabId);
      // Remove any about:blank placeholder tab now that a real tab has been added
      const groupTabs = await chrome.tabs.query({ groupId: chromeGroup.id });
      const placeholder = groupTabs.find(t => t.url === 'about:blank' && t.id !== tabId);
      if (placeholder) await chrome.tabs.remove(placeholder.id).catch(() => {});
    } else if (meridianWorkspace) {
      if (hasNativeGroups) await chrome.tabs.ungroup([tabId]).catch(() => {});
      await assignTab(tabId, meridianWorkspace.id);
    } else {
      if (hasNativeGroups) await chrome.tabs.ungroup([tabId]).catch(() => {});
      await unassignTab(tabId);
    }

    lane.dispatchEvent(new CustomEvent('workspace-reassigned', { bubbles: true }));
  });

  return lane;
}

function startRename(titleEl, workspaceId) {
  const original = titleEl.textContent;
  titleEl.contentEditable = 'true';
  titleEl.focus();
  document.execCommand('selectAll', false, null);

  function commit() {
    titleEl.contentEditable = 'false';
    const newName = titleEl.textContent.trim() || original;
    titleEl.textContent = newName;
    if (newName !== original) renameWorkspace(workspaceId, newName);
  }

  titleEl.addEventListener('blur', commit, { once: true });
  titleEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); titleEl.blur(); }
    if (e.key === 'Escape') { titleEl.textContent = original; titleEl.blur(); }
  }, { once: true });
}
