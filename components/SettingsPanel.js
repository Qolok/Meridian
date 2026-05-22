const NEW_TAB_OPTIONS = [
  { id: 'meridian-view', label: 'Open a new Meridian view' },
  { id: 'focus-pinned', label: 'Always return to pinned Meridian' },
];

export function createSettingsPanel(container, onClose) {
  let newTabBehavior = 'meridian-view';
  let groupByDomain = false;

  const panel = document.createElement('div');

  const header = document.createElement('div');
  header.className = 'settings-header';

  const title = document.createElement('h2');
  title.className = 'settings-title';
  title.textContent = 'Settings';

  const closeBtn = document.createElement('button');
  closeBtn.className = 'settings-close';
  closeBtn.textContent = '×';
  closeBtn.setAttribute('aria-label', 'Close settings');
  closeBtn.addEventListener('click', onClose);

  header.appendChild(title);
  header.appendChild(closeBtn);
  panel.appendChild(header);

  // --- New tab behavior ---
  const newTabGroup = document.createElement('div');
  newTabGroup.className = 'settings-group';

  const newTabLabel = document.createElement('span');
  newTabLabel.className = 'settings-label';
  newTabLabel.textContent = 'New Tab Behavior';
  newTabGroup.appendChild(newTabLabel);

  function renderNewTabOptions() {
    newTabGroup.querySelectorAll('.settings-option').forEach(el => el.remove());
    for (const opt of NEW_TAB_OPTIONS) {
      const btn = document.createElement('button');
      btn.className = 'settings-option' + (opt.id === newTabBehavior ? ' selected' : '');
      btn.setAttribute('role', 'radio');
      btn.setAttribute('aria-checked', String(opt.id === newTabBehavior));

      const dot = document.createElement('span');
      dot.className = 'settings-option-dot';
      btn.appendChild(dot);
      btn.appendChild(document.createTextNode(opt.label));

      btn.addEventListener('click', () => {
        newTabBehavior = opt.id;
        chrome.storage.sync.set({ newTabBehavior: opt.id });
        renderNewTabOptions();
      });
      newTabGroup.appendChild(btn);
    }
  }

  panel.appendChild(newTabGroup);

  // --- Group by domain toggle ---
  const domainGroup = document.createElement('div');
  domainGroup.className = 'settings-group';

  const domainLabel = document.createElement('span');
  domainLabel.className = 'settings-label';
  domainLabel.textContent = 'Ungrouped Tabs';
  domainGroup.appendChild(domainLabel);

  const toggleRow = document.createElement('label');
  toggleRow.className = 'settings-toggle-row';

  const toggleCheckbox = document.createElement('input');
  toggleCheckbox.type = 'checkbox';
  toggleCheckbox.className = 'settings-toggle';
  toggleCheckbox.setAttribute('aria-label', 'Group ungrouped tabs by domain');

  const toggleLabel = document.createElement('span');
  toggleLabel.textContent = 'Group by domain (2+ tabs per domain)';

  toggleCheckbox.addEventListener('change', () => {
    groupByDomain = toggleCheckbox.checked;
    chrome.storage.sync.set({ groupByDomain });
    // Notify the page to re-render
    window.dispatchEvent(new CustomEvent('settings-changed'));
  });

  toggleRow.appendChild(toggleCheckbox);
  toggleRow.appendChild(toggleLabel);
  domainGroup.appendChild(toggleRow);
  panel.appendChild(domainGroup);

  container.appendChild(panel);

  chrome.storage.sync.get(['newTabBehavior', 'groupByDomain']).then((saved) => {
    if (saved.newTabBehavior) newTabBehavior = saved.newTabBehavior;
    groupByDomain = !!saved.groupByDomain;
    toggleCheckbox.checked = groupByDomain;
    renderNewTabOptions();
  });

  renderNewTabOptions();
}
