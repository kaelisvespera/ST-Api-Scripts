const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { createHash, webcrypto } = require('node:crypto');
const { url, categories, config, flatConfigs, legacyValues, grouped } = require('./catalog-fixture.cjs');

const plain = value => JSON.parse(JSON.stringify(value));
const root = path.resolve(__dirname, '..');
const namespace = 'st-api-manager';
const accountV1 = 'st_api_manager_sync_v1';
const accountV2 = 'st_api_manager_sync_v2';
const keyV2 = 'st_api_manager_catalog_v2';
let api;
test.before(async () => {
  const source = ['catalog.js', 'storage.js', 'connection.js'].map(file => fs.readFileSync(path.join(root, 'src', file), 'utf8')).join('\n')
    + '\nexport { createCatalogConnection, sendCatalogTest };';
  const context = vm.createContext({ crypto: webcrypto, TextEncoder, URL, AbortSignal });
  const module = new vm.SourceTextModule(source, { context });
  await module.link(() => { throw new Error('Unexpected import'); });
  await module.evaluate();
  api = module.namespace;
});

const modelKeys = catalog => Array.from(catalog.entries, row => [row.model, row.key]);
function harness(mode, { state, legacy = {}, account = new Map() } = {}) {
  let saved = state;
  let writes = 0;
  const fixture = { failRead: false, failWrite: false };
  const context = {
    extensionSettings: state ? { [namespace]: state, sibling: { enabled: true } } : { sibling: { enabled: true } },
    saveSettingsDebounced() { if (fixture.failWrite) throw Error('write blocked'); writes++; },
    accountStorage: { getItem: key => account.get(key) ?? null, setItem: (key, value) => account.set(key, value) },
    get chatCompletionSettings() { throw Error('Must not inspect host settings'); },
    get eventSource() { throw Error('Must not attach to chat events'); },
  };
  const host = mode === 'tt' ? { __TAURITAVERN__: { api: { extension: { store: {
    async tryGetJson(entry) {
      assert.deepEqual(plain(entry), { namespace, key: 'state' });
      if (fixture.failRead) throw Error('read blocked');
      return { found: saved !== undefined, value: saved };
    },
    async setJson({ namespace: ns, key, value }) {
      assert.equal(ns, namespace);
      assert.equal(key, 'state');
      if (fixture.failWrite) throw Error('write blocked');
      writes++;
      saved = plain(value);
    },
  } } } } } : {};
  return Object.assign(fixture, {
    getWrites: () => writes,
    getState: () => mode === 'tt' ? saved : context.extensionSettings[namespace],
    open: () => api.openCatalogStorage(host, context, { getItem: key => legacy[key] ?? null }),
    context, account,
  });
}

test('migrates grouped stores into individual model/key entries without losing history', () => {
  const catalog = api.migrateCatalog(grouped, categories);
  assert.deepEqual(modelKeys(catalog), [
    ['same-model', 'fixture-key-a'], ['same-model', 'fixture-key-b'],
    ['second-model', 'fixture-key-a'], ['second-model', 'fixture-key-b'],
  ]);
  assert.equal(new Set(catalog.entries.map(row => row.id)).size, 4);
  assert.equal(catalog.entries[1].history.keyHistory.successCount, 8);
  assert.equal(catalog.entries[1].history.currentKeyIndex, 1);
  assert.deepEqual(plain(catalog.entries.map(row => row.groupIds)), [['group-a'], ['group-a'], ['group-b'], ['group-b']]);
  assert.deepEqual(plain(catalog.groups), categories);
  assert.ok(catalog.entries[0].rotationPoolId);
  assert.equal(new Set(catalog.entries.map(row => row.rotationPoolId)).size, 1, 'old models share the ordered pool');
});

test('legacy import restores a missing credential to its existing pool without absorbing independent keys', () => {
  const local = api.migrateCatalog(grouped, categories);
  const dropped = { ...local, entries: local.entries.filter((_, index) => index !== 1) };
  const other = api.migrateCatalog([config('fixture-independent')], categories);
  const withIndependent = api.mergeCatalogs(dropped, other);
  const restored = api.mergeCatalogs(withIndependent, api.migrateCatalog(grouped, categories), true);
  const restoredKey = restored.entries.find(row => row.key === 'fixture-key-b' && row.model === 'same-model');
  assert.equal(restoredKey.rotationPoolId, local.entries[0].rotationPoolId);
  assert.equal(restored.entries.find(row => row.key === 'fixture-independent').rotationPoolId, undefined);
  assert.deepEqual(plain(api.mergeCatalogs(restored, api.migrateCatalog(grouped, categories), true)), plain(restored));
});

