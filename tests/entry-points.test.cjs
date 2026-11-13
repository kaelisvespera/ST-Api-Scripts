const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const plain = value => JSON.parse(JSON.stringify(value));
async function sourceApi(extra = {}) {
  const source = ['catalog.js', 'storage.js', 'entry-points.js', 'bootstrap.js']
    .map(file => fs.readFileSync(path.join(root, 'src', file), 'utf8')).join('\n')
    + '\nexport { mountCatalogEntries, startCatalogManager };';
  const module = new vm.SourceTextModule(source, { context: vm.createContext({
    crypto: webcrypto, ...extra,
  }) });
  await module.link(() => { throw new Error('Unexpected import'); });
  await module.evaluate();
  return module.namespace;
}
function harness(mode) {
  const host = new EventTarget();
  host.Event = Event;
  let saved, fail = false, writes = 0;
  const context = {
    extensionSettings: {},
    saveSettingsDebounced() { if (fail) throw Error('blocked'); writes++; },
  };
  if (mode === 'tt') host.__TAURITAVERN__ = { api: { extension: { store: {
    async tryGetJson() { return { found: !!saved, value: saved }; },
    async setJson({ value }) { if (fail) throw Error('blocked'); saved = plain(value); writes++; },
  } } } };
  return { host, context, browser: { getItem: () => null }, setFail(value) { fail = value; },
    state: () => mode === 'tt' ? saved : context.extensionSettings['st-api-manager'],
    writes: () => writes };
}
for (const mode of ['st', 'tt']) test(mode + ' device entry choices preserve collapse state, catalog and sync; failed writes restore choice', async () => {
  const api = await sourceApi(), h = harness(mode);
  const storage = await api.openCatalogStorage(h.host, h.context, h.browser);
  assert.deepEqual(plain(storage.entryPoints), { wand: true, qr: false });
  const catalog = storage.catalog, sync = plain(storage.syncInfo);
  await storage.setGroupCollapsed('g1', true);
  await storage.setEntryPoints({ wand: false, qr: true });
  await storage.setQrSetName('API Manager - fixture');
  await storage.setGroupCollapsed(null, true);
  assert.deepEqual(plain(storage.entryPoints), { wand: false, qr: true });
  assert.deepEqual(plain(storage.collapsedGroups), ['g1', null]);
  assert.equal(storage.catalog, catalog);
  assert.deepEqual(plain(storage.syncInfo), sync);
  const reopened = await api.openCatalogStorage(h.host, h.context, h.browser);
  assert.deepEqual(plain(reopened.entryPoints), { wand: false, qr: true });
  assert.equal(reopened.qrSetName, 'API Manager - fixture');
  h.setFail(true);
  await assert.rejects(storage.setEntryPoints({ wand: true, qr: true }), /保存失败/);
  assert.deepEqual(plain(storage.entryPoints), { wand: false, qr: true });
  h.setFail(false);
  await assert.rejects(storage.setEntryPoints({ wand: false, qr: false }), /至少/);
  await storage.setEntryPoints({ wand: true, qr: true });
  assert.deepEqual(plain(storage.collapsedGroups), ['g1', null]);
});
function fakeDoc() {
  const nodes = [];
  function element() {
    const node = new EventTarget();
    Object.assign(node, { dataset: {}, children: [], setAttribute() {},
      append(...children) { for (const child of children) { child.parentElement = this; this.children.push(child); } },
      remove() { this.removed = true; },
    });
    nodes.push(node);
    return node;
  }
  const menu = element(); menu.id = 'extensionsMenu';
  return { createElement: element, getElementById: id => nodes.find(n => n.id === id && !n.removed && !n.parentElement?.removed) };
}
function qrApi() {
  const sets = new Map(), calls = [];
  const config = { setList: [] };
  return {
    sets, calls, settings: { config, isEnabled: true }, getSetByName: name => sets.get(name),
    async createSet(name, props) {
      assert.ok(!sets.has(name), 'must not overwrite existing sets');
      calls.push('create');
      const set = { ...props, name, qrList: [], dom: { isConnected: false }, async save() {} };
      sets.set(name, set); return set;
    },
    createQuickReply(name, label, props) { sets.get(name).qrList.push({ label, ...props }); },
    addGlobalSet(name, isVisible) { const set = sets.get(name); config.setList.push({ set, isVisible }); set.dom.isConnected = true; },
    removeGlobalSet(name) { config.setList = config.setList.filter(link => link.set.name !== name); sets.get(name).dom.isConnected = false; },
    listGlobalSets() { return config.setList.map(link => link.set.name); },
  };
}
test('real QR contract: default, delayed API, QR only, both, disable, host disabled, collision and failures', async () => {
  const api = await sourceApi(), h = harness('st');
  h.host.document = fakeDoc();
  h.host.setInterval = callback => { h.tick = callback; };
  const storage = await api.openCatalogStorage(h.host, h.context, h.browser);
  const refresh = api.mountCatalogEntries(h.host, storage, () => {}, true);
  await refresh();
  assert.ok(h.host.document.getElementById('st-api-manager-extension-button'));
  await storage.setEntryPoints({ wand: false, qr: true });
  await refresh();
  assert.equal(storage.entryPointStatus.qrReady, false);
  h.host.quickReplyApi = qrApi();
  await refresh();
  assert.equal(storage.entryPointStatus.qrReady, true);
  assert.equal(h.host.document.getElementById('st-api-manager-extension-button'), undefined);
  assert.equal(h.host.quickReplyApi.calls.length, 1);
  await refresh(); await refresh();
  assert.equal(h.host.quickReplyApi.calls.length, 1);
  const name = storage.qrSetName;
  assert.equal(h.host.quickReplyApi.getSetByName(name).qrList[0].message, '/st-api-manager');
  await storage.setEntryPoints({ wand: true, qr: true }); await refresh();
  assert.ok(h.host.document.getElementById('st-api-manager-extension-button'));
  await storage.setEntryPoints({ wand: true, qr: false }); await refresh();
  assert.equal(h.host.quickReplyApi.listGlobalSets().length, 0);
  assert.ok(h.host.quickReplyApi.getSetByName(name), 'disable retains own set, does not delete data');
  await storage.setEntryPoints({ wand: false, qr: true }); await refresh();
  h.host.quickReplyApi.settings.isEnabled = false; await refresh();
  assert.equal(storage.entryPointStatus.qrReady, false);
  assert.ok(h.host.document.getElementById('st-api-manager-extension-button'));
  h.host.quickReplyApi.getSetByName(name).qrList[0].message = 'user changed this';
  await refresh();
  assert.match(storage.entryPointStatus.message, /修改/);
  await storage.setEntryPoints({ wand: true, qr: false }); await refresh();
  assert.ok(h.host.quickReplyApi.listGlobalSets().includes(name), 'never change a set modified by user');
});
test('failed QR creation keeps a reachable menu; preference retry and missing slash stay safe', async () => {
  const api = await sourceApi(), h = harness('st');
  h.host.document = fakeDoc(); h.host.setInterval = () => {};
  const storage = await api.openCatalogStorage(h.host, h.context, h.browser);
  h.host.quickReplyApi = qrApi();
  const create = h.host.quickReplyApi.createSet;
  h.host.quickReplyApi.createSet = async () => { throw Error('offline'); };
  await storage.setEntryPoints({ wand: false, qr: true });
  const refresh = api.mountCatalogEntries(h.host, storage, () => {}, true);
  await refresh();
  assert.match(storage.entryPointStatus.message, /未能/);
  assert.ok(h.host.document.getElementById('st-api-manager-extension-button'));
  h.host.quickReplyApi.createSet = create;
  await storage.setEntryPoints({ wand: false, qr: true }); await refresh();
  assert.equal(storage.entryPointStatus.qrReady, true);
});
test('concurrent initialization shares storage, panel, callbacks and timer across bundles', async () => {
  let mounts = 0, registrations = 0, timers = 0;
  const api = await sourceApi({ createCatalogConnection: () => ({}), mountCatalogPanel: () => { mounts++; return () => {}; } });
  const h = harness('st');
  h.host.document = fakeDoc(); h.host.document.readyState = 'complete';
  h.host.setInterval = () => timers++;
  h.context.registerSlashCommand = () => registrations++;
  h.host.SillyTavern = { getContext: () => h.context };
  const [a, b] = await Promise.all([api.startCatalogManager(h.host, h.browser), api.startCatalogManager(h.host, h.browser)]);
  assert.equal(a, b); assert.equal(mounts, 1); assert.equal(registrations, 1); assert.equal(timers, 1);
});
test('partial initial save and reply creation failures retry only the newly created set identity', async () => {
  for (const failure of ['createSet', 'createQuickReply', 'save']) {
    const api = await sourceApi(), h = harness('st');
    h.host.document = fakeDoc(); h.host.setInterval = () => {};
    const storage = await api.openCatalogStorage(h.host, h.context, h.browser);
    const qr = h.host.quickReplyApi = qrApi();
    const createSet = qr.createSet, createReply = qr.createQuickReply;
    let fail = true;
    qr.createSet = async (...args) => {
      const set = await createSet(...args);
      if (failure === 'save') set.save = async () => { if (fail) throw Error('save failed'); };
      if (failure === 'createSet' && fail) throw Error('initial save failed');
      return set;
    };
    qr.createQuickReply = (...args) => {
      if (failure === 'createQuickReply' && fail) throw Error('reply failed');
      return createReply(...args);
    };
    await storage.setEntryPoints({ wand: false, qr: true });
    const refresh = api.mountCatalogEntries(h.host, storage, () => {}, true);
    await refresh();
    assert.equal(storage.entryPointStatus.qrReady, false, failure);
    fail = false;
    await storage.setEntryPoints({ wand: true, qr: false }); await refresh();
    await storage.setEntryPoints({ wand: false, qr: true }); await refresh();
    assert.equal(storage.entryPointStatus.qrReady, true, failure);
    assert.equal(qr.calls.length, 1, 'no duplicate or replacement set');
  }
});
test('missing slash registration never enables QR or hides fallback', async () => {
  const api = await sourceApi(), h = harness('st');
  h.host.document = fakeDoc(); h.host.setInterval = () => {};
  const storage = await api.openCatalogStorage(h.host, h.context, h.browser);
  h.host.quickReplyApi = qrApi();
  await storage.setEntryPoints({ wand: false, qr: true });
  await api.mountCatalogEntries(h.host, storage, () => {}, false)();
  assert.equal(h.host.quickReplyApi.calls.length, 0);
  assert.ok(h.host.document.getElementById('st-api-manager-extension-button'));
});
test('a user-edited partial QR set is not resumed or activated', async () => {
  for (const flag of ['disableSend', 'injectInput', 'placeBeforeInput']) {
    const api = await sourceApi(), h = harness('st');
    h.host.document = fakeDoc(); h.host.setInterval = () => {};
    const storage = await api.openCatalogStorage(h.host, h.context, h.browser);
    const qr = h.host.quickReplyApi = qrApi();
    const create = qr.createQuickReply;
    qr.createQuickReply = () => { throw Error('failed'); };
    await storage.setEntryPoints({ wand: false, qr: true });
    const refresh = api.mountCatalogEntries(h.host, storage, () => {}, true);
    await refresh();
    const set = qr.getSetByName(storage.qrSetName);
    set[flag] = true; qr.createQuickReply = create;
    await storage.setEntryPoints({ wand: true, qr: false }); await refresh();
    await storage.setEntryPoints({ wand: false, qr: true }); await refresh();
    assert.equal(set.qrList.length, 0, flag);
    assert.equal(storage.entryPointStatus.qrReady, false, flag);
    assert.equal(qr.listGlobalSets().length, 0, flag);
    assert.ok(h.host.document.getElementById('st-api-manager-extension-button'));
  }
});
test('a user edit during the pending final QR save prevents activation', async () => {
  const api = await sourceApi(), h = harness('st');
  h.host.document = fakeDoc(); h.host.setInterval = () => {};
  const storage = await api.openCatalogStorage(h.host, h.context, h.browser);
  const qr = h.host.quickReplyApi = qrApi(), create = qr.createSet;
  let release, arrived;
  const started = new Promise(resolve => { arrived = resolve; });
  qr.createSet = async (...args) => {
    const set = await create(...args);
    set.save = () => { arrived(set); return new Promise(resolve => { release = resolve; }); };
    return set;
  };
  await storage.setEntryPoints({ wand: false, qr: true });
  const refresh = api.mountCatalogEntries(h.host, storage, () => {}, true);
  const set = await started;
  set.qrList[0].message = 'user edited';
  release(); await refresh();
  assert.equal(storage.entryPointStatus.qrReady, false);
  assert.equal(qr.listGlobalSets().length, 0);
});
test('replacement during the initial QR save is never mutated by name', async () => {
  const api = await sourceApi(), h = harness('st');
  h.host.document = fakeDoc(); h.host.setInterval = () => {};
  const storage = await api.openCatalogStorage(h.host, h.context, h.browser);
  const qr = h.host.quickReplyApi = qrApi(), create = qr.createSet;
  let release, arrived;
  const started = new Promise(resolve => { arrived = resolve; });
  qr.createSet = async (...args) => {
    const set = await create(...args);
    arrived(set);
    await new Promise(resolve => { release = resolve; });
    return set;
  };
  await storage.setEntryPoints({ wand: false, qr: true });
  const refresh = api.mountCatalogEntries(h.host, storage, () => {}, true);
  const original = await started;
  const foreign = { name: original.name, qrList: [{ label: 'User reply', message: 'user content' }] };
  qr.sets.set(original.name, foreign);
  release(); await refresh();
  assert.deepEqual(foreign.qrList, [{ label: 'User reply', message: 'user content' }]);
  assert.equal(original.qrList.length, 0);
  assert.equal(qr.listGlobalSets().length, 0);
  assert.equal(storage.entryPointStatus.qrReady, false);
  assert.ok(h.host.document.getElementById('st-api-manager-extension-button'));
});
test('name claimed during preference save is not passed to replacement-prone createSet', async () => {
  const api = await sourceApi(), h = harness('st');
  h.host.document = fakeDoc(); h.host.setInterval = () => {};
  const storage = await api.openCatalogStorage(h.host, h.context, h.browser);
  const qr = h.host.quickReplyApi = qrApi(), saveName = storage.setQrSetName;
  storage.setQrSetName = async name => {
    await saveName(name);
    qr.sets.set(name, { name, qrList: [{ label: 'User reply', message: 'user content' }] });
  };
  await storage.setEntryPoints({ wand: false, qr: true });
  const refresh = api.mountCatalogEntries(h.host, storage, () => {}, true);
  await refresh();
  assert.equal(qr.calls.length, 0);
  assert.equal(qr.getSetByName(storage.qrSetName).qrList.length, 1);
  assert.equal(storage.entryPointStatus.qrReady, false);
});
