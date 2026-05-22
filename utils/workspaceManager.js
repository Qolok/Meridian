const STORAGE_KEY = "workspaces";
const SCHEMA_VERSION = 2;

const DEFAULT_DATA = {
  version: SCHEMA_VERSION,
  workspaces: [{ id: "unsorted", name: "Unsorted" }],
  assignments: {},
};

export async function getWorkspaceData() {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  const data = result[STORAGE_KEY];
  // Clear stale data from old schema (auto-populated from initFromTabs)
  if (!data || data.version !== SCHEMA_VERSION) {
    await chrome.storage.local.set({ [STORAGE_KEY]: DEFAULT_DATA });
    return structuredClone(DEFAULT_DATA);
  }
  if (!data.workspaces.find((w) => w.id === "unsorted")) {
    data.workspaces.unshift({ id: "unsorted", name: "Unsorted" });
  }
  return data;
}

export async function saveWorkspaceData(data) {
  data.version = SCHEMA_VERSION;
  await chrome.storage.local.set({ [STORAGE_KEY]: data });
}

export async function assignTab(tabId, workspaceId) {
  const data = await getWorkspaceData();
  data.assignments[String(tabId)] = workspaceId;
  await saveWorkspaceData(data);
}

export async function unassignTab(tabId) {
  const data = await getWorkspaceData();
  delete data.assignments[String(tabId)];
  await saveWorkspaceData(data);
}

export async function createWorkspace(name) {
  const data = await getWorkspaceData();
  const workspace = { id: crypto.randomUUID(), name };
  data.workspaces.push(workspace);
  await saveWorkspaceData(data);
  return workspace;
}

export async function renameWorkspace(workspaceId, newName) {
  const data = await getWorkspaceData();
  const ws = data.workspaces.find((w) => w.id === workspaceId);
  if (ws) ws.name = newName;
  await saveWorkspaceData(data);
}

export async function deleteWorkspace(workspaceId) {
  if (workspaceId === "unsorted") return;
  const data = await getWorkspaceData();
  data.workspaces = data.workspaces.filter((w) => w.id !== workspaceId);
  for (const [tabId, wsId] of Object.entries(data.assignments)) {
    if (wsId === workspaceId) data.assignments[tabId] = "unsorted";
  }
  await saveWorkspaceData(data);
}

export async function getTabWorkspace(tabId) {
  const data = await getWorkspaceData();
  return data.assignments[String(tabId)] ?? "unsorted";
}

export async function initFromTabs(tabs, clusterFn) {
  const data = await getWorkspaceData();
  if (data.workspaces.length > 1) return;

  const clusters = clusterFn(tabs);
  for (const [name, clusterTabs] of clusters) {
    if (name === "Unsorted") continue;
    const ws = { id: crypto.randomUUID(), name };
    data.workspaces.push(ws);
    for (const tab of clusterTabs) {
      data.assignments[String(tab.id)] = ws.id;
    }
  }
  await saveWorkspaceData(data);
}