test('old flat and export formats preserve same URL/model with different keys and group memberships', () => {
  const first = config('fixture-key-a', '第一组');
  const second = { ...config('fixture-key-b', 'group-b'), apiKeys: [], apiKey: 'fixture-key-b' };
  const { catalog, legacy } = api.readCatalog({ version: '1.0', configs: [first, second], categories });
  assert.equal(legacy, true);
  assert.deepEqual(modelKeys(catalog), [['same-model', 'fixture-key-a'], ['same-model', 'fixture-key-b']]);
  assert.equal(catalog.entries[0].groupIds[0], 'group-a');
  assert.equal(catalog.entries[1].groupIds[0], 'group-b');
  const exported = api.readCatalog(plain(catalog));
  assert.equal(exported.legacy, false);
  assert.deepEqual(plain(exported.catalog), plain(catalog));
});

test('unassigned and empty-model entries survive, as do repeated historical rows', () => {
  const repeated = { ...config('fixture-key-a', 'orphan-label'), customModel: '' };
  const left = api.migrateCatalog([repeated, repeated]);
  const right = api.migrateCatalog([repeated, repeated]);
  assert.equal(left.entries[0].model, '');
  assert.equal(left.groups[0].name, 'orphan-label');
  assert.equal(api.mergeCatalogs(left, right, true).entries.length, 2);
  assert.notEqual(left.entries[0].id, left.entries[1].id);
});

test('importing conflicting IDs keeps both credentials and repeats do not create extra copies', () => {
  const original = api.migrateCatalog([flatConfigs[0]], categories);
  const changed = plain(original);
  changed.entries[0].key = 'fixture-replacement';
  changed.groups[0].name = '重新命名的分组';
  const merged = api.mergeCatalogs(original, changed);
  assert.deepEqual(modelKeys(merged), [['same-model', 'fixture-key-a'], ['same-model', 'fixture-replacement']]);
  assert.notEqual(merged.entries[0].groupIds[0], merged.entries[1].groupIds[0]);
  assert.equal(api.mergeCatalogs(merged, changed).entries.length, 2);
  assert.equal(api.mergeCatalogs(merged, changed).groups.length, 3);

  // A conflicting row cannot consume a matching row that also has its own
  // identity in the same import.
  const distinct = plain(original);
  distinct.entries.push({ ...distinct.entries[0], id: 'separate', key: 'fixture-replacement' });
  const update = plain(distinct);
  update.entries[0].key = 'fixture-replacement';
  const kept = api.mergeCatalogs(distinct, update);
  assert.equal(kept.entries.length, 3);
  assert.equal(kept.entries.filter(row => row.key === 'fixture-replacement').length, 2);
  assert.equal(api.mergeCatalogs(kept, update).entries.length, 3);
});

function subsetConflict(withGroups = true) {
  const groups = withGroups ? [{ id: 'A', name: '原分组' }, { id: 'B', name: '同名分组' }] : [];
  const row = (id, key) => ({
    id, site: 'fixture-site', name: '', source: 'custom', url, model: 'same-model', key,
    groupIds: withGroups ? [id] : [],
  });
  const local = {
    ...api.emptyCatalog(), groups,
    entries: [row('A', 'fixture-key-x'), row('B', 'fixture-key-y')],
  };
  const incoming = {
    ...local,
    groups: withGroups ? [{ ...groups[1], id: 'A' }] : [],
    entries: [row('A', 'fixture-key-y')],
  };
  return { local, incoming };
}

test('a subset import keeps the conflicting version separate from an identical independent entry', () => {
  const { local, incoming } = subsetConflict(false);
  const merged = api.mergeCatalogs(local, incoming);
  assert.deepEqual(plain(merged.entries.slice(0, 2)), local.entries);
  assert.deepEqual(modelKeys(merged), [
    ['same-model', 'fixture-key-x'], ['same-model', 'fixture-key-y'], ['same-model', 'fixture-key-y'],
  ]);
  assert.equal(new Set(merged.entries.map(row => row.id)).size, 3);
  assert.deepEqual(plain(api.mergeCatalogs(merged, incoming)), plain(merged));
});

