const NEW_TAB_OPTIONS = [
  { id: "meridian-view", label: "Open a new Meridian view" },
  { id: "focus-pinned", label: "Always return to pinned Meridian" },
  { id: "open-homepage", label: "Open my homepage" },
];

const SOLID_COLORS = [
  { id: "s1", value: "#000000", label: "Black" },
  { id: "s2", value: "#1e2028", label: "Ink" },
  { id: "s3", value: "#0d1b2a", label: "Midnight" },
  { id: "s4", value: "#0f2218", label: "Forest" },
  { id: "s5", value: "#1a0a2e", label: "Plum" },
];

const GRADIENT_PRESETS = [
  {
    id: "g1",
    value: "linear-gradient(135deg,#1a1a2e,#16213e,#0f3460)",
    label: "Midnight",
  },
  {
    id: "g2",
    value: "linear-gradient(135deg,#0f2027,#203a43,#2c5364)",
    label: "Ocean",
  },
  { id: "g3", value: "linear-gradient(135deg,#667eea,#764ba2)", label: "Dusk" },
  {
    id: "g4",
    value: "linear-gradient(135deg,#11998e,#38ef7d)",
    label: "Emerald",
  },
  {
    id: "g5",
    value: "linear-gradient(135deg,#f7971e,#ffd200)",
    label: "Amber",
  },
  {
    id: "g6",
    value: "linear-gradient(135deg,#f093fb,#f5576c)",
    label: "Bloom",
  },
];

function generateSeeds(count = 12, exclude = new Set()) {
  const seeds = new Set();
  while (seeds.size < count) {
    const s = String(Math.floor(Math.random() * 9000) + 1000);
    if (!exclude.has(s)) seeds.add(s);
  }
  return [...seeds];
}

async function resizeToDataUrl(file, maxW = 1920, maxH = 1080, quality = 0.82) {
  return new Promise((resolve) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      const scale = Math.min(1, maxW / img.width, maxH / img.height);
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      canvas.getContext("2d").drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL("image/jpeg", quality));
    };
    img.src = objectUrl;
  });
}

