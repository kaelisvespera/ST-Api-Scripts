// TauriTavern 2.4 adaptation of samiytaa/ST-AllInOneFloatOrb, API Manager 2.1.1.
// Runs in a Tavern Helper script iframe. Do not install as a native TT extension.
const ttHost = window.parent || window;
await (ttHost.__TAURITAVERN__?.ready ?? ttHost.__TAURITAVERN_MAIN_READY__);
const ttStore = ttHost.__TAURITAVERN__?.api?.extension?.store;
if (!ttStore) throw new Error('此版本需要 TauriTavern 2.4 的扩展存储 API。');
const fetch = ttHost.fetch.bind(ttHost);

// Hydrate before the upstream synchronous storage readers run. Keep old browser
// data intact; migrate only when the TT store explicitly reports no saved state.
const ttStorageEntry = { namespace: 'st-api-manager', key: 'state' };
const ttStorageKeys = [
  'api_configs_manager', 'api_configs_categories',
  'api_configs_collapsed_categories', 'api_configs_category_switch_indexes',
  'stb_api_management_settings', 'api_configs_invalid_issues',
  'st_api_manager_sync_metadata_v1',
];
const ttSaved = await ttStore.tryGetJson(ttStorageEntry);
const ttValues = Object.assign(Object.create(null), ttSaved.found ? ttSaved.value.values : {});
let ttPendingStorage = Promise.resolve();
function ttPersistStorage() {
  const value = { version: 1, values: { ...ttValues } };
  ttPendingStorage = ttPendingStorage.catch(() => {}).then(() =>
    ttStore.setJson({ ...ttStorageEntry, value }),
  );
  ttPendingStorage.catch(error => {
    console.error('[API 管理器 TT] 扩展存储写入失败', error);
    (window.toastr || ttHost.toastr)?.error('API 配置保存失败，请保持面板打开并导出备份。');
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
const localStorage = {
  getItem(key) { return Object.hasOwn(ttValues, key) ? ttValues[key] : null; },
  setItem(key, value) { ttValues[key] = String(value); ttPersistStorage(); },
  removeItem(key) { delete ttValues[key]; ttPersistStorage(); },
};
export async function flushTauriTavernStorage() { await ttPendingStorage; }

// Module maps belong to each Window, even for an identical absolute URL.
// Create the importer in TT's realm so native modules share its initialized
// globals and live secret state instead of booting TT again inside the iframe.
const ttImportHostModule = ttHost.Function('specifier', 'return import(specifier)');

// Use the host's public popup API rather than resolving /scripts on the CDN.
async function ttPopupApi() {
  const context = ttHost.SillyTavern?.getContext?.();
  if (context?.Popup?.show && context.POPUP_RESULT) {
    return { Popup: context.Popup, POPUP_RESULT: context.POPUP_RESULT };
  }
  return ttImportHostModule(new URL('/scripts/popup.js', ttHost.location.href).href);
}
async function ttSecretsApi() {
  return ttImportHostModule(new URL('/scripts/secrets.js', ttHost.location.href).href);
}
// Use TT's own batch-apply scope, also used by its connection manager.
async function ttWithConnectionValidationSuspended(callback) {
  const { withConnectionValidationSuspended } = await ttImportHostModule(new URL('/script.js', ttHost.location.href).href);
  return withConnectionValidationSuspended('API 管理器应用配置', callback);
}
function ttGenerateRaw(config) {
  // This is Tavern Helper's function; SillyTavern.getContext().generateRaw has
  // a different signature and silently ignores custom_api / ordered_prompts.
  if (typeof generateRaw === 'function') return generateRaw(config);
  if (typeof ttHost.TavernHelper?.generateRaw === 'function') {
    return ttHost.TavernHelper.generateRaw(config);
  }
  throw new Error('找不到酒馆助手 generateRaw，请启用或更新酒馆助手。');
}