test('a subset import retains the conflicting group and its membership across export and reimport', () => {
  const { local, incoming } = subsetConflict();
  const merged = api.mergeCatalogs(local, incoming);
  assert.deepEqual(plain(merged.groups.slice(0, 2)), local.groups);
  assert.equal(merged.groups.length, 3);
  const groupCopy = merged.groups[2];
  assert.equal(groupCopy.name, '同名分组');
  assert.notEqual(groupCopy.id, 'B');
  assert.equal(merged.entries[1].groupIds[0], 'B');
  assert.equal(merged.entries[2].groupIds[0], groupCopy.id);
  const { catalog: exported } = api.readCatalog(plain(merged));
  assert.deepEqual(plain(api.mergeCatalogs(local, exported)), plain(merged));
  assert.deepEqual(plain(api.mergeCatalogs(exported, incoming)), plain(merged));
});

for (const mode of ['st', 'tt']) {
  test(mode + ' resumes a verified legacy active pool in its original order on generation', async () => {
    const catalog = api.migrateCatalog(grouped, categories);
    // A deleted credential reimported from a legacy file ends up at the end
    // of the catalog, but its original key index is still zero.
    catalog.entries = [...catalog.entries.slice(1), catalog.entries[0]];
    const modelRows = catalog.entries.filter(row => row.model === 'same-model');
    const pool = modelRows.map(row => ({
      id: 'native-' + row.history.index, active: row.history.index === 0,
      digest: createHash('sha256').update('api_key_custom\0' + row.key).digest('hex'),
    }));
    const calls = [];
    let listener;
    let state = {};
    const host = {
      document: {}, crypto: webcrypto,
      ...(mode === 'tt' ? { __TAURITAVERN__: {} } : {}),
      async fetch(path) {
        calls.push(path);
        return Response.json({ api_key_custom: pool.map(({ id, active }) => ({ id, active, value: 'masked' })) });
      },
    };
    const context = { eventTypes: { CHAT_COMPLETION_SETTINGS_READY: 'ready' },
      eventSource: { makeFirst(name, callback) { assert.equal(name, 'ready'); listener = callback; } } };
    const store = {
      catalog,
      legacyBindings: Object.fromEntries(pool.map(({ digest, id }) => [digest, id])),
      get connectionState() { return state; },
      async setConnectionState(connection) { state = plain(connection); },
    };
    const manager = api.createCatalogConnection(host, context, store);
    assert.deepEqual(calls, []);
    await assert.rejects(manager.apply({ ...modelRows[0], model: '' }), /没有模型/);
    assert.deepEqual(calls, []);
    const payload = { chat_completion_source: 'custom', custom_url: url, model: 'same-model', secret_id: 'untouched' };
    await listener({ ...payload, model: 'different-model' });
    assert.deepEqual(calls, []);
    await listener(payload);
    assert.equal(payload.secret_id, 'native-1', 'old cursor 1 selects the second credential despite catalog order');
    assert.ok(calls.every(path => path === '/api/secrets/read'));
    assert.equal(pool.find(entry => entry.active).id, 'native-0');
    api.createCatalogConnection(host, context, store);
    await listener(payload);
    assert.equal(payload.secret_id, 'native-0', 'cursor survives restart');
  });

  test(mode + ' recovers an intact legacy pool and keeps it through an older account snapshot', async () => {
    const original = api.migrateCatalog(grouped, categories);
    const oldCatalog = {
      ...plain(original), entries: plain(original.entries).map(({ rotationPoolId, ...row }) => row),
    };
    const values = {
      api_configs_manager: JSON.stringify(grouped), api_configs_categories: JSON.stringify(categories),
      [keyV2]: JSON.stringify({ catalog: oldCatalog, sync: { pending: false, revision: 'previous' } }),
    };
    const account = new Map([[accountV2, JSON.stringify({ catalog: oldCatalog, revision: 'remote-old' })]]);
    const fixture = harness(mode, { account, state: { version: 1, values } });
    const storage = await fixture.open();
    const before = plain(storage.catalog);
    assert.ok(before.entries[0].rotationPoolId);
    assert.equal(new Set(before.entries.map(row => row.rotationPoolId)).size, 1);
    await storage.pull();
    assert.deepEqual(plain(storage.catalog), before);
    await storage.push();
    assert.deepEqual(JSON.parse(account.get(accountV2)).catalog, before);
    account.set(accountV2, JSON.stringify({ catalog: oldCatalog, revision: 'republished-by-old-client' }));
    await storage.pull();
    assert.deepEqual(plain(storage.catalog), before, 'a clean client retains unchanged rows’ verified pool metadata');
    assert.deepEqual(plain((await fixture.open()).catalog), before);
  });

  test(mode + ' retains subset conflict IDs and memberships across pull, upload and restart', async () => {
    const { local, incoming } = subsetConflict();
    const setRemote = (account, revision) => account.set(accountV2, JSON.stringify({ revision, catalog: incoming }));
    const account = new Map();
    setRemote(account, 'initial-subset');
    const fixture = harness(mode, { account });
    let storage = await fixture.open();
    await storage.update(() => local);
    await (await storage.pull()).resolve('merge');
    const merged = plain(storage.catalog);
    assert.equal(merged.entries.length, 3);
    assert.equal(merged.groups.length, 3);
    assert.equal(merged.entries[2].groupIds[0], merged.groups[2].id);
    assert.deepEqual(merged.entries.slice(0, 2), local.entries);

    storage = await fixture.open();
    await storage.pull();
    assert.deepEqual(plain(storage.catalog), merged);
    setRemote(account, 'republished-subset');
    await (await storage.pull()).resolve('merge');
    assert.deepEqual(plain(storage.catalog), merged);
    assert.deepEqual(JSON.parse(account.get(accountV2)).catalog, merged);

    const peer = await harness(mode === 'st' ? 'tt' : 'st', { account }).open();
    await peer.pull();
    assert.deepEqual(plain(peer.catalog), merged);
    await peer.push();
    await storage.pull();
    assert.deepEqual(plain(storage.catalog), merged);
  });

  test(mode + ' only replaces the chosen side and rejects a stale conflict choice', async () => {
    const { local, incoming } = subsetConflict();
    const account = new Map([[accountV2, JSON.stringify({ catalog: incoming, revision: 'remote-1' })]]);
    const fixture = harness(mode, { account });
    const storage = await fixture.open();
    await storage.update(() => local);
    const localBefore = plain(fixture.getState());
    const remoteBefore = account.get(accountV2);
    const cancelled = await storage.pull();
    assert.equal(typeof cancelled.resolve, 'function');
    assert.deepEqual(plain(fixture.getState()), localBefore);
    assert.equal(account.get(accountV2), remoteBefore);
    const remoteNewer = JSON.stringify({ catalog: incoming, revision: 'remote-2' });
    account.set(accountV2, remoteNewer);
    await assert.rejects(cancelled.resolve('local'), /重新同步/);
    await assert.rejects(cancelled.resolve('merge'), /重新同步/);
    assert.deepEqual(plain(fixture.getState()), localBefore);
    assert.equal(account.get(accountV2), remoteNewer);
    await (await storage.pull()).resolve('account');
    assert.deepEqual(plain(storage.catalog), incoming);
    assert.equal(account.get(accountV2), remoteNewer);
    await storage.update(() => local);
    const unchangedRevision = await storage.pull();
    assert.equal(typeof unchangedRevision.resolve, 'function', 'pull still offers the account version after local edits');
    assert.equal(account.get(accountV2), remoteNewer);
    account.set(accountV2, JSON.stringify({ catalog: incoming, revision: 'remote-3' }));
    await (await storage.push()).resolve('local');
    assert.deepEqual(plain(storage.catalog), local);
    assert.deepEqual(JSON.parse(account.get(accountV2)).catalog, local);
    assert.equal(await storage.pull(), '已读取此账户版本。');
  });

  test(mode + ' migrates once, saves edits by ID, and restarts with both credentials', async () => {
    const browserLegacy = { ...legacyValues, api_configs_manager: '[]' };
    const fixture = harness(mode, { state: { version: 1, values: legacyValues }, legacy: browserLegacy });
    const storage = await fixture.open();
    const [first, second] = storage.catalog.entries;
    assert.equal(fixture.getWrites(), 1);
    await storage.update(catalog => ({
      ...catalog, entries: catalog.entries.map(row => row.id === first.id ? { ...row, key: 'fixture-edited', groupIds: ['group-b'] } : row),
    }));
    const reopened = await fixture.open();
    assert.deepEqual(modelKeys(reopened.catalog), [['same-model', 'fixture-edited'], ['same-model', 'fixture-key-b']]);
    assert.equal(reopened.catalog.entries[0].id, first.id);
    assert.deepEqual(plain(reopened.catalog.entries[1]), plain(second));
    assert.equal(reopened.catalog.entries[0].groupIds[0], 'group-b');
    const { [keyV2]: v2, ...untouched } = fixture.getState().values;
    assert.ok(v2);
    assert.deepEqual(untouched, legacyValues);
    assert.equal(browserLegacy.api_configs_manager, '[]');
    assert.equal(fixture.getWrites(), 2);
  });

  test(mode + ' uses browser data only when absent and failed writes do not replace the live catalog', async () => {
    const fixture = harness(mode, { legacy: legacyValues });
    const storage = await fixture.open();
    const before = plain(fixture.getState());
    fixture.failWrite = true;
    await assert.rejects(storage.update(() => api.emptyCatalog()), /保存失败/);
    assert.deepEqual(plain(fixture.getState()), before);
    assert.equal(storage.catalog.entries.length, 2);
    fixture.failWrite = false;
    await storage.update(catalog => ({ ...catalog, entries: catalog.entries.slice(1) }));
    assert.deepEqual(modelKeys((await fixture.open()).catalog), [['same-model', 'fixture-key-b']]);
  });

  test(mode + ' rejects corrupt saved or imported data without replacing it', async () => {
    const corrupt = { version: 1, values: { api_configs_manager: '{"unexpected":true}' } };
    const fixture = harness(mode, { state: corrupt });
    await assert.rejects(fixture.open(), /格式无效/);
    assert.equal(fixture.getWrites(), 0);
    assert.deepEqual(fixture.getState(), corrupt);
    assert.throws(() => api.readCatalog({ configs: [...flatConfigs, {}], categories }), /格式无效/);
  });
}

