const PREFIX = "thumb_";

export async function getThumbnail(tabId) {
  const key = PREFIX + tabId;
  const result = await chrome.storage.local.get(key);
  return result[key] ?? null;
}

export async function saveThumbnail(tabId, dataUrl) {
  await chrome.storage.local.set({ [PREFIX + tabId]: dataUrl });
}

export async function evictThumbnail(tabId) {
  await chrome.storage.local.remove(PREFIX + tabId);
}

export async function getAllThumbnails() {
  const all = await chrome.storage.local.get(null);
  const thumbnails = {};
  for (const [key, value] of Object.entries(all)) {
    if (key.startsWith(PREFIX)) {
      thumbnails[key.slice(PREFIX.length)] = value;
    }
  }
  return thumbnails;
}
