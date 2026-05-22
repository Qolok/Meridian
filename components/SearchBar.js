const PROVIDERS = [
  { id: 'google',     name: 'Google',     url: 'https://www.google.com/search?q=',         favicon: 'https://www.google.com/favicon.ico' },
  { id: 'duckduckgo', name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=',               favicon: 'https://duckduckgo.com/favicon.ico' },
  { id: 'bing',       name: 'Bing',       url: 'https://www.bing.com/search?q=',            favicon: 'https://www.bing.com/favicon.ico' },
  { id: 'brave',      name: 'Brave',      url: 'https://search.brave.com/search?q=',        favicon: 'https://brave.com/favicon.ico' },
];

const SEARCH_ICON = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>`;

export function createSearchBar(container) {
  let currentProvider = PROVIDERS[0];
  let dropdownOpen = false;

  const wrapper = document.createElement('div');
  wrapper.className = 'search-container';

  // Left: engine logo button (opens provider dropdown)
  const logoBtn = document.createElement('button');
  logoBtn.className = 'search-logo-btn';
  logoBtn.setAttribute('aria-haspopup', 'listbox');
  logoBtn.setAttribute('aria-label', 'Choose search engine');

  const logoImg = document.createElement('img');
  logoImg.className = 'search-logo';
  logoImg.width = 18;
  logoImg.height = 18;
  logoImg.alt = '';
  logoImg.onerror = () => {
    logoImg.style.display = 'none';
    logoFallback.style.display = 'flex';
  };

  const logoFallback = document.createElement('span');
  logoFallback.className = 'search-logo-fallback';
  logoFallback.style.display = 'none';

  logoBtn.appendChild(logoImg);
  logoBtn.appendChild(logoFallback);

  // Dropdown
  const dropdown = document.createElement('div');
  dropdown.className = 'provider-dropdown hidden';
  dropdown.setAttribute('role', 'listbox');
  logoBtn.appendChild(dropdown);

  // Center: search input
  const input = document.createElement('input');
  input.className = 'search-input';
  input.type = 'text';
  input.placeholder = 'Search…';
  input.setAttribute('aria-label', 'Search');
  input.autofocus = true;

  // Right: submit button
  const submitBtn = document.createElement('button');
  submitBtn.className = 'search-submit-btn';
  submitBtn.setAttribute('aria-label', 'Search');
  submitBtn.innerHTML = SEARCH_ICON;

  function updateProvider(provider) {
    currentProvider = provider;
    logoImg.src = provider.favicon;
    logoImg.style.display = '';
    logoFallback.style.display = 'none';
    logoFallback.textContent = provider.name.charAt(0);
    logoBtn.setAttribute('aria-label', `Search engine: ${provider.name}`);
    renderDropdown();
    chrome.storage.sync.set({ searchProvider: provider.id });
  }

  function renderDropdown() {
    dropdown.innerHTML = '';
    for (const p of PROVIDERS) {
      const opt = document.createElement('div');
      opt.className = 'provider-option' + (p.id === currentProvider.id ? ' active' : '');
      opt.textContent = p.name;
      opt.setAttribute('role', 'option');
      opt.addEventListener('click', (e) => {
        e.stopPropagation();
        updateProvider(p);
        closeDropdown();
      });
      dropdown.appendChild(opt);
    }
  }

  function openDropdown() {
    dropdownOpen = true;
    dropdown.classList.remove('hidden');
    logoBtn.setAttribute('aria-expanded', 'true');
  }

  function closeDropdown() {
    dropdownOpen = false;
    dropdown.classList.add('hidden');
    logoBtn.setAttribute('aria-expanded', 'false');
  }

  function doSearch() {
    const q = input.value.trim();
    if (!q) return;
    chrome.tabs.create({ url: currentProvider.url + encodeURIComponent(q) });
    input.value = '';
  }

  logoBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    dropdownOpen ? closeDropdown() : openDropdown();
  });

  document.addEventListener('click', closeDropdown);

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doSearch();
    if (e.key === 'Escape') { input.value = ''; input.blur(); }
  });

  submitBtn.addEventListener('click', doSearch);

  wrapper.appendChild(logoBtn);
  wrapper.appendChild(input);
  wrapper.appendChild(submitBtn);
  container.appendChild(wrapper);

  chrome.storage.sync.get('searchProvider').then(({ searchProvider }) => {
    const saved = PROVIDERS.find(p => p.id === searchProvider) ?? PROVIDERS[0];
    updateProvider(saved);
  });

  renderDropdown();

  return { focus: () => input.focus() };
}