test('TT storage read error cannot fall back to browser or overwrite saved state', async () => {
  const fixture = harness('tt', { legacy: legacyValues });
  fixture.failRead = true;
  await assert.rejects(fixture.open(), /read blocked/);
  assert.equal(fixture.getWrites(), 0);
});

test('account pull imports old credentials; ST and TT exchange both entries, stable IDs, edits and removals', async () => {
  const legacy = JSON.stringify({ version: 1, revision: 'legacy', configs: [flatConfigs[1]], categories });
  const account = new Map([[accountV1, legacy]]);
  const first = await harness('st', { legacy: { ...legacyValues, api_configs_manager: JSON.stringify([flatConfigs[0]]) }, account }).open();
  await (await first.push()).resolve('merge');
  const ids = Array.from(first.catalog.entries, row => row.id);
  assert.equal(account.get(accountV1), legacy);
  assert.equal(JSON.parse(account.get(accountV2)).catalog.entries.length, 2);
  const second = await harness('tt', { account }).open();
  await second.pull();
  assert.deepEqual(Array.from(second.catalog.entries, row => row.id), ids);
  await second.update(catalog => ({
    ...catalog, entries: catalog.entries.map(row => row.id === ids[0] ? { ...row, model: 'edited-model' } : row),
  }));
  await second.push();
  await (await first.pull()).resolve('account');
  assert.deepEqual(modelKeys(first.catalog), [['edited-model', 'fixture-key-a'], ['same-model', 'fixture-key-b']]);
  assert.deepEqual(Array.from(first.catalog.entries, row => row.id), ids);
  await second.update(catalog => ({ ...catalog, entries: catalog.entries.slice(1) }));
  await second.push();
  await (await first.pull()).resolve('account');
  assert.deepEqual(modelKeys(first.catalog), [['same-model', 'fixture-key-b']]);
});