export function createSettingsPanel(container, onClose) {
  let newTabBehavior = "meridian-view";
  let groupByDomain = false;
  let homepageUrl = "";
  let currentTheme = "system";
  let currentBg = { type: "none", value: "" };
  let photoSeeds = generateSeeds();

  const panel = document.createElement("div");

  // --- Header ---
  const header = document.createElement("div");
  header.className = "settings-header";

  const title = document.createElement("h2");
  title.className = "settings-title";
  title.textContent = "Settings";

  const closeBtn = document.createElement("button");
  closeBtn.className = "settings-close";
  closeBtn.textContent = "×";
  closeBtn.setAttribute("aria-label", "Close settings");
  closeBtn.addEventListener("click", onClose);

  header.appendChild(title);
  header.appendChild(closeBtn);
  panel.appendChild(header);

  // --- New tab behavior ---
  const newTabGroup = document.createElement("div");
  newTabGroup.className = "settings-group";

  const newTabLabel = document.createElement("span");
  newTabLabel.className = "settings-label";
  newTabLabel.textContent = "New Tab Behavior";
  newTabGroup.appendChild(newTabLabel);

  function renderNewTabOptions() {
    newTabGroup
      .querySelectorAll(".settings-option, .settings-homepage-input")
      .forEach((el) => el.remove());
    for (const opt of NEW_TAB_OPTIONS) {
      const btn = document.createElement("button");
      btn.className =
        "settings-option" + (opt.id === newTabBehavior ? " selected" : "");
      btn.setAttribute("role", "radio");
      btn.setAttribute("aria-checked", String(opt.id === newTabBehavior));

      const dot = document.createElement("span");
      dot.className = "settings-option-dot";
      btn.appendChild(dot);
      btn.appendChild(document.createTextNode(opt.label));

      btn.addEventListener("click", () => {
        newTabBehavior = opt.id;
        chrome.storage.sync.set({ newTabBehavior: opt.id });
        renderNewTabOptions();
      });
      newTabGroup.appendChild(btn);
    }

    if (newTabBehavior === "open-homepage") {
      const input = document.createElement("input");
      input.type = "url";
      input.className = "settings-homepage-input";
      input.placeholder = "https://example.com";
      input.value = homepageUrl;
      input.addEventListener("change", () => {
        homepageUrl = input.value.trim();
        chrome.storage.sync.set({ homepageUrl });
      });
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") input.blur();
      });
      newTabGroup.appendChild(input);
    }
  }

  panel.appendChild(newTabGroup);

  // --- Group by domain ---
  const domainGroup = document.createElement("div");
  domainGroup.className = "settings-group";

  const domainLabel = document.createElement("span");
  domainLabel.className = "settings-label";
  domainLabel.textContent = "Tab Organization";
  domainGroup.appendChild(domainLabel);

  const toggleRow = document.createElement("label");
  toggleRow.className = "settings-toggle-row";

  const toggleCheckbox = document.createElement("input");
  toggleCheckbox.type = "checkbox";
  toggleCheckbox.className = "settings-toggle";
  toggleCheckbox.setAttribute("aria-label", "Group unsorted tabs by domain");

  const toggleLabel = document.createElement("span");
  toggleLabel.textContent = "Group unsorted tabs by domain";

  toggleCheckbox.addEventListener("change", () => {
    groupByDomain = toggleCheckbox.checked;
    chrome.storage.sync.set({ groupByDomain });
    window.dispatchEvent(new CustomEvent("settings-changed"));
  });

  toggleRow.appendChild(toggleCheckbox);
  toggleRow.appendChild(toggleLabel);
  domainGroup.appendChild(toggleRow);
  panel.appendChild(domainGroup);

  // --- Local Search ---
  const localSearchGroup = document.createElement("div");
  localSearchGroup.className = "settings-group";

  const localSearchLabel = document.createElement("span");
  localSearchLabel.className = "settings-label";
  localSearchLabel.textContent = "Local Search";
  localSearchGroup.appendChild(localSearchLabel);

  let localSearch = { tabs: true, bookmarks: true, history: true };

  const localSearchSources = [
    { key: "tabs", label: "Open Tabs" },
    { key: "bookmarks", label: "Bookmarks" },
    { key: "history", label: "History" },
  ];

  const localSearchCheckboxes = {};

  for (const source of localSearchSources) {
    const row = document.createElement("label");
    row.className = "settings-toggle-row";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "settings-toggle";
    checkbox.setAttribute("aria-label", source.label);
    checkbox.checked = true;

    const label = document.createElement("span");
    label.textContent = source.label;

    checkbox.addEventListener("change", () => {
      localSearch[source.key] = checkbox.checked;
      chrome.storage.sync.set({ localSearch });
      window.dispatchEvent(new CustomEvent("settings-changed"));
    });

    row.appendChild(checkbox);
    row.appendChild(label);
    localSearchGroup.appendChild(row);
    localSearchCheckboxes[source.key] = checkbox;
  }

  panel.appendChild(localSearchGroup);

  // --- Theme ---
  const themeGroup = document.createElement("div");
  themeGroup.className = "settings-group";

  const themeLabel = document.createElement("span");
  themeLabel.className = "settings-label";
  themeLabel.textContent = "Theme";
  themeGroup.appendChild(themeLabel);

  const themeRow = document.createElement("div");
  themeRow.className = "settings-theme-row";

  const THEMES = [
    { id: "light", label: "Light" },
    { id: "dark", label: "Dark" },
    { id: "system", label: "System" },
  ];

  function renderThemeButtons() {
    themeRow
      .querySelectorAll(".settings-theme-btn")
      .forEach((el) => el.remove());
    for (const t of THEMES) {
      const btn = document.createElement("button");
      btn.className =
        "settings-theme-btn" + (t.id === currentTheme ? " selected" : "");
      btn.textContent = t.label;
      btn.addEventListener("click", () => {
        currentTheme = t.id;
        chrome.storage.sync.set({ theme: t.id });
        applyTheme(t.id);
        renderThemeButtons();
      });
      themeRow.appendChild(btn);
    }
  }

  themeGroup.appendChild(themeRow);
  panel.appendChild(themeGroup);

  // --- Background ---
  const bgGroup = document.createElement("div");
  bgGroup.className = "settings-group";

  const bgLabel = document.createElement("span");
  bgLabel.className = "settings-label";
  bgLabel.textContent = "Background";
  bgGroup.appendChild(bgLabel);

  function isSelected(type, value) {
    return currentBg.type === type && currentBg.value === value;
  }

  function selectBg(type, value) {
    currentBg = { type, value };
    chrome.storage.sync.set({ background: currentBg });
    applyBackground(currentBg);
    renderBgSection();
  }

  function makeSwatch(opts) {
    const btn = document.createElement("button");
    btn.className =
      "settings-bg-swatch" +
      (opts.isNone ? " settings-bg-swatch--none" : "") +
      (opts.selected ? " selected" : "");
    if (opts.style) Object.assign(btn.style, opts.style);
    if (opts.label) btn.setAttribute("aria-label", opts.label);
    if (opts.label) btn.title = opts.label;
    if (opts.text) btn.textContent = opts.text;
    if (opts.imgSrc) {
      const img = document.createElement("img");
      img.src = opts.imgSrc;
      img.alt = "";
      img.loading = "lazy";
      img.onerror = () => {
        btn.style.background = "var(--surface-hover)";
      };
      btn.appendChild(img);
    }
    btn.addEventListener("click", opts.onClick);
    return btn;
  }

  function renderBgSection() {
    bgGroup
      .querySelectorAll(
        ".settings-bg-sublabel-row, .settings-bg-combined-grid, .settings-bg-photo-grid, .settings-bg-upload-btn, .settings-bg-file-input",
      )
      .forEach((el) => el.remove());

    // ── Row label: Colors & Gradients ──
    const colorGradRow = document.createElement("div");
    colorGradRow.className = "settings-bg-sublabel-row";
    const colorGradLabel = document.createElement("span");
    colorGradLabel.className = "settings-bg-sublabel";
    colorGradLabel.textContent = "Colors & Gradients";
    colorGradRow.appendChild(colorGradLabel);
    bgGroup.appendChild(colorGradRow);

    // ── Combined 6-column grid: [None, 5 solids] + [6 gradients] ──
    const combinedGrid = document.createElement("div");
    combinedGrid.className = "settings-bg-combined-grid";

    // None
    combinedGrid.appendChild(
      makeSwatch({
        isNone: true,
        selected: currentBg.type === "none",
        label: "No background",
        text: "✕",
        onClick: () => selectBg("none", ""),
      }),
    );

    // Solid colors
    for (const c of SOLID_COLORS) {
      combinedGrid.appendChild(
        makeSwatch({
          selected: isSelected("solid", c.value),
          style: { background: c.value },
          label: c.label,
          onClick: () => selectBg("solid", c.value),
        }),
      );
    }

    // Gradients
    for (const g of GRADIENT_PRESETS) {
      combinedGrid.appendChild(
        makeSwatch({
          selected: isSelected("gradient", g.value),
          style: { background: g.value },
          label: g.label,
          onClick: () => selectBg("gradient", g.value),
        }),
      );
    }

    bgGroup.appendChild(combinedGrid);

    // ── Row label: Photos + Refresh ──
    const photoRow = document.createElement("div");
    photoRow.className = "settings-bg-sublabel-row";

    const photoLabel = document.createElement("span");
    photoLabel.className = "settings-bg-sublabel";
    photoLabel.textContent = "Photos";

    const refreshBtn = document.createElement("button");
    refreshBtn.className = "settings-bg-refresh";
    refreshBtn.textContent = "↻ Refresh";
    refreshBtn.addEventListener("click", () => {
      photoSeeds = generateSeeds(12, new Set(photoSeeds));
      renderBgSection();
    });

    photoRow.appendChild(photoLabel);
    photoRow.appendChild(refreshBtn);
    bgGroup.appendChild(photoRow);

    // ── Photo grid: 12 photos (2 rows × 6) ──
    const photoGrid = document.createElement("div");
    photoGrid.className = "settings-bg-photo-grid";

    for (const seed of photoSeeds) {
      const fullUrl = `https://picsum.photos/seed/${seed}/1920/1080`;
      const thumbUrl = `https://picsum.photos/seed/${seed}/200/125`;
      photoGrid.appendChild(
        makeSwatch({
          selected: isSelected("photo", fullUrl),
          label: `Photo ${seed}`,
          imgSrc: thumbUrl,
          onClick: () => selectBg("photo", fullUrl),
        }),
      );
    }

    bgGroup.appendChild(photoGrid);

    // ── Custom upload button ──
    const uploadBtn = document.createElement("button");
    uploadBtn.className =
      "settings-bg-upload-btn" +
      (currentBg.type === "custom" ? " selected" : "");
    uploadBtn.textContent =
      currentBg.type === "custom"
        ? "✓ Custom image active — click to replace"
        : "↑ Upload a custom image…";

    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = "image/*";
    fileInput.className = "settings-bg-file-input";
    fileInput.style.display = "none";
    fileInput.addEventListener("change", async () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      uploadBtn.disabled = true;
      uploadBtn.textContent = "Processing…";
      try {
        const dataUrl = await resizeToDataUrl(file);
        localStorage.setItem("meridian_bg_custom", dataUrl);
        selectBg("custom", "");
      } finally {
        uploadBtn.disabled = false;
      }
    });

    uploadBtn.addEventListener("click", () => fileInput.click());
    bgGroup.appendChild(fileInput);
    bgGroup.appendChild(uploadBtn);
  }

  panel.appendChild(bgGroup);

  // --- Refresh thumbnails ---
  const refreshGroup = document.createElement("div");
  refreshGroup.className = "settings-group";

  const refreshLabel = document.createElement("span");
  refreshLabel.className = "settings-label";
  refreshLabel.textContent = "Thumbnails";
  refreshGroup.appendChild(refreshLabel);

  const refreshBtn = document.createElement("button");
  refreshBtn.className = "settings-action-btn";
  refreshBtn.textContent = "Refresh all thumbnails (this will cycle tabs)";
  refreshBtn.addEventListener("click", async () => {
    refreshBtn.disabled = true;
    refreshBtn.textContent = "Refreshing…";
    await chrome.runtime.sendMessage({ type: "REFRESH_THUMBNAILS" });
    refreshBtn.textContent = "Done";
    setTimeout(() => {
      refreshBtn.disabled = false;
      refreshBtn.textContent = "Refresh all thumbnails (this will cycle tabs)";
    }, 2000);
  });
  refreshGroup.appendChild(refreshBtn);
  panel.appendChild(refreshGroup);

  container.appendChild(panel);

  chrome.storage.sync
    .get([
      "newTabBehavior",
      "groupByDomain",
      "homepageUrl",
      "theme",
      "background",
      "localSearch",
    ])
    .then((saved) => {
      if (saved.newTabBehavior) newTabBehavior = saved.newTabBehavior;
      groupByDomain = !!saved.groupByDomain;
      homepageUrl = saved.homepageUrl ?? "";
      currentTheme = saved.theme ?? "system";
      currentBg = saved.background ?? { type: "none", value: "" };
      toggleCheckbox.checked = groupByDomain;
      if (saved.localSearch) {
        localSearch = { ...localSearch, ...saved.localSearch };
        for (const key of Object.keys(localSearchCheckboxes)) {
          localSearchCheckboxes[key].checked = localSearch[key] ?? true;
        }
      }
      renderNewTabOptions();
      renderThemeButtons();
      renderBgSection();
    });

  renderNewTabOptions();
  renderThemeButtons();
  renderBgSection();
}

export function applyTheme(theme) {
  const html = document.documentElement;
  if (theme === "light") {
    html.dataset.theme = "light";
  } else if (theme === "dark") {
    html.dataset.theme = "dark";
  } else {
    delete html.dataset.theme;
  }
}

export function applyBackground(bg) {
  const root = document.documentElement;
  root.style.removeProperty("--bg");
  if (!bg || bg.type === "none") {
    root.style.removeProperty("--bg-image");
  } else if (bg.type === "solid") {
    root.style.removeProperty("--bg-image");
    root.style.setProperty("--bg", bg.value);
  } else if (bg.type === "gradient") {
    root.style.setProperty("--bg-image", bg.value);
  } else if (bg.type === "photo") {
    root.style.setProperty("--bg-image", `url("${bg.value}")`);
  } else if (bg.type === "custom") {
    const dataUrl = localStorage.getItem("meridian_bg_custom");
    if (dataUrl) {
      root.style.setProperty("--bg-image", `url("${dataUrl}")`);
    } else {
      root.style.removeProperty("--bg-image");
    }
  }
}
