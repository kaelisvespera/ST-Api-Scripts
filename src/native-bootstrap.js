// Native SillyTavern / TauriTavern front-end extension. No Tavern Helper needed.
const ttHost = window;
await (ttHost.__TAURITAVERN__?.ready ?? ttHost.__TAURITAVERN_MAIN_READY__);
const ttContext = ttHost.SillyTavern.getContext();
const ttHostFetch = ttHost.fetch.bind(ttHost);
// Standard ST caches secret metadata in its secrets module. Unlike TT, its
// connect handler does not refresh that cache before checking for a saved key.
const fetch = ttHost.__TAURITAVERN__ ? ttHostFetch : async (url, init) => {
  const response = await ttHostFetch(url, init);
  if (response.ok && (url === '/api/secrets/write' || url === '/api/secrets/rotate')) {
    const { readSecretState } = await import('/scripts/secrets.js');
    await readSecretState();
  }
  return response;
};
const ttStore = ttHost.__TAURITAVERN__?.api?.extension?.store;
const ttStorageEntry = { namespace: 'st-api-manager', key: 'state' };
const ttStorageKeys = [
  'api_configs_manager', 'api_configs_categories',
  'api_configs_collapsed_categories', 'api_configs_category_switch_indexes',
  'stb_api_management_settings', 'api_configs_invalid_issues',
  'st_api_manager_sync_metadata_v1', 'st_api_manager_tt_secret_bindings_v1',
];
// Keep the script's TT namespace so existing sites, groups and keys are read in place.
// Standard SillyTavern persists the same value through its per-user extension settings.
const ttSettingsValue = ttStore ? undefined : ttContext.extensionSettings['st-api-manager'];
const ttSaved = ttStore
  ? await ttStore.tryGetJson(ttStorageEntry)
  : { found: ttSettingsValue !== undefined, value: ttSettingsValue };
const ttValues = Object.assign(Object.create(null), ttSaved.found ? ttSaved.value.values : {});
let ttPendingStorage = Promise.resolve();
function ttPersistStorage() {
  const value = { version: 1, values: { ...ttValues } };
  ttPendingStorage = ttPendingStorage.catch(() => {}).then(() => {
    if (ttStore) return ttStore.setJson({ ...ttStorageEntry, value });
    ttContext.extensionSettings['st-api-manager'] = value;
    ttContext.saveSettingsDebounced();
  });
  ttPendingStorage.catch(error => {
    console.error('[API 管理器] 配置保存失败', error);
    ttHost.toastr.error('API 配置保存失败，请保持面板打开并导出备份。');
  });
  return ttPendingStorage;
}
if (!ttSaved.found) {
  for (const key of ttStorageKeys) {
    const value = window.localStorage.getItem(key);
    if (value !== null) ttValues[key] = value;
  }
  if (Object.keys(ttValues).length) await ttPersistStorage();
}
// Scope the upstream storage interface to this module; never replace window.localStorage.
const localStorage = {
  getItem(key) { return Object.hasOwn(ttValues, key) ? ttValues[key] : null; },
  setItem(key, value) { ttValues[key] = String(value); ttPersistStorage(); },
  removeItem(key) { delete ttValues[key]; ttPersistStorage(); },
};
export async function flushTauriTavernStorage() { await ttPendingStorage; }

async function ttPopupApi() {
  return { Popup: ttContext.Popup, POPUP_RESULT: ttContext.POPUP_RESULT };
}
function ttOnSettingsReady(listener) {
  const event = ttContext.eventTypes.CHAT_COMPLETION_SETTINGS_READY;
  ttContext.eventSource.makeFirst(event, listener);
  return { stop() { ttContext.eventSource.removeListener(event, listener); } };
}
async function ttGenerateRaw(config) {
  const api = config.custom_api;
  const source = er(api.source);
  const id = await ttRegisterSecret(ttContext, { groupName: '测试消息' }, null, source.secretKey, api.key, false);
  const body = {
    type: 'quiet', chat_completion_source: api.source, model: api.model,
    messages: config.ordered_prompts, stream: false,
    max_tokens: ttContext.chatCompletionSettings.openai_max_tokens,
    temperature: ttContext.chatCompletionSettings.temp_openai, secret_id: id,
  };
  if (source.requiresCustomUrl) body.custom_url = api.apiurl;
  if (api.source === 'custom') body.custom_api_format = 'openai_compat';
  const response = await fetch('/api/backends/chat-completions/generate', {
    method: 'POST', headers: ttContext.getRequestHeaders(), body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok || result.error) {
    throw new Error(result.error?.message || result.error || `测试消息失败（HTTP ${response.status}）`);
  }
  const content = result.choices?.[0]?.message?.content;
  const text = Array.isArray(content) ? content.map(part => part.text || '').join('') : content;
  if (typeof text !== 'string' || !text.trim()) throw new Error('测试消息未收到文本响应');
  return text;
}
