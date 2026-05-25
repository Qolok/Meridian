import { createSearchBar } from "./components/SearchBar.js";
import { createWorkspaceLane } from "./components/WorkspaceLane.js";
import { search } from "./utils/browserSearch.js";
import {
  createSettingsPanel,
  applyTheme,
  applyBackground,
} from "./components/SettingsPanel.js";
import { clusterTabsByDomain } from "./utils/domainCluster.js";
import { getAllThumbnails } from "./utils/thumbnailCache.js";
import {
  getWorkspaceData,
  createWorkspace,
  assignTab,
} from "./utils/workspaceManager.js";
import { show as showContextMenu } from "./components/ContextMenu.js";

const hasNativeGroups = typeof chrome.tabGroups !== "undefined";

let lightboxApi = null;

async function applyStoredAppearance() {
  const { theme, background } = await chrome.storage.sync.get([
    "theme",
    "background",
  ]);
  applyTheme(theme ?? "system");
  applyBackground(background ?? { type: "none", value: "" });
}

function setupLightbox() {
  const lightbox = document.getElementById("tab-lightbox");
  const thumbEl = document.getElementById("lightbox-thumbnail");
  const placeholderEl = document.getElementById("lightbox-placeholder");
  const faviconEl = document.getElementById("lightbox-favicon");
  const titleEl = document.getElementById("lightbox-title");
  const urlEl = document.getElementById("lightbox-url");
  const LIGHTBOX_W = 400;
  const MARGIN = 8;
  let currentTab = null;
  let closeTimer = null;

  function navigate() {
    if (currentTab) chrome.tabs.update(currentTab.id, { active: true });
    hideLightbox();
  }

  function showLightbox({ tab, thumbnail, rect }) {
    currentTab = tab;
    clearTimeout(closeTimer);

    if (thumbnail) {
      thumbEl.src = thumbnail;
      thumbEl.classList.remove("hidden");
      placeholderEl.classList.add("hidden");
    } else {
      thumbEl.src = "";
      thumbEl.classList.add("hidden");
      placeholderEl.textContent = (tab.title || "?").charAt(0).toUpperCase();
      placeholderEl.classList.remove("hidden");
    }

    if (tab.favIconUrl) {
      faviconEl.src = tab.favIconUrl;
      faviconEl.style.display = "";
    } else {
      faviconEl.style.display = "none";
    }

    titleEl.textContent = tab.title || tab.url || "New Tab";
    urlEl.textContent = tab.url || "";

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    // thumbnail height + body section (title + meta + padding)
    const approxH = Math.round((LIGHTBOX_W * 10) / 16) + 80;

    // Center both horizontally and vertically on the card
    const cardCX = rect.left + rect.width / 2;
    const cardCY = rect.top + rect.height / 2;

    let left = cardCX - LIGHTBOX_W / 2;
    left = Math.max(MARGIN, Math.min(left, vw - LIGHTBOX_W - MARGIN));

    let top = cardCY - approxH / 2;
    top = Math.max(MARGIN, Math.min(top, vh - approxH - MARGIN));

    // Transform-origin at the card's center so it appears to grow from the card
    const originX = Math.round(
      ((rect.left + rect.width / 2 - left) / LIGHTBOX_W) * 100,
    );
    const originY = Math.round(
      ((rect.top + rect.height / 2 - top) / approxH) * 100,
    );
    lightbox.style.transformOrigin = `${originX}% ${originY}%`;

    lightbox.style.left = `${left}px`;
    lightbox.style.top = `${top}px`;
    lightbox.classList.remove("hidden");
  }

  function hideLightbox() {
    lightbox.classList.add("hidden");
    currentTab = null;
  }

  lightbox.addEventListener("mouseleave", () => {
    closeTimer = setTimeout(hideLightbox, 150);
  });
  lightbox.addEventListener("mouseenter", () => clearTimeout(closeTimer));

  lightbox.addEventListener("click", navigate);

  document.addEventListener("tab-lightbox-show", (e) => showLightbox(e.detail));
  document.addEventListener("dragstart", hideLightbox);

  return {
    hide: hideLightbox,
    isVisible: () => !lightbox.classList.contains("hidden"),
  };
}

