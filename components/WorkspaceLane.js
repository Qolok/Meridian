import { createTabCard } from "./TabCard.js";
import { createNewTabCard } from "./NewTabCard.js";
import {
  renameWorkspace,
  deleteWorkspace,
  assignTab,
  unassignTab,
} from "../utils/workspaceManager.js";

const hasNativeGroups = typeof chrome.tabGroups !== "undefined";

// Tracks which tab is being dragged and from which lane, for same-lane reordering
const dragState = { tabId: null, laneId: null };

// refTabId: the tab that should follow the dragged tab in the new order (null = insert at end)
async function reorderInChromeGroup(draggedTabId, refTabId, groupId) {
  const groupTabs = await chrome.tabs.query({ groupId });
  groupTabs.sort((a, b) => a.index - b.index);
  const newOrder = groupTabs.filter((t) => t.id !== draggedTabId);
  const insertIdx =
    refTabId != null
      ? newOrder.findIndex((t) => t.id === refTabId)
      : newOrder.length;
  newOrder.splice(
    insertIdx === -1 ? newOrder.length : insertIdx,
    0,
    groupTabs.find((t) => t.id === draggedTabId),
  );
  const newRelIdx = newOrder.findIndex((t) => t.id === draggedTabId);
  await chrome.tabs.move(draggedTabId, {
    index: groupTabs[0].index + newRelIdx,
  });
}

async function reorderInStorage(
  draggedTabId,
  refTabId,
  workspaceId,
  currentTabIds,
) {
  const newOrder = currentTabIds.filter((id) => id !== draggedTabId);
  const insertIdx =
    refTabId != null ? newOrder.indexOf(refTabId) : newOrder.length;
  newOrder.splice(
    insertIdx === -1 ? newOrder.length : insertIdx,
    0,
    draggedTabId,
  );
  const { tabOrder = {} } = await chrome.storage.local.get("tabOrder");
  tabOrder[workspaceId] = newOrder;
  await chrome.storage.local.set({ tabOrder });
}

const GROUP_COLORS = {
  grey: "#9aa0a6",
  blue: "#4285f4",
  red: "#ea4335",
  yellow: "#fbbc04",
  green: "#34a853",
  pink: "#ff63b8",
  purple: "#a142f4",
  cyan: "#24c1e0",
  orange: "#ff6d00",
};

const CHEVRON = `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>`;

