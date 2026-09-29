const controls = {
  start: document.querySelector('#start'), stop: document.querySelector('#stop'),
  export: document.querySelector('#export'), clear: document.querySelector('#clear'),
  status: document.querySelector('#statusLabel'), dot: document.querySelector('#statusDot'),
  events: document.querySelector('#eventCount'), animations: document.querySelector('#animationCount'),
  mutations: document.querySelector('#mutationCount'), message: document.querySelector('#message'),
};

const message = (key, substitutions) => chrome.i18n.getMessage(key, substitutions) || key;

function localizeDocument() {
  document.documentElement.lang = chrome.i18n.getUILanguage() || 'en';
  document.querySelectorAll('[data-i18n]').forEach(node => {
    node.textContent = message(node.dataset.i18n);
  });
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function render(status = {}) {
  const recording = status.state === 'recording';
  const eventCount = Number(status.events) || 0;
  const animationCount = Number(status.animations) || 0;
  const mutationCount = Number(status.mutations) || 0;
  const platform = status.platform === 'webflow' ? 'Webflow' : status.platform === 'framer' ? 'Framer' : status.platform === 'code' ? message('platformCode') : '';
  const stateLabel = recording ? message('recording') : status.state === 'stopped' ? message('captureCompleted') : message('ready');
  controls.status.textContent = platform ? `${stateLabel} · ${platform}` : stateLabel;
  controls.dot.classList.toggle('active', recording);
  controls.events.textContent = message(eventCount === 1 ? 'eventCountOne' : 'eventCount', String(eventCount));
  controls.animations.textContent = message(animationCount === 1 ? 'animationCountOne' : 'animationCount', String(animationCount));
  controls.mutations.textContent = message(mutationCount === 1 ? 'mutationCountOne' : 'mutationCount', String(mutationCount));
  controls.start.disabled = recording;
  controls.stop.disabled = !recording;
  // Webflow/static-code imports remain useful even without recorded gestures:
  // their original HTML/CSS/JS runtime is the primary capture artifact.
  controls.export.disabled = status.state === 'idle';
}

async function command(type) {
  controls.message.textContent = '';
  const tab = await activeTab();
  if (!tab?.id || !/^https?:/i.test(tab.url || '')) throw new Error(message('openHttpPage'));
  const response = await chrome.runtime.sendMessage({ type, tabId: tab.id });
  if (response?.ok === false) throw new Error(response.message || message('operationFailed'));
  return response;
}

controls.start.addEventListener('click', async () => {
  try { render(await command('KODETY_BACKGROUND_START')); }
  catch (error) { controls.message.textContent = error.message; }
});
controls.stop.addEventListener('click', async () => {
  try { render(await command('KODETY_BACKGROUND_STOP')); }
  catch (error) { controls.message.textContent = error.message; }
});
controls.clear.addEventListener('click', async () => {
  try { render(await command('KODETY_BACKGROUND_CLEAR')); }
  catch (error) { controls.message.textContent = error.message; }
});
controls.export.addEventListener('click', async () => {
  try {
    controls.export.disabled = true;
    controls.export.textContent = message('compiling');
    const result = await command('KODETY_BACKGROUND_EXPORT');
    if (!result?.ok) throw new Error(result?.message || message('exportFailed'));
    controls.message.textContent = message('zipGenerated');
  } catch (error) { controls.message.textContent = error.message; }
  finally { controls.export.textContent = message('compileDownloadZip'); refresh(); }
});

async function refresh() {
  try {
    const tab = await activeTab();
    if (!tab?.id) return render();
    render(await chrome.runtime.sendMessage({ type: 'KODETY_BACKGROUND_STATUS', tabId: tab.id }));
  } catch { render(); }
}
localizeDocument();
refresh();