test('diverged account edits can be merged without silently overwriting either key', async () => {
  const account = new Map();
  const first = await harness('st', { legacy: legacyValues, account }).open();
  const second = await harness('tt', { account }).open();
  await first.push();
  await second.pull();
  for (const [storage, key] of [[first, 'fixture-edit-st'], [second, 'fixture-edit-tt']]) {
    await storage.update(catalog => ({
      ...catalog, entries: [{ ...catalog.entries[0], key }, ...catalog.entries.slice(1)],
    }));
  }
  await first.push();
  await (await second.push()).resolve('merge');
  await (await first.pull()).resolve('account');
  assert.deepEqual(Array.from(first.catalog.entries, row => row.key).sort(), ['fixture-edit-st', 'fixture-edit-tt', 'fixture-key-b']);
});

test('model discovery queries the chosen URL and credential only, and preserves failures', async () => {
  const calls = [];
  const request = async (href, options) => {
    calls.push([href, options]);
    if (options.headers.Authorization === 'Bearer fixture-key-a') return Response.json({ data: [{ id: 'model-for-a' }] });
    if (options.headers.Authorization === 'Bearer fixture-key-b') return Response.json({ data: [{ id: 'model-for-b' }] });
    return new Response('', { status: 401 });
  };
  const first = { source: 'custom', url: url + '/chat/completions', key: 'fixture-key-a', model: 'keep-me' };
  assert.deepEqual(plain(await api.discoverModels(first, request)), ['model-for-a']);
  assert.deepEqual(plain(await api.discoverModels({ ...first, key: 'fixture-key-b' }, request)), ['model-for-b']);
  await assert.rejects(api.discoverModels({ ...first, key: 'wrong-key' }, request), /401/);
  assert.equal(first.model, 'keep-me');
  assert.equal(calls.length, 3);
  for (const [href, opts] of calls) {
    assert.equal(href, url + '/models');
    assert.equal(opts.method, 'GET');
    assert.equal(opts.credentials, 'omit');
    assert.equal(opts.redirect, 'error');
  }
  await assert.rejects(api.discoverModels({ ...first, url: url + '?api_key=wrong' }, request), /密钥参数/);
  assert.equal(calls.length, 3);
});

