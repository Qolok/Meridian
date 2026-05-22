import { createTabCard } from './TabCard.js';
import { renameWorkspace } from '../utils/workspaceManager.js';

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

export function createWorkspaceLane(workspace, tabs, thumbnails, onTabClosed, { chromeGroup } = {}) {
  const lane = document.createElement('div');
  lane.className = 'workspace-lane';
  lane.dataset.workspaceId = workspace.id;

  const header = document.createElement('div');
  header.className = 'lane-header';

  if (chromeGroup?.color) {
    const dot = document.createElement('span');
    dot.className = 'lane-group-dot';
    dot.style.background = GROUP_COLORS[chromeGroup.color] ?? '#9aa0a6';
    header.appendChild(dot);
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
  lane.appendChild(header);

  const grid = document.createElement('div');
  grid.className = 'tab-grid';

  for (const tab of tabs) {
    const thumb = thumbnails[tab.id] ?? null;
    const card = createTabCard(tab, thumb);
    grid.appendChild(card);
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
    } else {
      await chrome.tabs.ungroup([tabId]);
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
