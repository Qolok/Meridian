export function createTabCard(tab, thumbnail) {
  const card = document.createElement("div");
  card.className = "tab-card";
  card.tabIndex = 0;
  card.dataset.tabId = tab.id;
  card.dataset.tabUrl = tab.url || "";
  card.draggable = true;

  if (thumbnail) {
    const img = document.createElement("img");
    img.className = "card-thumbnail";
    img.src = thumbnail;
    img.alt = "";
    card.appendChild(img);
  } else {
    const placeholder = document.createElement("div");
    placeholder.className = "card-thumbnail-placeholder";
    placeholder.textContent = getInitial(tab.title);
    card.appendChild(placeholder);
  }

  const info = document.createElement("div");
  info.className = "card-info";

  if (tab.favIconUrl) {
    const favicon = document.createElement("img");
    favicon.className = "card-favicon";
    favicon.src = tab.favIconUrl;
    favicon.alt = "";
    favicon.onerror = () => favicon.replaceWith(makeFaviconPlaceholder(tab.url, 14));
    info.appendChild(favicon);
  }

  const title = document.createElement("span");
  title.className = "card-title";
  title.textContent = tab.title || tab.url || "New Tab";
  info.appendChild(title);

  card.appendChild(info);

  const closeBtn = document.createElement("button");
  closeBtn.className = "card-close-btn";
  closeBtn.textContent = "×";
  closeBtn.setAttribute("aria-label", "Close tab");
  closeBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    card.dispatchEvent(
      new CustomEvent("close-tab", {
        bubbles: true,
        detail: { tabId: tab.id },
      }),
    );
  });
  card.appendChild(closeBtn);

  card.addEventListener("click", () => {
    chrome.tabs.update(tab.id, { active: true });
  });

  card.addEventListener("keydown", (e) => {
    if (e.key === "Enter") chrome.tabs.update(tab.id, { active: true });
    if (e.key === "w" || e.key === "W") {
      card.dispatchEvent(
        new CustomEvent("close-tab", {
          bubbles: true,
          detail: { tabId: tab.id },
        }),
      );
    }
  });

  card.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    card.dispatchEvent(
      new CustomEvent("tab-context-menu", {
        bubbles: true,
        detail: { tab, x: e.clientX, y: e.clientY },
      }),
    );
  });

  let hoverTimer = null;

  card.addEventListener("mouseenter", () => {
    hoverTimer = setTimeout(() => {
      hoverTimer = null;
      card.dispatchEvent(
        new CustomEvent("tab-lightbox-show", {
          bubbles: true,
          detail: { tab, thumbnail, rect: card.getBoundingClientRect() },
        }),
      );
    }, 1000);
  });

  card.addEventListener("mouseleave", () => {
    clearTimeout(hoverTimer);
    hoverTimer = null;
  });

  card.addEventListener("dragstart", (e) => {
    clearTimeout(hoverTimer);
    hoverTimer = null;
    e.dataTransfer.setData("text/plain", String(tab.id));
    card.classList.add("dragging");
  });
  card.addEventListener("dragend", () => card.classList.remove("dragging"));

  return card;
}

function getInitial(title) {
  if (!title) return "?";
  return title.trim().charAt(0).toUpperCase();
}

function makeFaviconPlaceholder(url, size) {
  let letter = "?";
  try {
    letter = new URL(url).hostname.replace(/^www\./, "").charAt(0).toUpperCase() || "?";
  } catch (_) {}
  const el = document.createElement("span");
  el.className = "favicon-placeholder";
  el.style.width = size + "px";
  el.style.height = size + "px";
  el.style.fontSize = Math.round(size * 0.65) + "px";
  el.textContent = letter;
  return el;
}
