/**
 * browserSearch.js — Shared search engine for Meridian
 *
 * Exports two groups:
 *   A) Index management  — initTabIndex(), rebuildIndex()  (called from background.js)
 *   B) Search functions  — search(query), getPreviousTab() (called from popup.js / meridian.js)
 */

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Extract the root domain from a URL string.
 * Returns "" for non-http(s) URLs or on parse failure.
 */
function extractDomain(url) {
  if (!url) return "";
  try {
    const { hostname } = new URL(url);
    // Strip leading "www."
    return hostname.replace(/^www\./, "");
  } catch (_) {
    return "";
  }
}

/**
 * Build a Google favicon URL for a given domain or full URL.
 */
function faviconUrl(domain) {
  if (!domain) return "";
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=16`;
}

/**
 * Fuzzy score — returns a value 0–1.
 *
 * Rules (case-insensitive):
 *   1. Exact substring match                         → 1.0
 *   2. All query chars appear in order (subsequence) → 0.3–0.7, scaled by compactness
 *   3. No match                                      → 0
 *
 * "Compactness" = how short the matched span is relative to the text length.
 * A perfectly compact match (every char adjacent) scores 0.7;
 * a very spread-out match floors at 0.3.
 */
function fuzzyScore(query, text) {
  if (!query || !text) return 0;

  const q = query.toLowerCase();
  const t = text.toLowerCase();

  // 1. Exact substring
  if (t.includes(q)) return 1.0;

  // 2. Subsequence match
  let qi = 0;
  let firstMatch = -1;
  let lastMatch = -1;

  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      if (firstMatch === -1) firstMatch = ti;
      lastMatch = ti;
      qi++;
    }
  }

  if (qi < q.length) return 0; // not all chars found

  const span = lastMatch - firstMatch + 1;
  // Compactness ratio: ideal span == q.length, worst == t.length
  const compactness = q.length / span;
  // Map compactness [0,1] → score [0.3, 0.7]
  return 0.3 + compactness * 0.4;
}

// ---------------------------------------------------------------------------
// A) Index management
// ---------------------------------------------------------------------------

const INDEX_KEY = "tabSearchIndex";
const WORKSPACE_KEY = "workspaces";

/**
 * Resolve the workspace name for a given tabId using the stored workspace data.
 * Returns "" if the tab has no assignment or if workspace data is unavailable.
 */
async function resolveWorkspaceName(tabId) {
  try {
    const result = await chrome.storage.local.get(WORKSPACE_KEY);
    const data = result[WORKSPACE_KEY];
    if (!data) return "";

    const wsId = data.assignments?.[String(tabId)];
    if (!wsId) return "";

    const ws = data.workspaces?.find((w) => w.id === wsId);
    return ws?.name ?? "";
  } catch (_) {
    return "";
  }
}

/**
 * Read the current index from storage.
 */
async function readIndex() {
  const result = await chrome.storage.local.get(INDEX_KEY);
  return result[INDEX_KEY] ?? {};
}

/**
 * Write the full index back to storage.
 */
async function writeIndex(index) {
  await chrome.storage.local.set({ [INDEX_KEY]: index });
}

/**
 * Build a TabEntry from a Chrome Tab object.
 * metaDescription and headings start empty; they are filled asynchronously
 * by the content-script injection.
 */
async function buildEntry(tab, existingEntry) {
  const domain = extractDomain(tab.url);
  const workspaceName = await resolveWorkspaceName(tab.id);

  return {
    tabId: tab.id,
    title: tab.title ?? existingEntry?.title ?? "",
    url: tab.url ?? existingEntry?.url ?? "",
    domain,
    metaDescription: existingEntry?.metaDescription ?? "",
    headings: existingEntry?.headings ?? "",
    workspaceName,
    lastActive: existingEntry?.lastActive ?? Date.now(),
  };
}

/**
 * Inject a one-shot content script to extract meta description and headings.
 * Updates the index entry in storage on success.
 * Silently ignores privileged URLs and injection errors.
 */
async function injectMetaExtractor(tabId) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => ({
        metaDescription:
          document.querySelector('meta[name="description"]')?.content ?? "",
        headings: [...document.querySelectorAll("h1,h2")]
          .map((el) => el.textContent.trim())
          .join(" "),
      }),
    });

    const payload = results?.[0]?.result;
    if (!payload) return;

    const index = await readIndex();
    if (!index[tabId]) return; // tab may have been removed

    index[tabId].metaDescription = payload.metaDescription;
    index[tabId].headings = payload.headings;
    await writeIndex(index);
  } catch (_) {
    // Privileged URLs (chrome://, chrome-extension://, about:, etc.) throw here.
    // Intentionally swallowed — leave metaDescription/headings as "".
  }
}

/**
 * initTabIndex — wire up Chrome tab event listeners for index maintenance.
 * Call once from background.js at startup.
 */
export function initTabIndex() {
  // New tab created
  chrome.tabs.onCreated.addListener(async (tab) => {
    const index = await readIndex();
    index[tab.id] = await buildEntry(tab, index[tab.id]);
    await writeIndex(index);
  });

  // Tab updated (title change or navigation complete)
  chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (changeInfo.status !== "complete" && !changeInfo.title) return;

    const index = await readIndex();
    index[tabId] = await buildEntry(tab, index[tabId]);
    await writeIndex(index);

    // Inject content script on full load to capture meta/headings
    if (changeInfo.status === "complete") {
      injectMetaExtractor(tabId);
    }
  });

  // Tab activated — update lastActive timestamp
  chrome.tabs.onActivated.addListener(async (activeInfo) => {
    const index = await readIndex();
    if (index[activeInfo.tabId]) {
      index[activeInfo.tabId].lastActive = Date.now();
      await writeIndex(index);
    }
  });

  // Tab removed — delete from index
  chrome.tabs.onRemoved.addListener(async (tabId) => {
    const index = await readIndex();
    if (index[tabId]) {
      delete index[tabId];
      await writeIndex(index);
    }
  });
}

/**
 * rebuildIndex — query all current tabs and rebuild the index from scratch.
 * Call once at service-worker startup to handle tabs open before the extension loaded.
 */
export async function rebuildIndex() {
  const tabs = await chrome.tabs.query({});
  const index = {};

  await Promise.all(
    tabs.map(async (tab) => {
      index[tab.id] = await buildEntry(tab, null);
    }),
  );

  await writeIndex(index);

  // Inject meta extractors for all currently loaded tabs (fire-and-forget)
  for (const tab of tabs) {
    if (tab.status === "complete") {
      injectMetaExtractor(tab.id);
    }
  }
}

// ---------------------------------------------------------------------------
// B) Search functions
// ---------------------------------------------------------------------------

/**
 * Compute a weighted fuzzy score for a tab entry against a query string.
 * Weights: title ×3, workspaceName ×2, domain ×1.5, url ×1, metaDescription ×0.5
 */
function scoreTabEntry(query, entry) {
  const titleScore = fuzzyScore(query, entry.title) * 3;
  const wsScore = fuzzyScore(query, entry.workspaceName) * 2;
  const domainScore = fuzzyScore(query, entry.domain) * 1.5;
  const urlScore = fuzzyScore(query, entry.url) * 1;
  const metaScore = fuzzyScore(query, entry.metaDescription) * 0.5;

  const maxPossible = 3 + 2 + 1.5 + 1 + 0.5; // 8.0
  const raw = titleScore + wsScore + domainScore + urlScore + metaScore;
  return raw / maxPossible; // normalise to 0–1
}

/**
 * Format a timestamp (ms since epoch) as a human-readable date string.
 */
function formatDate(ts) {
  if (!ts) return "";
  try {
    return new Date(ts).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch (_) {
    return "";
  }
}

/**
 * search(query) — run a cross-source search across tabs, bookmarks, and history.
 *
 * @param {string} query
 * @returns {Promise<{ tabs: ResultItem[], bookmarks: ResultItem[], history: ResultItem[] }>}
 */
export async function search(query) {
  if (!query || !query.trim()) {
    return { tabs: [], bookmarks: [], history: [] };
  }

  const trimmed = query.trim();

  const [tabs, bookmarks, history] = await Promise.all([
    searchTabs(trimmed),
    searchBookmarks(trimmed),
    searchHistory(trimmed),
  ]);

  return { tabs, bookmarks, history };
}

/**
 * Search open tabs using the local index.
 */
async function searchTabs(query) {
  const index = await readIndex();
  const entries = Object.values(index);

  const scored = entries
    .map((entry) => ({
      entry,
      score: scoreTabEntry(query, entry),
    }))
    .filter(({ score }) => score > 0.1)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return (b.entry.lastActive ?? 0) - (a.entry.lastActive ?? 0);
    })
    .slice(0, 20);

  return scored.map(({ entry, score }) => ({
    tabId: entry.tabId,
    title: entry.title,
    url: entry.url,
    favicon: faviconUrl(entry.domain),
    domain: entry.domain,
    context: entry.workspaceName,
    score,
  }));
}

/**
 * Search bookmarks using the Chrome Bookmarks API.
 */
async function searchBookmarks(query) {
  let nodes;
  try {
    nodes = await chrome.bookmarks.search({ query });
  } catch (_) {
    return [];
  }

  // Filter to items that have a URL (not folders)
  const bookmarkNodes = nodes.filter((n) => n.url);

  // Fetch parent folder names in parallel
  const results = await Promise.all(
    bookmarkNodes.map(async (node) => {
      let context = "";
      if (node.parentId) {
        try {
          const parents = await chrome.bookmarks.get(node.parentId);
          context = parents?.[0]?.title ?? "";
        } catch (_) {
          // ignore
        }
      }

      const domain = extractDomain(node.url);
      const titleScore = fuzzyScore(query, node.title ?? "");
      const urlScore = fuzzyScore(query, node.url ?? "");
      const score = Math.max(titleScore, urlScore);

      return {
        tabId: null,
        title: node.title ?? "",
        url: node.url ?? "",
        favicon: faviconUrl(domain),
        domain,
        context,
        score,
      };
    }),
  );

  return results
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 20);
}

/**
 * Search browser history using the Chrome History API.
 */
async function searchHistory(query) {
  let items;
  try {
    items = await chrome.history.search({ text: query, maxResults: 20 });
  } catch (_) {
    return [];
  }

  return items
    .sort((a, b) => (b.lastVisitTime ?? 0) - (a.lastVisitTime ?? 0))
    .map((item) => {
      const domain = extractDomain(item.url);
      const titleScore = fuzzyScore(query, item.title ?? "");
      const urlScore = fuzzyScore(query, item.url ?? "");
      const score = Math.max(titleScore, urlScore);

      return {
        tabId: null,
        title: item.title ?? "",
        url: item.url ?? "",
        favicon: faviconUrl(domain),
        domain,
        context: formatDate(item.lastVisitTime),
        score,
      };
    })
    .filter((r) => r.score > 0);
}

/**
 * getPreviousTab — return the Chrome Tab object for the most-recently-active
 * non-Meridian tab, or null if unavailable.
 *
 * Reads `previousTabId` from chrome.storage.local (written by background.js).
 */
export async function getPreviousTab() {
  try {
    const { previousTabId } = await chrome.storage.local.get("previousTabId");
    if (previousTabId == null) return null;

    const tab = await chrome.tabs.get(previousTabId);
    return tab ?? null;
  } catch (_) {
    return null;
  }
}
