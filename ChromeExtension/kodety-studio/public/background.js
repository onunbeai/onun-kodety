const STUDIO_TAB_STORAGE_KEY = 'kodetyStudioActiveTabId';

async function focusExistingStudioTab() {
  const stored = await chrome.storage.session.get(STUDIO_TAB_STORAGE_KEY);
  const tabId = stored[STUDIO_TAB_STORAGE_KEY];
  if (!Number.isInteger(tabId)) return false;

  try {
    const tab = await chrome.tabs.get(tabId);
    await chrome.tabs.update(tabId, { active: true });
    if (Number.isInteger(tab.windowId)) {
      await chrome.windows.update(tab.windowId, { focused: true });
    }
    return true;
  } catch {
    await chrome.storage.session.remove(STUDIO_TAB_STORAGE_KEY);
    return false;
  }
}

chrome.action.onClicked.addListener(async () => {
  if (await focusExistingStudioTab()) return;
  const tab = await chrome.tabs.create({ url: chrome.runtime.getURL('index.html') });
  if (Number.isInteger(tab.id)) {
    await chrome.storage.session.set({ [STUDIO_TAB_STORAGE_KEY]: tab.id });
  }
});

chrome.tabs.onRemoved.addListener(tabId => {
  void chrome.storage.session.get(STUDIO_TAB_STORAGE_KEY).then(stored => {
    if (stored[STUDIO_TAB_STORAGE_KEY] === tabId) {
      return chrome.storage.session.remove(STUDIO_TAB_STORAGE_KEY);
    }
    return undefined;
  });
});
