const managerNamespace = 'st-api-manager';
const catalogKey = 'st_api_manager_catalog_v2';
const legacyAccountKey = 'st_api_manager_sync_v1';
const accountKey = 'st_api_manager_sync_v2';
const connectionKey = 'st_api_manager_connection_v2';
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
  const persist = async (next, extra = {}) => {
    const nextValues = { ...values, ...extra, [catalogKey]: JSON.stringify(next) };
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
    if (values.api_configs_manager && !values.st_api_manager_rotation_migrated) {
      let recovered = state.catalog;
      try {
        recovered = recoverLegacyRotation(state.catalog, JSON.parse(values.api_configs_manager), JSON.parse(values.api_configs_categories ?? '[]'));
      } catch { /* The current catalog remains usable if a retired backup is unreadable. */ }
      if (recovered !== state.catalog) {
        await persist({ catalog: recovered, sync: { ...state.sync, pending: true } }, { st_api_manager_rotation_migrated: '1' });
      }
    }
  } else if (Object.keys(values).length) {
    const oldConfigs = JSON.parse(values.api_configs_manager ?? '[]');
    const oldGroups = JSON.parse(values.api_configs_categories ?? '[]');
    const catalog = migrateCatalog(oldConfigs, oldGroups);
    await persist({ catalog, sync: { revision: null, pending: true } });
  }

  function savedObject(key) {
    try {
      const data = JSON.parse(values[key] ?? '{}');
      return isObject(data) ? data : {};
    } catch { return {}; }
  }

  // Historical names are evidence only. Match the exact old record, including
  // its connection fields and credential, before hiding a former group prefix.
  const titleRecord = row => JSON.stringify([row.source, row.url, row.model, row.key, row.name]);
  let legacyTitleSites;
  function legacyTitleSite(row) {
    if (!legacyTitleSites) {
      legacyTitleSites = new Map();
      if (values.api_configs_manager) {
        try {
          const archive = migrateCatalog(JSON.parse(values.api_configs_manager));
          for (const old of archive.entries) {
            const id = titleRecord(old);
            if (!legacyTitleSites.has(id)) legacyTitleSites.set(id, old.site);
            else if (legacyTitleSites.get(id) !== old.site) legacyTitleSites.set(id, null);
          }
        } catch { /* An unreadable retired archive provides no naming evidence. */ }
      }
    }
    return legacyTitleSites.get(titleRecord(row));
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
    if (current != null) return { revision: value.revision, catalog: validateCatalog(value.catalog), legacy: false, raw };
    if (value.version !== 1 || !Array.isArray(value.configs) || !Array.isArray(value.categories)) throw formatError();
    return { revision: 'legacy:' + value.revision, catalog: migrateCatalog(value.configs, value.categories), legacy: true, raw };
  }
  const same = (left, right) => canonical(left) === canonical(right);
  const hasRecords = catalog => catalog.entries.length > 0 || catalog.groups.length > 0;
  async function accept(catalog, revision, pending = false) {
    await persist({ catalog, sync: { revision, pending, syncedAt: new Date().toISOString() } });
  }
  async function upload(catalog) {
    const revision = makeId();
    try { await account.setItem(accountKey, JSON.stringify({ revision, catalog })); }
    catch { throw new Error('写入酒馆账户存储失败。'); }
    await accept(catalog, revision);
  }
  function conflict(incoming) {
    const local = state.catalog;
    const revision = state.sync.revision;
    const colors = [];
    const localNames = new Map();
    const incomingNames = new Map();
    const localById = new Map(local.groups.map(group => [group.id, group]));
    for (const [groups, names] of [[local.groups, localNames], [incoming.catalog.groups, incomingNames]]) {
      for (const group of groups) names.set(group.name, names.has(group.name) ? null : group);
    }
    for (const group of incoming.catalog.groups) {
      const sameId = localById.get(group.id);
      const match = sameId?.name === group.name ? sameId
        : incomingNames.get(group.name) ? localNames.get(group.name) : undefined;
      if (match && match.color !== group.color) colors.push({
        localId: match.id, accountId: group.id, name: group.name, localColor: match.color, accountColor: group.color,
      });
    }
    const count = catalog => ({ entries: catalog.entries.length, groups: catalog.groups.length });
    return {
      local: count(local), account: count(incoming.catalog), colors,
      resolve: (choice, colorChoices = new Map()) => transact(async () => {
        const latest = await remote();
        if (!latest || latest.revision !== incoming.revision || latest.raw !== incoming.raw ||
            state.catalog !== local || state.sync.revision !== revision) {
          throw new Error('选择期间本机或账户数据已变化，请关闭弹窗并重新同步。');
        }
        if (choice === 'account') {
          await accept(incoming.catalog, incoming.revision, incoming.legacy);
          return '已使用账户数据。';
        }
        if (choice === 'local') {
          await upload(local);
          return '已使用本机数据并同步到账户。';
        }
        if (choice !== 'merge') throw new Error('请选择处理方式。');
        const localColors = new Map(), accountColors = new Map();
        for (const color of colors) {
          const selected = colorChoices.get(color.accountId) === 'account' ? color.accountColor : color.localColor;
          localColors.set(color.localId, selected);
          accountColors.set(color.accountId, selected);
        }
        const applyColors = (catalog, choices) => ({
          ...catalog, groups: catalog.groups.map(group => choices.has(group.id) ? { ...group, color: choices.get(group.id) } : group),
        });
        await upload(mergeCatalogs(applyColors(local, localColors), applyColors(incoming.catalog, accountColors), incoming.legacy));
        return '已合并配置并同步到账户。';
      }),
    };
  }
  return {
    get catalog() { return state.catalog; },
    legacyTitleSite,
    get syncInfo() { return { ...state.sync }; },
    get connectionState() { return savedObject(connectionKey); },
    get legacyBindings() { return savedObject('st_api_manager_tt_secret_bindings_v1'); },
    setConnectionState: connection => transact(() => persist(state, { [connectionKey]: JSON.stringify(connection) })),
    canSync,
    flush: () => pendingWrite,
    update: change => transact(async () => {
      const catalog = pruneKeyNotes(validateCatalog(change(state.catalog)));
      await persist({ catalog, sync: { ...state.sync, pending: true } });
    }),
    pull: () => transact(async () => {
      if (!canSync) throw new Error('当前酒馆不支持账户存储。');
      const incoming = await remote();
      if (!incoming) return '账户还没有同步数据。';
      const catalog = preservePoolMetadata(state.catalog, incoming.catalog);
      const identical = same(state.catalog, catalog);
      if (incoming.revision === state.sync.revision && (identical || incoming.legacy)) return '已读取此账户版本。';
      if (!identical && (hasRecords(state.catalog) || (state.sync.pending && state.sync.revision))) {
        return conflict(incoming);
      }
      await accept(catalog, incoming.revision, incoming.legacy || !same(catalog, incoming.catalog));
      return '已从账户读取配置。';
    }),
    push: () => transact(async () => {
      if (!canSync) throw new Error('当前酒馆不支持账户存储。');
      const incoming = await remote();
      if ((incoming?.revision ?? null) !== state.sync.revision) {
        if (!incoming) throw new Error('账户数据已删除或不可用，无法覆盖。');
        if (!same(state.catalog, incoming.catalog)) return conflict(incoming);
      }
      await upload(state.catalog);
      return '已写入酒馆账户存储。';
    }),
  };
}

export { openCatalogStorage };