async function handleNewTabBehavior() {
  const { newTabBehavior, homepageUrl } = await chrome.storage.sync.get([
    "newTabBehavior",
    "homepageUrl",
  ]);
  if (newTabBehavior === "focus-pinned") {
    const [currentTab, { meridianTabId }] = await Promise.all([
      chrome.tabs.getCurrent(),
      chrome.storage.local.get("meridianTabId"),
    ]);
    if (meridianTabId && currentTab && meridianTabId !== currentTab.id) {
      await chrome.tabs.update(meridianTabId, { active: true });
      window.close();
    }
  } else if (newTabBehavior === "open-homepage" && homepageUrl?.trim()) {
    const [currentTab, { meridianTabId }] = await Promise.all([
      chrome.tabs.getCurrent(),
      chrome.storage.local.get("meridianTabId"),
    ]);
    if (!currentTab || currentTab.id === meridianTabId) return;
    await chrome.tabs.update(currentTab.id, { url: homepageUrl.trim() });
  }
}

let searchBarApi = null;
let browserSearchActive = false;
let browserSearchResults = null;

function setupKeyboardNav() {
  document.addEventListener("keydown", (e) => {
    const tag = document.activeElement?.tagName;
    const isEditing =
      tag === "INPUT" ||
      tag === "TEXTAREA" ||
      document.activeElement?.contentEditable === "true";

    if (e.key === "/" && !isEditing) {
      e.preventDefault();
      searchBarApi?.focus();
      return;
    }

    if ((e.key === "n" || e.key === "N") && !isEditing) {
      e.preventDefault();
      handleNewGroup();
      return;
    }

    if (e.key === "Escape") {
      if (lightboxApi?.isVisible()) {
        lightboxApi.hide();
        return;
      }
      const overlay = document.getElementById("settings-overlay");
      if (!overlay.classList.contains("hidden")) {
        closeSettings();
        return;
      }
      if (browserSearchActive) {
        clearBrowserSearch();
        searchBarApi?.clearSearch?.();
        return;
      }
      if (document.activeElement?.tagName === "INPUT") {
        document.activeElement.blur();
        focusFirstCard();
      }
      return;
    }

    if (["ArrowRight", "ArrowLeft", "ArrowUp", "ArrowDown"].includes(e.key)) {
      if (isEditing) return;
      e.preventDefault();
      navigateCards(e.key);
    }
  });
}

function navigateCards(key) {
  const cards = [...document.querySelectorAll(".tab-card")];
  if (!cards.length) return;
  const focused = document.activeElement;
  if (!cards.includes(focused)) {
    cards[0].focus();
    return;
  }

  const grid = focused.closest(".tab-grid");
  const lane = focused.closest(".workspace-lane");
  const gridCards = [...grid.querySelectorAll(".tab-card")];
  const gridIdx = gridCards.indexOf(focused);

  let next = null;
  if (key === "ArrowRight") next = gridCards[gridIdx + 1] ?? null;
  if (key === "ArrowLeft") next = gridIdx > 0 ? gridCards[gridIdx - 1] : null;

  if (key === "ArrowDown" || key === "ArrowUp") {
    const lanes = [...document.querySelectorAll(".workspace-lane")];
    const laneIdx = lanes.indexOf(lane);
    const targetLane =
      key === "ArrowDown" ? lanes[laneIdx + 1] : lanes[laneIdx - 1];
    if (targetLane) next = targetLane.querySelector(".tab-card");
  }

  next?.focus();
}

function focusFirstCard() {
  document.querySelector(".tab-card")?.focus();
}

