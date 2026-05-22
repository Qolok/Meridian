# Meridian — Claude Code Prompt
## Spatial Tab Command Center (Chrome MV3 Extension)

Build a Chrome MV3 extension called **Meridian** that replaces the new tab page with a persistent spatial tab management dashboard. The core mental model is a **command center** — a fixed reference point the user returns to repeatedly to orient, navigate, and manage their browsing workflows. It is inspired by the GNOME Activities Overview.

---

## Core Concept

Meridian has a single pinned tab that acts as home base. The user returns to it via keyboard shortcut (`Ctrl+Shift+M`), orients themselves across their open tabs organized into workspace lanes, and jumps directly to any tab. It is not a passive new tab page — it is an active navigation hub.

---

## 1. Pinned Meridian Tab

- On extension install and browser startup, the background service worker ensures exactly one pinned Meridian tab exists at index 0.
- If the pinned tab is closed, it is automatically respawned.
- Chrome's native behavior already prevents accidental closing of pinned tabs.
- The `Ctrl+Shift+M` shortcut always focuses the pinned Meridian tab. If it doesn't exist, it creates one. It never opens a duplicate.

```javascript
async function ensureMeridianTab() {
  const tabs = await chrome.tabs.query({ pinned: true, url: "chrome://newtab/" });
  if (tabs.length === 0) {
    chrome.tabs.create({ pinned: true, index: 0 });
  }
}

chrome.runtime.onInstalled.addListener(ensureMeridianTab);
chrome.runtime.onStartup.addListener(ensureMeridianTab);
```

---

## 2. New Tab Behavior (User Setting)

The user can choose how new tabs behave. This is a setting in the Meridian settings panel, persisted via `chrome.storage.sync`:

- **Option A — Open a new Meridian view** *(default)*: New tabs show the full Meridian UI and are unpinned and closeable. Multiple Meridian views can exist; only the pinned one is permanent.
- **Option C — Always return to pinned Meridian**: Any new tab immediately detects it is not the pinned tab, focuses the pinned tab, and closes itself.

Option C implementation — runs as the first thing in `newtab.js`:

```javascript
const { newTabBehavior } = await chrome.storage.sync.get("newTabBehavior");
if (newTabBehavior === "focus-pinned") {
  const currentTab = await chrome.tabs.getCurrent();
  const [pinned] = await chrome.tabs.query({ pinned: true, url: "chrome://newtab/" });
  if (pinned && pinned.id !== currentTab.id) {
    await chrome.tabs.update(pinned.id, { active: true });
    window.close();
  }
}
```

---

## 3. New Tab Page Layout

The new tab page has two zones:

### Search Bar (top, centered)
- Prominent search input, focused by default on load
- Search provider selector: Google, DuckDuckGo, Bing, Brave
- Provider preference persists via `chrome.storage.sync`
- Pressing `/` from anywhere in the UI refocuses the search bar

### Tab Grid (below search bar)
- All open tabs rendered as cards in a responsive grid (4–5 columns at 1440px, fluid below)
- Tabs organized into named **workspace lanes** — horizontal labeled sections
- Clicking any card immediately switches to that tab (`chrome.tabs.update({ active: true })`)
- Cards show a close button on hover

---

## 4. Tab Cards

Each card displays:
- Favicon
- Page title (truncated to 2 lines)
- Screenshot thumbnail — captured via `chrome.tabs.captureVisibleTab()`, cached as base64 in `chrome.storage.local`, refreshed when a tab loses focus. Show a placeholder if no thumbnail exists yet.

Hover state:
- Subtle scale or elevation lift
- Close button (×) appears top-right
- Clear focus ring for keyboard nav

---

## 5. Workspaces

Tabs are organized into workspace lanes rendered as labeled horizontal sections within the grid.

### Auto-grouping
- On first load, cluster tabs by root domain (e.g. all `github.com` tabs → "GitHub" workspace)
- Use a `domainCluster.js` utility that extracts root domain from URL and groups accordingly
- Suggested workspace names derived from domain (capitalize, strip TLD)

### Manual Control
- User can drag tabs between workspaces
- Rename workspaces inline (double-click label)
- Create new workspaces (`N` key or + button)
- Delete empty workspaces
- Unassigned tabs live in a default "Unsorted" workspace

### Persistence
- Workspace assignments stored in `chrome.storage.local` keyed by tab ID
- On tab close, clean up its workspace assignment
- On new tab detection, place in Unsorted until user assigns

---

## 6. Keyboard Navigation

Full keyboard support is required throughout — not optional.

| Key | Action |
|-----|--------|
| Arrow keys | Navigate between cards in the grid |
| Enter | Jump to focused tab |
| W | Close focused tab |
| / | Focus search bar |
| N | Create new workspace |
| Escape | Blur search, return focus to grid |
| Tab | Move between interactive elements |

Visual focus ring must be clearly visible at all times in both light and dark themes.

---

## 7. Settings Panel

Accessible via a gear icon. Contains:

- **Search provider** selector (Google, DuckDuckGo, Bing, Brave)
- **New tab behavior** toggle:
  - "Open a new Meridian view" (Option A — default)
  - "Always return to pinned Meridian" (Option C)

All settings persist via `chrome.storage.sync`.

---

## 8. Visual Theme

- Match system color scheme via `prefers-color-scheme` — provide clean dark and light variants
- Typography: `system-ui`
- Aesthetic: native OS component feel, not a web app — minimal, spatial, calm
- No heavy UI frameworks — keep it lean and fast
- React is acceptable if it simplifies component state management

---

## Technical Requirements

- Chrome MV3 manifest
- Service worker background script (no persistent background page)
- `chrome_url_overrides: { newtab: "newtab.html" }`
- Permissions: `tabs`, `tabGroups`, `storage`, `history`, `scripting`
- MV3 service workers are ephemeral — no critical state in memory only
- All tab reads are async — handle loading states gracefully in the UI
- Thumbnail strategy: capture on tab blur via background listener, store base64 in `chrome.storage.local`, evict entries for closed tabs

---

## File Structure

```
/meridian
  manifest.json
  background.js
  newtab.html
  newtab.js
  newtab.css
  /components
    TabCard.js
    WorkspaceLane.js
    SearchBar.js
    SettingsPanel.js
  /utils
    thumbnailCache.js
    workspaceManager.js
    domainCluster.js
```

---

## Out of Scope for v1

- Multi-window support
- Session restore
- Sync across devices
- Any backend or auth
- Browser history browsing (search only)

---

## Success Criteria for v1

- Pinned Meridian tab survives browser restarts
- Shortcut (`Ctrl+Shift+M`) focuses pinned tab reliably
- All open tabs visible in grid with correct workspace assignment
- Keyboard navigation works end-to-end without touching the mouse
- New tab behavior setting works correctly for both options
- Thumbnails appear for recently visited tabs