export function createWorkspaceLane(
  workspace,
  tabs,
  thumbnails,
  onTabClosed,
  { chromeGroup, meridianWorkspace, collapsed: initialCollapsed = false } = {},
) {
  const lane = document.createElement("div");
  lane.className = "workspace-lane";
  lane.dataset.workspaceId = workspace.id;

  let collapsed = initialCollapsed;

  // ---- Header ----
  const header = document.createElement("div");
  header.className = "lane-header";

  const collapseBtn = document.createElement("button");
  collapseBtn.className = "lane-collapse-btn";
  collapseBtn.innerHTML = CHEVRON;
  collapseBtn.setAttribute("aria-label", "Collapse lane");

  if (chromeGroup?.color) {
    const dot = document.createElement("span");
    dot.className = "lane-group-dot";
    dot.style.background = GROUP_COLORS[chromeGroup.color] ?? "#9aa0a6";
    header.appendChild(collapseBtn);
    header.appendChild(dot);
  } else {
    header.appendChild(collapseBtn);
  }

  const title = document.createElement("button");
  title.className = "lane-title";
  title.textContent = workspace.name;
  title.setAttribute("aria-label", `Workspace: ${workspace.name}`);

  if (!chromeGroup) {
    title.addEventListener("dblclick", () => startRename(title, workspace.id));
    title.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && title.contentEditable !== "true")
        startRename(title, workspace.id);
    });
  }

  const count = document.createElement("span");
  count.className = "lane-tab-count";
  count.textContent = `${tabs.length}`;

  header.appendChild(title);
  header.appendChild(count);

  // Delete button for user-created Meridian workspaces only
  if (meridianWorkspace) {
    const deleteBtn = document.createElement("button");
    deleteBtn.className = "lane-delete-btn";
    deleteBtn.textContent = "×";
    deleteBtn.setAttribute("aria-label", `Delete group ${workspace.name}`);
    deleteBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (
        !confirm(
          `Delete group "${workspace.name}"? Tabs will move to Unsorted.`,
        )
      )
        return;
      await deleteWorkspace(workspace.id);
      lane.dispatchEvent(
        new CustomEvent("workspace-reassigned", { bubbles: true }),
      );
    });
    header.appendChild(deleteBtn);
  }

  lane.appendChild(header);

  // ---- Collapse logic ----
  const grid = document.createElement("div");
  grid.className = "tab-grid";

  // Apply initial collapsed state
  grid.classList.toggle("hidden", collapsed);
  collapseBtn.classList.toggle("lane-collapse-btn--collapsed", collapsed);
  collapseBtn.setAttribute(
    "aria-label",
    collapsed ? "Expand lane" : "Collapse lane",
  );

  collapseBtn.addEventListener("click", () => {
    collapsed = !collapsed;
    grid.classList.toggle("hidden", collapsed);
    collapseBtn.classList.toggle("lane-collapse-btn--collapsed", collapsed);
    collapseBtn.setAttribute(
      "aria-label",
      collapsed ? "Expand lane" : "Collapse lane",
    );
    chrome.storage.local
      .get("collapsedLanes")
      .then(({ collapsedLanes = {} }) => {
        if (collapsed) {
          collapsedLanes[workspace.id] = true;
        } else {
          delete collapsedLanes[workspace.id];
        }
        chrome.storage.local.set({ collapsedLanes });
      });
  });

  // ---- Tab cards ----
  let dropPlaceholder = null;
  let lastInsertRef = undefined;

  function liveItems() {
    return [...grid.children].filter(
      (c) => c !== dropPlaceholder && !c.classList.contains("dragging"),
    );
  }

  function applyFlip(items, first) {
    const last = new Map(items.map((c) => [c, c.getBoundingClientRect()]));
    for (const item of items) {
      const f = first.get(item),
        l = last.get(item);
      if (!f || !l) continue;
      const dx = f.left - l.left,
        dy = f.top - l.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
      item.style.transition = "none";
      item.style.transform = `translate(${dx}px,${dy}px)`;
    }
    grid.offsetHeight; // single forced reflow
    for (const item of items) {
      if (!item.style.transform) continue;
      item.style.transition = "transform 150ms ease";
      item.style.transform = "";
      item.addEventListener(
        "transitionend",
        () => {
          item.style.transition = "";
        },
        { once: true },
      );
    }
  }

  function commitReorder(draggedTabId) {
    // Read where the placeholder sits to determine the new position
    let ref = dropPlaceholder?.nextElementSibling;
    while (ref && !ref.dataset?.tabId) ref = ref.nextElementSibling;
    const refTabId = ref ? parseInt(ref.dataset.tabId, 10) : null;
    if (chromeGroup)
      return reorderInChromeGroup(draggedTabId, refTabId, chromeGroup.id);
    return reorderInStorage(draggedTabId, refTabId, workspace.id, tabIds);
  }

  function movePlaceholder(insertRef) {
    if (insertRef === dropPlaceholder) return;

    // Hide placeholder when it would land on the card's current position
    const draggedEl = dragState.tabId
      ? grid.querySelector(`[data-tab-id="${dragState.tabId}"]`)
      : null;
    if (draggedEl) {
      let naturalNext = draggedEl.nextElementSibling;
      if (naturalNext === dropPlaceholder)
        naturalNext = naturalNext.nextElementSibling;
      if (insertRef === draggedEl || insertRef === naturalNext) {
        removePlaceholder();
        return;
      }
    }

    if (!dropPlaceholder) {
      dropPlaceholder = document.createElement("div");
      dropPlaceholder.className = "drag-placeholder";
      // Must preventDefault in dragover so the lane's drop event fires over the placeholder
      dropPlaceholder.addEventListener("dragover", (e) => e.preventDefault());
    }
    // Already in the right spot
    if (
      dropPlaceholder.parentNode === grid &&
      dropPlaceholder.nextElementSibling === insertRef
    )
      return;
    if (insertRef === lastInsertRef && dropPlaceholder.parentNode === grid)
      return;
    lastInsertRef = insertRef;
    const items = liveItems();
    const first = new Map(items.map((c) => [c, c.getBoundingClientRect()]));
    grid.insertBefore(dropPlaceholder, insertRef ?? null);
    applyFlip(items, first);
  }

  function removePlaceholder() {
    if (!dropPlaceholder?.parentNode) return;
    const items = liveItems();
    const first = new Map(items.map((c) => [c, c.getBoundingClientRect()]));
    dropPlaceholder.remove();
    lastInsertRef = undefined;
    applyFlip(items, first);
  }

  const tabIds = tabs.map((t) => t.id);

  for (const tab of tabs) {
    const isPlaceholder =
      chromeGroup &&
      (tab.url === "about:blank" ||
        tab.pendingUrl === "about:blank" ||
        (!tab.url && !tab.pendingUrl));
    if (isPlaceholder) {
      const [, activeEl] = createNewTabCard(chromeGroup.id, tab.id);
      activeEl.classList.remove("hidden");
      grid.appendChild(activeEl); // idle "+" intentionally omitted — no duplicate
    } else {
      const thumb = thumbnails[tab.id] ?? null;
      const card = createTabCard(tab, thumb);

      card.addEventListener("dragstart", () => {
        dragState.tabId = tab.id;
        dragState.laneId = workspace.id;
      });

      card.addEventListener("dragend", () => {
        removePlaceholder();
        dragState.tabId = null;
        dragState.laneId = null;
      });

      card.addEventListener("dragover", (e) => {
        if (dragState.laneId !== workspace.id || dragState.tabId === tab.id)
          return;
        e.preventDefault();
        e.stopPropagation();
        const rect = card.getBoundingClientRect();
        let ref =
          e.clientX >= rect.left + rect.width / 2
            ? card.nextElementSibling
            : card;
        if (ref === dropPlaceholder) ref = dropPlaceholder.nextElementSibling;
        movePlaceholder(ref);
      });

      grid.appendChild(card);
    }
  }
  for (const el of createNewTabCard(chromeGroup?.id ?? null)) {
    grid.appendChild(el);
  }

  lane.appendChild(grid);

  lane.addEventListener("close-tab", (e) => onTabClosed(e.detail.tabId));

  lane.addEventListener("dragover", (e) => {
    if (dragState.laneId === workspace.id) return;
    e.preventDefault();
    lane.classList.add("drag-over");
  });
  lane.addEventListener("dragleave", (e) => {
    if (!lane.contains(e.relatedTarget)) {
      lane.classList.remove("drag-over");
      removePlaceholder();
    }
  });
  lane.addEventListener("drop", async (e) => {
    e.preventDefault();
    lane.classList.remove("drag-over");

    // Same-lane reorder: use placeholder position instead of cursor position
    if (
      dragState.laneId === workspace.id &&
      dropPlaceholder?.parentNode === grid
    ) {
      const draggedTabId = dragState.tabId;
      const reorderPromise = commitReorder(draggedTabId); // reads nextElementSibling synchronously
      removePlaceholder();
      await reorderPromise;
      lane.dispatchEvent(
        new CustomEvent("workspace-reassigned", { bubbles: true }),
      );
      return;
    }

    removePlaceholder();
    const tabId = parseInt(e.dataTransfer.getData("text/plain"), 10);
    if (!tabId) return;

    if (chromeGroup) {
      await chrome.tabs.group({ tabIds: [tabId], groupId: chromeGroup.id });
      await unassignTab(tabId);
      // Remove any about:blank placeholder tab now that a real tab has been added
      const groupTabs = await chrome.tabs.query({ groupId: chromeGroup.id });
      const placeholder = groupTabs.find(
        (t) => t.url === "about:blank" && t.id !== tabId,
      );
      if (placeholder) await chrome.tabs.remove(placeholder.id).catch(() => {});
    } else if (meridianWorkspace) {
      if (hasNativeGroups) await chrome.tabs.ungroup([tabId]).catch(() => {});
      await assignTab(tabId, meridianWorkspace.id);
    } else {
      if (hasNativeGroups) await chrome.tabs.ungroup([tabId]).catch(() => {});
      await unassignTab(tabId);
    }

    lane.dispatchEvent(
      new CustomEvent("workspace-reassigned", { bubbles: true }),
    );
  });

  return lane;
}

function startRename(titleEl, workspaceId) {
  const original = titleEl.textContent;
  titleEl.contentEditable = "true";
  titleEl.focus();
  document.execCommand("selectAll", false, null);

  function commit() {
    titleEl.contentEditable = "false";
    const newName = titleEl.textContent.trim() || original;
    titleEl.textContent = newName;
    if (newName !== original) renameWorkspace(workspaceId, newName);
  }

  titleEl.addEventListener("blur", commit, { once: true });
  titleEl.addEventListener(
    "keydown",
    (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        titleEl.blur();
      }
      if (e.key === "Escape") {
        titleEl.textContent = original;
        titleEl.blur();
      }
    },
    { once: true },
  );
}
