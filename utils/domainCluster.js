const KNOWN_NAMES = {
  'youtube.com': 'YouTube',
  'duckduckgo.com': 'DuckDuckGo',
  'stackoverflow.com': 'Stack Overflow',
  'github.com': 'GitHub',
  'google.com': 'Google',
  'gmail.com': 'Gmail',
  'reddit.com': 'Reddit',
  'twitter.com': 'Twitter',
  'x.com': 'X',
  'linkedin.com': 'LinkedIn',
  'wikipedia.org': 'Wikipedia',
  'notion.so': 'Notion',
  'figma.com': 'Figma',
  'vercel.com': 'Vercel',
  'netlify.com': 'Netlify',
};

const SYSTEM_PROTOCOLS = ['chrome:', 'chrome-extension:', 'about:', 'edge:', 'moz-extension:'];

export function getRootDomain(url) {
  try {
    const u = new URL(url);
    if (SYSTEM_PROTOCOLS.includes(u.protocol)) return null;
    const parts = u.hostname.split('.');
    return parts.length >= 2 ? parts.slice(-2).join('.') : u.hostname;
  } catch {
    return null;
  }
}

export function domainToWorkspaceName(domain) {
  if (KNOWN_NAMES[domain]) return KNOWN_NAMES[domain];
  const base = domain.split('.')[0];
  return base
    .split('-')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export function clusterTabsByDomain(tabs) {
  const byDomain = new Map();
  for (const tab of tabs) {
    const domain = getRootDomain(tab.url || tab.pendingUrl || '');
    const name = domain ? domainToWorkspaceName(domain) : 'Unsorted';
    if (!byDomain.has(name)) byDomain.set(name, []);
    byDomain.get(name).push(tab);
  }

  const clusters = new Map();
  const unsorted = [];
  for (const [name, clusterTabs] of byDomain) {
    if (name !== 'Unsorted' && clusterTabs.length >= 2) {
      clusters.set(name, clusterTabs);
    } else {
      unsorted.push(...clusterTabs);
    }
  }
  if (unsorted.length > 0) clusters.set('Unsorted', unsorted);
  return clusters;
}
