// existingTabId: when set, the card navigates that tab instead of creating a new one.
// Used for the about:blank placeholder tab created when a new Chrome group is opened.
export function createNewTabCard(groupId = null, existingTabId = null) {
  const idleEl = document.createElement("div");
  idleEl.className = "new-tab-card";

  const idleBtn = document.createElement("button");
  idleBtn.className = "new-tab-idle-btn";
  idleBtn.textContent = "+";
  idleBtn.setAttribute("aria-label", "New tab");
  idleEl.appendChild(idleBtn);

  const activeEl = document.createElement("div");
  activeEl.className = "tab-card new-tab-active hidden";
  activeEl.tabIndex = 0;

  const thumbPlaceholder = document.createElement("div");
  thumbPlaceholder.className = "card-thumbnail-placeholder";
  activeEl.appendChild(thumbPlaceholder);

  const cardInfo = document.createElement("div");
  cardInfo.className = "card-info";
  const urlInput = document.createElement("input");
  urlInput.type = "text";
  urlInput.className = "new-tab-url-input";
  urlInput.placeholder = "URL or search…";
  cardInfo.appendChild(urlInput);
  activeEl.appendChild(cardInfo);

  function activate() {
    idleEl.classList.add("hidden");
    activeEl.classList.remove("hidden");
    urlInput.focus();
  }

  function deactivate() {
    if (existingTabId !== null) {
      // Just hide the active card — no idle "+" revealed, placeholder tab kept alive
      // so the group isn't destroyed while the user clicks away to drag tabs in.
      activeEl.classList.add("hidden");
      urlInput.value = "";
      return;
    }
    activeEl.classList.add("hidden");
    idleEl.classList.remove("hidden");
    urlInput.value = "";
  }

  const SEARCH_URLS = {
    google: "https://www.google.com/search?q=",
    duckduckgo: "https://duckduckgo.com/?q=",
    bing: "https://www.bing.com/search?q=",
    brave: "https://search.brave.com/search?q=",
  };

  async function openTab(raw) {
    const value = raw.trim();
    if (!value) {
      if (existingTabId !== null)
        chrome.tabs.remove(existingTabId).catch(() => {});
      deactivate();
      return;
    }
    let url;
    if (/^https?:\/\//i.test(value)) {
      url = value;
    } else if (/^[^/\s]+\.[^/\s]+(\/|$)/.test(value)) {
      url = "https://" + value;
    } else {
      const { searchProvider } =
        await chrome.storage.sync.get("searchProvider");
      const base = SEARCH_URLS[searchProvider] ?? SEARCH_URLS.google;
      url = base + encodeURIComponent(value);
    }

    if (existingTabId !== null) {
      await chrome.tabs.update(existingTabId, { url, active: true });
    } else {
      const tab = await chrome.tabs.create({ url });
      if (groupId !== null) {
        chrome.tabs.group({ tabIds: [tab.id], groupId }).catch(() => {});
      }
    }
    deactivate();
  }

  idleBtn.addEventListener("click", activate);
  idleEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") activate();
  });

  urlInput.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter") openTab(urlInput.value);
    if (e.key === "Escape") {
      if (existingTabId !== null)
        chrome.tabs.remove(existingTabId).catch(() => {});
      deactivate();
    }
  });
  urlInput.addEventListener("blur", () => setTimeout(deactivate, 150));

  return [idleEl, activeEl];
}
