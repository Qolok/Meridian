const PROVIDERS = [
  { id: 'google', name: 'Google', url: 'https://www.google.com/search?q=' },
  { id: 'duckduckgo', name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=' },
  { id: 'bing', name: 'Bing', url: 'https://www.bing.com/search?q=' },
  { id: 'brave', name: 'Brave', url: 'https://search.brave.com/search?q=' },
];

export function createSearchBar(container) {
  let currentProvider = PROVIDERS[0];
  let dropdownOpen = false;

  const wrapper = document.createElement('div');
  wrapper.className = 'search-container';

  const input = document.createElement('input');
  input.className = 'search-input';
  input.type = 'text';
  input.placeholder = 'Search…';
  input.setAttribute('aria-label', 'Search');
  input.autofocus = true;

  const providerBtn = document.createElement('button');
  providerBtn.className = 'provider-btn';
  providerBtn.setAttribute('aria-haspopup', 'listbox');

  const dropdown = document.createElement('div');
  dropdown.className = 'provider-dropdown hidden';
  dropdown.setAttribute('role', 'listbox');

  function updateProvider(provider) {
    currentProvider = provider;
    providerBtn.textContent = provider.name;
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
      opt.addEventListener('click', () => {
        updateProvider(p);
        closeDropdown();
      });
      dropdown.appendChild(opt);
    }
  }

  function openDropdown() {
    dropdownOpen = true;
    dropdown.classList.remove('hidden');
    providerBtn.setAttribute('aria-expanded', 'true');
  }

  function closeDropdown() {
    dropdownOpen = false;
    dropdown.classList.add('hidden');
    providerBtn.setAttribute('aria-expanded', 'false');
  }

  providerBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    dropdownOpen ? closeDropdown() : openDropdown();
  });

  document.addEventListener('click', () => closeDropdown());

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && input.value.trim()) {
      const query = encodeURIComponent(input.value.trim());
      window.location.href = currentProvider.url + query;
    }
    if (e.key === 'Escape') {
      input.value = '';
      input.blur();
    }
  });

  wrapper.appendChild(input);
  wrapper.appendChild(providerBtn);
  wrapper.appendChild(dropdown);
  container.appendChild(wrapper);

  chrome.storage.sync.get('searchProvider').then(({ searchProvider }) => {
    const saved = PROVIDERS.find(p => p.id === searchProvider) ?? PROVIDERS[0];
    updateProvider(saved);
  });

  renderDropdown();

  return { focus: () => input.focus() };
}
