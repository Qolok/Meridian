import {
  assignTab,
  unassignTab,
  createWorkspace,
} from "../utils/workspaceManager.js";

const hasNativeGroups = typeof chrome.tabGroups !== "undefined";

let menuEl = null;

function getMenu() {
  if (menuEl) return menuEl;
  menuEl = document.createElement("div");
  menuEl.className = "context-menu hidden";
  menuEl.setAttribute("role", "menu");
  document.body.appendChild(menuEl);
  document.addEventListener("mousedown", (e) => {
    if (!menuEl.contains(e.target)) hide();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") hide();
  });
  return menuEl;
}

export function hide() {
  getMenu().classList.add("hidden");
}

function item(label, onClick) {
  const btn = document.createElement("button");
  btn.className = "context-menu-item";
  btn.setAttribute("role", "menuitem");
  btn.textContent = label;
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    hide();
    onClick();
  });
  return btn;
}

function separator() {
  const el = document.createElement("div");
  el.className = "context-menu-separator";
  return el;
}

export async function show(tab, x, y) {
  const menu = getMenu();
  menu.innerHTML = "";

  const [chromeGroups, wsData] = await Promise.all([
    hasNativeGroups ? chrome.tabGroups.query({}) : Promise.resolve([]),
    (await import("../utils/workspaceManager.js")).getWorkspaceData(),
  ]);

  const inChromeGroup = hasNativeGroups && tab.groupId !== -1;
  const wsId = wsData.assignments[String(tab.id)];
  const customWorkspaces = wsData.workspaces.filter((w) => w.id !== "unsorted");

  // Move to new group
  menu.appendChild(
    item("Move to new group", async () => {
      const name = prompt("New group name:");
      if (!name?.trim()) return;
      if (hasNativeGroups) {
        if (inChromeGroup) await chrome.tabs.ungroup([tab.id]).catch(() => {});
        const groupId = await chrome.tabs.group({ tabIds: [tab.id] });
        await chrome.tabGroups.update(groupId, { title: name.trim() });
      } else {
        const ws = await createWorkspace(name.trim());
        await unassignTab(tab.id);
        await assignTab(tab.id, ws.id);
      }
    }),
  );

  // Remove from group (if in one)
  if (inChromeGroup || wsId) {
    menu.appendChild(
      item("Remove from group", async () => {
        if (hasNativeGroups && inChromeGroup)
          await chrome.tabs.ungroup([tab.id]).catch(() => {});
        await unassignTab(tab.id);
      }),
    );
  }

  // Move to existing Chrome groups
  const otherChromeGroups = chromeGroups.filter((g) => g.id !== tab.groupId);
  if (otherChromeGroups.length > 0) {
    menu.appendChild(separator());
    for (const g of otherChromeGroups) {
      const name = g.title?.trim() || g.color || "Group";
      menu.appendChild(
        item(`Move to "${name}"`, async () => {
          await chrome.tabs.group({ tabIds: [tab.id], groupId: g.id });
          await unassignTab(tab.id);
        }),
      );
    }
  }

  // Move to existing Meridian workspaces
  const otherWorkspaces = customWorkspaces.filter((w) => w.id !== wsId);
  if (otherWorkspaces.length > 0) {
    menu.appendChild(separator());
    for (const ws of otherWorkspaces) {
      menu.appendChild(
        item(`Move to "${ws.name}"`, async () => {
          if (hasNativeGroups && inChromeGroup)
            await chrome.tabs.ungroup([tab.id]).catch(() => {});
          await assignTab(tab.id, ws.id);
        }),
      );
    }
  }

  // Position
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  menu.classList.remove("hidden");

  // Nudge back on-screen if clipped
  requestAnimationFrame(() => {
    const r = menu.getBoundingClientRect();
    if (r.right > window.innerWidth) menu.style.left = `${x - r.width}px`;
    if (r.bottom > window.innerHeight) menu.style.top = `${y - r.height}px`;
  });
}