test('Google model pagination keeps the selected credential and OpenAI/DeepSeek use their own endpoints', async () => {
  const google = 'https://generativelanguage.googleapis.com/v1beta/models';
  const calls = [];
  const request = async (url, { headers }) => {
    calls.push([url, headers]);
    if (url === google) return Response.json({ models: [{ name: 'models/gemini-a' }], nextPageToken: 'page-2' });
    if (url.startsWith(google)) return Response.json({ models: [{ name: 'models/gemini-b' }] });
    return Response.json({ data: [{ id: 'example' }] });
  };
  const key = 'fixture-key';
  assert.deepEqual(plain(await api.discoverModels({ source: 'makersuite', url: '', key }, request)), ['gemini-a', 'gemini-b']);
  await api.discoverModels({ source: 'openai', url: '', key }, request);
  await api.discoverModels({ source: 'deepseek', url: '', key }, request);
  assert.deepEqual(plain(calls), [
    [google, { 'x-goog-api-key': key }], [google + '?pageToken=page-2', { 'x-goog-api-key': key }],
    ['https://api.openai.com/v1/models', { Authorization: 'Bearer ' + key }],
    ['https://api.deepseek.com/v1/models', { Authorization: 'Bearer ' + key }],
  ]);
});

test('test messages use only the selected provider, credential and model without host API calls', async () => {
  const calls = [];
  const request = async (href, options) => {
    calls.push({ href, options, body: JSON.parse(options.body) });
    return href.includes('generateContent') ? Response.json({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] })
      : Response.json({ choices: [{ message: { content: 'ok' } }] });
  };
  for (const [source, endpoint] of [
    ['custom', url + '/models'], ['openai', ''], ['deepseek', ''], ['makersuite', ''],
  ]) {
    assert.equal(await api.sendCatalogTest({ source, url: endpoint, key: 'fixture-' + source, model: 'sample' }, request), 'ok');
  }
  assert.deepEqual(calls.map(call => call.href), [
    url + '/chat/completions', 'https://api.openai.com/v1/chat/completions', 'https://api.deepseek.com/v1/chat/completions',
    'https://generativelanguage.googleapis.com/v1beta/models/sample:generateContent',
  ]);
  assert.deepEqual(calls.slice(0, 3).map(call => call.options.headers.Authorization), [
    'Bearer fixture-custom', 'Bearer fixture-openai', 'Bearer fixture-deepseek',
  ]);
  assert.equal(calls[3].options.headers['x-goog-api-key'], 'fixture-makersuite');
  assert.ok(calls.every(call => call.options.method === 'POST' && call.options.credentials === 'omit' && call.options.redirect === 'error'));
  assert.ok(calls.slice(0, 3).every(call => call.body.model === 'sample'));
  await assert.rejects(api.sendCatalogTest({ source: 'custom', url, key: '', model: 'sample' }, request), /选定密钥和模型/);
  assert.equal(calls.length, 4);
});