async function handleNewGroup() {
  const name = prompt("New group name:");
  if (!name?.trim()) return;

  if (hasNativeGroups) {
    // Create a blank inactive tab to anchor the group; user fills it in or drags tabs in
    const tab = await chrome.tabs.create({ active: false, url: "about:blank" });
    const groupId = await chrome.tabs.group({ tabIds: [tab.id] });
    await chrome.tabGroups.update(groupId, { title: name.trim() });
    await render();
    requestAnimationFrame(() => {
      document
        .querySelector(".new-tab-active:not(.hidden) .new-tab-url-input")
        ?.focus();
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
  document.getElementById("settings-overlay").classList.remove("hidden");
}

function closeSettings() {
  document.getElementById("settings-overlay").classList.add("hidden");
}

function colorLabel(color) {
  return color ? color.charAt(0).toUpperCase() + color.slice(1) : "Group";
}

let renderTimer = null;
let renderRunning = false;

function scheduleRender() {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(async () => {
    if (renderRunning) {
      scheduleRender();
      return;
    }
    renderRunning = true;
    try {
      await render();
    } finally {
      renderRunning = false;
    }
  }, 50);
}

function sortByTabOrder(tabs, order) {
  if (!order?.length) return tabs;
  const pos = new Map(order.map((id, i) => [id, i]));
  return [...tabs].sort(
    (a, b) => (pos.get(a.id) ?? Infinity) - (pos.get(b.id) ?? Infinity),
  );
}

async function render() {
  const container = document.getElementById("workspace-container");
  container.innerHTML = "";

  const { groupByDomain } = await chrome.storage.sync.get("groupByDomain");

  const chromeGroupsPromise = hasNativeGroups
    ? chrome.tabGroups.query({})
    : Promise.resolve([]);

  const [allTabs, chromeGroups, thumbnails, currentTab, wsData, localStore] =
    await Promise.all([
      chrome.tabs.query({}),
      chromeGroupsPromise,
      getAllThumbnails(),
      chrome.tabs.getCurrent(),
      getWorkspaceData(),
      chrome.storage.local.get(["collapsedLanes", "tabOrder"]),
    ]);
  const collapsedLanes = localStore.collapsedLanes ?? {};
  const tabOrder = localStore.tabOrder ?? {};

  const meridianUrl = chrome.runtime.getURL("meridian.html");
  const visibleTabs = allTabs.filter(
    (t) =>
      t.id !== currentTab?.id &&
      t.url !== meridianUrl &&
      t.pendingUrl !== meridianUrl &&
      t.url !== "chrome://newtab/" &&
      t.pendingUrl !== "chrome://newtab/",
  );

  const groupMap = new Map(chromeGroups.map((g) => [g.id, g]));
  const chromeGroupedMap = new Map();
  const ungroupedTabs = [];

  for (const tab of visibleTabs) {
    if (hasNativeGroups && tab.groupId !== -1) {
      if (!chromeGroupedMap.has(tab.groupId))
        chromeGroupedMap.set(tab.groupId, []);
      chromeGroupedMap.get(tab.groupId).push(tab);
    } else {
      ungroupedTabs.push(tab);
    }
  }

  // Distribute ungrouped tabs into Meridian workspaces
  const customWorkspaces = wsData.workspaces.filter((w) => w.id !== "unsorted");
  const wsTabMap = new Map(customWorkspaces.map((w) => [w.id, []]));
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
      const sorted = sortByTabOrder(clusterTabs, tabOrder[workspace.id]);
      const lane = createWorkspaceLane(
        workspace,
        sorted,
        thumbnails,
        handleTabClosed,
        { collapsed: collapsedLanes[workspace.id] ?? false },
      );
      lane.addEventListener("workspace-reassigned", scheduleRender);
      container.appendChild(lane);
    }
  } else if (trulyUnsorted.length > 0) {
    const workspace = { id: "unsorted", name: "Unsorted" };
    const sorted = sortByTabOrder(trulyUnsorted, tabOrder["unsorted"]);
    const lane = createWorkspaceLane(
      workspace,
      sorted,
      thumbnails,
      handleTabClosed,
      { collapsed: collapsedLanes[workspace.id] ?? false },
    );
    lane.addEventListener("workspace-reassigned", scheduleRender);
    container.appendChild(lane);
  }

  // 2. Meridian workspace lanes (always shown, even if empty)
  for (const ws of customWorkspaces) {
    const wsTabs = sortByTabOrder(wsTabMap.get(ws.id) ?? [], tabOrder[ws.id]);
    const lane = createWorkspaceLane(
      { id: ws.id, name: ws.name },
      wsTabs,
      thumbnails,
      handleTabClosed,
      { meridianWorkspace: ws, collapsed: collapsedLanes[ws.id] ?? false },
    );
    lane.addEventListener("workspace-reassigned", scheduleRender);
    container.appendChild(lane);
  }

  // 3. Chrome tab group lanes
  for (const [groupId, tabs] of chromeGroupedMap) {
    const group = groupMap.get(groupId);
    const name = group?.title?.trim() || colorLabel(group?.color);
    const workspace = { id: `cg_${groupId}`, name };
    const lane = createWorkspaceLane(
      workspace,
      tabs,
      thumbnails,
      handleTabClosed,
      { chromeGroup: group, collapsed: collapsedLanes[workspace.id] ?? false },
    );
    lane.addEventListener("workspace-reassigned", scheduleRender);
    container.appendChild(lane);
  }
}

function filterGrid(query) {
  const q = query.toLowerCase();
  document.querySelectorAll(".workspace-lane").forEach((lane) => {
    const cards = [...lane.querySelectorAll(".tab-card")];
    let anyVisible = false;
    for (const card of cards) {
      const title = (
        card.querySelector(".card-title")?.textContent ?? ""
      ).toLowerCase();
      const url = (card.dataset.tabUrl ?? "").toLowerCase();
      const matches = title.includes(q) || url.includes(q);
      card.style.display = matches ? "" : "none";
      if (matches) anyVisible = true;
    }
    lane.style.display = anyVisible || cards.length === 0 ? "" : "none";
  });
}

function clearBrowserSearch() {
  browserSearchActive = false;
  browserSearchResults = null;

  document.querySelectorAll(".workspace-lane").forEach((lane) => {
    lane.style.display = "";
    lane.querySelectorAll(".tab-card").forEach((card) => {
      card.style.display = "";
    });
  });

  const existing = document.getElementById("browser-search-results");
  if (existing) existing.remove();
}

function buildResultRow(item) {
  const row = document.createElement("div");
  row.className = "result-row";
  row.tabIndex = 0;

  const favicon = document.createElement("img");
  favicon.className = "result-favicon";
  favicon.width = 16;
  favicon.height = 16;
  favicon.src =
    item.favicon ||
    `https://www.google.com/s2/favicons?domain=${item.domain}&sz=16`;
  favicon.onerror = () => {
    let letter = "?";
    try { letter = new URL(item.url).hostname.replace(/^www\./, "").charAt(0).toUpperCase() || "?"; } catch (_) {}
    const ph = document.createElement("span");
    ph.className = "favicon-placeholder";
    ph.style.cssText = "width:16px;height:16px;font-size:10px";
    ph.textContent = letter;
    favicon.replaceWith(ph);
  };

  const body = document.createElement("div");
  body.className = "result-body";

  const title = document.createElement("div");
  title.className = "result-title";
  title.textContent = item.title || item.url;

  const meta = document.createElement("div");
  meta.className = "result-meta";
  meta.textContent = item.url;

  body.appendChild(title);
  body.appendChild(meta);

  const context = document.createElement("div");
  context.className = "result-context";
  context.textContent = item.context || "";

  row.appendChild(favicon);
  row.appendChild(body);
  row.appendChild(context);

  row.addEventListener("click", () => {
    if (item.tabId != null) {
      chrome.tabs.update(item.tabId, { active: true });
    } else {
      chrome.tabs.create({ url: item.url });
    }
  });

  row.addEventListener("keydown", (e) => {
    if (e.key === "Enter") row.click();
  });

  return row;
}

function renderSearchResults(results, query) {
  let container = document.getElementById("browser-search-results");
  if (!container) {
    container = document.createElement("div");
    container.id = "browser-search-results";
    document
      .getElementById("workspace-container")
      .insertAdjacentElement("afterend", container);
  }
  container.innerHTML = "";

  const sections = [
    { label: "Open Tabs", items: results.tabs },
    { label: "Bookmarks", items: results.bookmarks },
    { label: "History", items: results.history },
  ];

  for (const { label, items } of sections) {
    if (!items.length) continue;
    const section = document.createElement("div");
    section.className = "search-results-section";

    const heading = document.createElement("div");
    heading.className = "search-results-label";
    heading.textContent = label;
    section.appendChild(heading);

    for (const item of items.slice(0, 10)) {
      section.appendChild(buildResultRow(item));
    }
    container.appendChild(section);
  }

  if (
    !results.tabs.length &&
    !results.bookmarks.length &&
    !results.history.length
  ) {
    const empty = document.createElement("div");
    empty.className = "search-results-empty";
    const msg = document.createElement("span");
    msg.textContent = `No results for "${query}" — `;
    const webBtn = document.createElement("button");
    webBtn.className = "search-web-fallback";
    webBtn.textContent = "search the web";
    webBtn.addEventListener("click", async () => {
      const PROVIDER_URLS = {
        google: "https://www.google.com/search?q=",
        duckduckgo: "https://duckduckgo.com/?q=",
        bing: "https://www.bing.com/search?q=",
        brave: "https://search.brave.com/search?q=",
      };
      const { searchProvider } = await chrome.storage.sync.get("searchProvider");
      const base = PROVIDER_URLS[searchProvider] ?? PROVIDER_URLS.google;
      chrome.tabs.create({ url: base + encodeURIComponent(query) });
    });
    empty.appendChild(msg);
    empty.appendChild(webBtn);
    container.appendChild(empty);
  }
}

async function handleBrowserQuery(query) {
  browserSearchActive = true;

  filterGrid(query);

  const r = await search(query);
  const { localSearch } = await chrome.storage.sync.get("localSearch");
  const ls = localSearch ?? { tabs: true, bookmarks: true, history: true };
  if (!ls.tabs) r.tabs = [];
  if (!ls.bookmarks) r.bookmarks = [];
  if (!ls.history) r.history = [];
  browserSearchResults = r;

  renderSearchResults(r, query);
}

async function init() {
  // Inject styles for browser search results
  const style = document.createElement("style");
  style.textContent = `
    #browser-search-results {
      max-width: 900px;
      margin: 16px auto 0;
      padding: 16px 20px 24px;
      background: rgba(245, 245, 245, 0.80);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      box-shadow: 0 6px 15px rgba(0, 0, 0, 0.5);
    }
    html[data-theme="dark"] #browser-search-results {
      background: rgba(28, 28, 30, 0.80);
    }
    @media (prefers-color-scheme: dark) {
      html:not([data-theme="light"]) #browser-search-results {
        background: rgba(28, 28, 30, 0.80);
      }
    }
    .search-results-section { margin-bottom: 16px; }
    .search-results-label {
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-secondary);
      padding: 8px 0 4px;
      border-bottom: 1px solid var(--border);
      margin-bottom: 4px;
    }
    .result-row {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 4px;
      cursor: pointer;
      border-radius: var(--radius-sm);
      transition: background var(--transition);
    }
    .result-row:hover, .result-row:focus {
      background: var(--surface-hover);
      outline: none;
    }
    .result-favicon { width: 16px; height: 16px; flex-shrink: 0; border-radius: 2px; }
    .result-body { flex: 1; min-width: 0; }
    .result-title { font-size: 14px; font-weight: 500; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .result-meta { font-size: 12px; color: var(--text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 1px; }
    .result-context { font-size: 12px; color: var(--text-secondary); text-align: right; white-space: nowrap; flex-shrink: 0; max-width: 140px; overflow: hidden; text-overflow: ellipsis; }
    .search-results-empty { padding: 16px 0; color: var(--text-secondary); font-size: 14px; text-align: center; }
    .search-clear-btn {
      background: none; border: none; cursor: pointer; color: var(--text-secondary);
      font-size: 16px; padding: 0 4px; line-height: 1;
    }
    .search-clear-btn:hover { color: var(--text-primary); }
    .search-clear-btn.hidden { display: none; }
    .search-web-fallback {
      background: none; border: none; padding: 0; cursor: pointer;
      color: var(--accent); font-size: 14px; font-family: inherit; text-decoration: underline;
    }
    .search-web-fallback:hover { opacity: 0.8; }
  `;
  document.head.appendChild(style);

  await applyStoredAppearance();
  await handleNewTabBehavior();

  lightboxApi = setupLightbox();

  searchBarApi = createSearchBar(document.getElementById("search-bar"));

  searchBarApi.onBrowserQuery = (query) => {
    if (!query) {
      clearBrowserSearch();
    } else {
      handleBrowserQuery(query);
    }
  };

  searchBarApi.onArrowDown = () => {
    document.querySelector("#browser-search-results .result-row")?.focus();
  };

  const settingsOverlay = document.getElementById("settings-overlay");
  const settingsContainer = document.getElementById("settings-panel");
  const settingsBtn = document.getElementById("settings-btn");
  const newGroupBtn = document.getElementById("new-group-btn");

  createSettingsPanel(settingsContainer, closeSettings);

  settingsBtn.addEventListener("click", openSettings);
  newGroupBtn.addEventListener("click", handleNewGroup);
  settingsOverlay.addEventListener("click", (e) => {
    if (e.target === settingsOverlay) closeSettings();
  });

  setupKeyboardNav();

  document.addEventListener("tab-context-menu", (e) => {
    showContextMenu(e.detail.tab, e.detail.x, e.detail.y);
  });

  const dropZone = document.getElementById("new-group-drop-zone");
  document.addEventListener("dragstart", () =>
    dropZone.classList.remove("hidden"),
  );
  document.addEventListener("dragend", () => dropZone.classList.add("hidden"));
  dropZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropZone.classList.add("drag-over");
  });
  dropZone.addEventListener("dragleave", (e) => {
    if (!dropZone.contains(e.relatedTarget))
      dropZone.classList.remove("drag-over");
  });
  dropZone.addEventListener("drop", async (e) => {
    e.preventDefault();
    dropZone.classList.remove("drag-over");
    const tabId = parseInt(e.dataTransfer.getData("text/plain"), 10);
    if (!tabId) return;
    const name = prompt("New group name:");
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
    if (info.title || info.favIconUrl || info.groupId !== undefined)
      scheduleRender();
  });

  chrome.tabs.onMoved.addListener(scheduleRender);

  if (hasNativeGroups) {
    chrome.tabGroups.onCreated.addListener(scheduleRender);
    chrome.tabGroups.onRemoved.addListener(scheduleRender);
    chrome.tabGroups.onUpdated.addListener(scheduleRender);
  }

  window.addEventListener("settings-changed", scheduleRender);

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) scheduleRender();
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    const keys = Object.keys(changes);
    if (
      keys.some(
        (k) => k.startsWith("thumb_") || k === "workspaces" || k === "tabOrder",
      )
    ) {
      scheduleRender();
    }
  });
}

init();
