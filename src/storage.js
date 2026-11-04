const managerNamespace = 'st-api-manager';
const catalogKey = 'st_api_manager_catalog_v2';
const legacyAccountKey = 'st_api_manager_sync_v1';
const accountKey = 'st_api_manager_sync_v2';
const storageEntry = { namespace: managerNamespace, key: 'state' };
const legacyStorageKeys = [
  'api_configs_manager', 'api_configs_categories', 'api_configs_collapsed_categories',
  'api_configs_category_switch_indexes', 'stb_api_management_settings', 'api_configs_invalid_issues',
  'st_api_manager_sync_metadata_v1', 'st_api_manager_tt_secret_bindings_v1',
];

async function openCatalogStorage(host, context, browserStorage) {
  const store = host.__TAURITAVERN__?.api?.extension?.store;
  if (host.__TAURITAVERN__ && !store) throw new Error('当前 TT 没有扩展存储，原有配置未改动。');
  const extension = context.extensionSettings;
  const saved = store ? await store.tryGetJson(storageEntry) : {
    found: Object.hasOwn(extension, managerNamespace), value: extension[managerNamespace],
  };
  if (saved.found && (saved.value?.version !== 1 || !isObject(saved.value.values))) throw formatError();
  let values = saved.found ? { ...saved.value.values } : {};
  if (!saved.found) {
    for (const key of legacyStorageKeys) {
      const value = browserStorage.getItem(key);
      if (value !== null) values[key] = value;
    }
  }
  let state = {
    catalog: emptyCatalog(),
    sync: { revision: null, pending: false },
  };
  let pendingWrite = Promise.resolve();
  const persist = async next => {
    const nextValues = { ...values, [catalogKey]: JSON.stringify(next) };
    const value = { version: 1, values: nextValues };
    if (store) {
      try { await store.setJson({ ...storageEntry, value }); }
      catch { throw new Error('TT 配置保存失败，请重试。'); }
    }
    else {
      const previous = extension[managerNamespace];
      extension[managerNamespace] = value;
      try { context.saveSettingsDebounced(); }
      catch {
        if (previous === undefined) delete extension[managerNamespace];
        else extension[managerNamespace] = previous;
        throw new Error('ST 配置保存失败，请重试。');
      }
    }
    values = nextValues;
    state = next;
  };
  const transact = fn => {
    pendingWrite = pendingWrite.catch(() => {}).then(fn);
    return pendingWrite;
  };

  if (Object.hasOwn(values, catalogKey)) {
    const parsed = JSON.parse(values[catalogKey]);
    if (!isObject(parsed?.sync) || (parsed.sync.revision !== null && !isText(parsed.sync.revision))
        || typeof parsed.sync.pending !== 'boolean') throw formatError();
    state = { catalog: validateCatalog(parsed.catalog), sync: parsed.sync };
  } else if (Object.keys(values).length) {
    const oldConfigs = JSON.parse(values.api_configs_manager ?? '[]');
    const oldGroups = JSON.parse(values.api_configs_categories ?? '[]');
    const catalog = migrateCatalog(oldConfigs, oldGroups);
    await persist({ catalog, sync: { revision: null, pending: true } });
  }

  const account = context.accountStorage;
  const canSync = typeof account?.getItem === 'function' && typeof account?.setItem === 'function';
  async function remote() {
    let current, raw;
    try {
      current = await account.getItem(accountKey);
      raw = current ?? await account.getItem(legacyAccountKey);
    } catch { throw new Error('读取酒馆账户存储失败。'); }
    if (raw == null) return null;
    let value;
    try { value = JSON.parse(raw); } catch { throw formatError(); }
    if (!isText(value?.revision) || !value.revision) throw formatError();
    if (current != null) return { revision: value.revision, catalog: validateCatalog(value.catalog), legacy: false };
    if (value.version !== 1 || !Array.isArray(value.configs) || !Array.isArray(value.categories)) throw formatError();
    return { revision: 'legacy:' + value.revision, catalog: migrateCatalog(value.configs, value.categories), legacy: true };
  }
  return {
    get catalog() { return state.catalog; },
    canSync,
    flush: () => pendingWrite,
    update: change => transact(async () => {
      const catalog = validateCatalog(change(state.catalog));
      await persist({ catalog, sync: { ...state.sync, pending: true } });
    }),
    pull: () => transact(async () => {
      if (!canSync) throw new Error('当前酒馆不支持账户存储。');
      const incoming = await remote();
      if (!incoming) return '账户还没有同步数据。';
      if (incoming.revision === state.sync.revision) return '已读取此账户版本。';
      // If both copies have work, keep both. A clean client can adopt a later
      // published snapshot, including intentional removals from another client.
      const combine = state.sync.pending || state.sync.revision === null || incoming.legacy;
      const catalog = combine ? mergeCatalogs(state.catalog, incoming.catalog, incoming.legacy) : incoming.catalog;
      const pending = canonical(catalog) !== canonical(incoming.catalog) || incoming.legacy;
      await persist({ catalog, sync: { revision: incoming.revision, pending } });
      return pending ? '已合并账户与本机配置；可将合并后的版本同步到账户。' : '已从账户读取配置。';
    }),
    push: () => transact(async () => {
      if (!canSync) throw new Error('当前酒馆不支持账户存储。');
      const incoming = await remote();
      if ((incoming?.revision ?? null) !== state.sync.revision) {
        throw new Error('账户上有尚未读取的数据。请先点「从账户读取」，再上传合并后的配置。');
      }
      const revision = makeId();
      try { await account.setItem(accountKey, JSON.stringify({ revision, catalog: state.catalog })); }
      catch { throw new Error('写入酒馆账户存储失败。'); }
      await persist({ catalog: state.catalog, sync: { revision, pending: false } });
      return '已写入酒馆账户存储。';
    }),
  };
}

export { openCatalogStorage };
