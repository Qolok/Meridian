export function createNewTabCard(groupId = null) {
  // Idle: small round button centered in its grid cell
  const idleEl = document.createElement('div');
  idleEl.className = 'new-tab-card';

  const idleBtn = document.createElement('button');
  idleBtn.className = 'new-tab-idle-btn';
  idleBtn.textContent = '+';
  idleBtn.setAttribute('aria-label', 'New tab');
  idleEl.appendChild(idleBtn);

  // Active: full-sized card with URL input where the tab name would be
  const activeEl = document.createElement('div');
  activeEl.className = 'tab-card new-tab-active hidden';
  activeEl.tabIndex = 0;

  const thumbPlaceholder = document.createElement('div');
  thumbPlaceholder.className = 'card-thumbnail-placeholder';
  activeEl.appendChild(thumbPlaceholder);

  const cardInfo = document.createElement('div');
  cardInfo.className = 'card-info';
  const urlInput = document.createElement('input');
  urlInput.type = 'text';
  urlInput.className = 'new-tab-url-input';
  urlInput.placeholder = 'URL or search…';
  cardInfo.appendChild(urlInput);
  activeEl.appendChild(cardInfo);

  // The wrapper exposes whichever element is current
  const wrapper = document.createDocumentFragment();
  wrapper._idle = idleEl;
  wrapper._active = activeEl;

  function activate() {
    idleEl.classList.add('hidden');
    activeEl.classList.remove('hidden');
    urlInput.focus();
  }

  function deactivate() {
    activeEl.classList.add('hidden');
    idleEl.classList.remove('hidden');
    urlInput.value = '';
  }

  const SEARCH_URLS = {
    google:     'https://www.google.com/search?q=',
    duckduckgo: 'https://duckduckgo.com/?q=',
    bing:       'https://www.bing.com/search?q=',
    brave:      'https://search.brave.com/search?q=',
  };

  async function openTab(raw) {
    const value = raw.trim();
    if (!value) { deactivate(); return; }
    let url;
    if (/^https?:\/\//i.test(value)) {
      url = value;
    } else if (/^[^/\s]+\.[^/\s]+(\/|$)/.test(value)) {
      url = 'https://' + value;
    } else {
      const { searchProvider } = await chrome.storage.sync.get('searchProvider');
      const base = SEARCH_URLS[searchProvider] ?? SEARCH_URLS.google;
      url = base + encodeURIComponent(value);
    }
    const tab = await chrome.tabs.create({ url });
    if (groupId !== null) {
      chrome.tabs.group({ tabIds: [tab.id], groupId }).catch(() => {});
    }
    deactivate();
  }

  idleBtn.addEventListener('click', activate);
  idleEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') activate(); });

  urlInput.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') openTab(urlInput.value);
    if (e.key === 'Escape') deactivate();
  });
  urlInput.addEventListener('blur', () => setTimeout(deactivate, 150));

  // Return a plain array so WorkspaceLane can append both siblings into the grid
  return [idleEl, activeEl];
}
