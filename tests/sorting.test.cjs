const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');
const { webcrypto } = require('node:crypto');
let api;
const plain = value => JSON.parse(JSON.stringify(value));
const fixture = () => ({ format: 'st-api-manager-catalog', version: 2,
  groups: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }],
  entries: ['one','two','three'].map(id => ({ id, name: '', model: id, key: 'fixture-key', site: 'S', source: 'custom', url: '', groupIds: ['a','b'] })) });
const ids = (catalog, groupId) => Array.from(api.orderedGroupEntries(catalog, groupId), row => row.id);
test.before(async () => {
  const module = new vm.SourceTextModule(['catalog.js','storage.js'].map(file=>fs.readFileSync('src/'+file,'utf8')).join('\n'), { context: vm.createContext({ crypto: webcrypto }) });
  await module.link(() => {}); await module.evaluate(); api = module.namespace;
});
test('old catalogs keep order; per-label moves preserve all records and independent labels', () => {
  const old = fixture(); assert.deepEqual(ids(old, 'a'), ['one','two','three']);
  const moved = api.reorderGroupEntries(old, 'a', ['three','one','two']);
  assert.deepEqual(ids(moved, 'a'), ['three','one','two']); assert.deepEqual(ids(moved, 'b'), ['one','two','three']);
  assert.deepEqual(plain(moved.entries), old.entries); assert.deepEqual(plain(moved.groups), old.groups);
  assert.deepEqual(ids(api.readCatalog(plain(moved)).catalog, 'a'), ['three','one','two']);
});
test('filtered reordering swaps visible slots only and new rows append', () => {
  const old = fixture(); const moved = api.reorderGroupEntries(old, 'a', ['three','one']);
  assert.deepEqual(ids(moved, 'a'), ['three','two','one']);
  moved.entries.push({ ...old.entries[0], id: 'new' });
  assert.deepEqual(ids(moved, 'a'), ['three','two','one','new']);
});
test('malformed, stale and duplicate optional order data is ignored safely', () => {
  const old = fixture(); old.groupOrders = [null, { groupId: 'gone', entryIds: ['one'] }, { groupId: 'a', entryIds: ['three','missing','three',12] }];
  const normalized = api.validateCatalog(old);
  assert.deepEqual(ids(normalized, 'a'), ['three','one','two']);
  assert.deepEqual(plain(normalized.groupOrders), [{ groupId: 'a', entryIds: ['three'] }]);
  old.groupOrders = 'broken'; assert.deepEqual(ids(api.validateCatalog(old), 'a'), ['one','two','three']);
});
test('merge retains local order without false conflicts and appends incoming-only rows in their order', () => {
  const local = api.reorderGroupEntries(fixture(), 'a', ['two','one','three']);
  const incoming = fixture(); incoming.entries.push(...['four','five'].map(id => ({ ...incoming.entries[0], id })));
  const remote = api.reorderGroupEntries(incoming, 'a', ['five','four','three','two','one']);
  const merged = api.mergeCatalogs(local, remote);
  assert.equal(merged.entries.length, 5); assert.equal(merged.groups.length, 2);
  assert.deepEqual(ids(merged, 'a'), ['two','one','three','five','four']);
  assert.deepEqual(plain(api.mergeCatalogs(merged, remote)), plain(merged));
});
test('unclassified ordering is independent and membership changes prune stale references', () => {
  const old = fixture(); old.entries.forEach(row => { row.groupIds = []; });
  const moved = api.reorderGroupEntries(old, null, ['three','two','one']);
  assert.deepEqual(ids(moved, null), ['three','two','one']);
  moved.entries[2].groupIds = ['a'];
  const normalized = api.validateCatalog(moved);
  assert.deepEqual(ids(normalized, null), ['two','one']);
  assert.deepEqual(ids(normalized, 'a'), ['three']);
});

for (const mode of ['st','tt']) test(mode + ' persists order through restart and account sync; failed writes leave order unchanged', async () => {
  let state, fail = false;
  const account = new Map();
  const context = { extensionSettings: {}, saveSettingsDebounced() { if (fail) throw Error('blocked'); },
    accountStorage: { getItem:key=>account.get(key)??null, setItem:(key,value)=>account.set(key,value) } };
  const host = mode==='st'?{}:{ __TAURITAVERN__: { api: { extension: { store: {
    async tryGetJson() { return { found: !!state, value: state }; },
    async setJson({value}) { if(fail)throw Error('blocked');state=plain(value); }
  } } } } };
  const open=()=>api.openCatalogStorage(host,context,{getItem:()=>null});
  let storage=await open(); await storage.update(()=>fixture());
  await storage.update(c=>api.reorderGroupEntries(c,'a',['three','one','two']));
  storage=await open(); assert.deepEqual(ids(storage.catalog,'a'),['three','one','two']);
  fail=true; await assert.rejects(storage.update(c=>api.reorderGroupEntries(c,'a',['two','one','three'])),/保存失败/);
  assert.deepEqual(ids(storage.catalog,'a'),['three','one','two']);fail=false;
  await storage.push();
  const receiver=await api.openCatalogStorage({}, {extensionSettings:{},saveSettingsDebounced(){},accountStorage:context.accountStorage},{getItem:()=>null});
  const pull=await receiver.pull(); if(pull?.resolve)await pull.resolve('account');
  assert.deepEqual(ids(receiver.catalog,'a'),['three','one','two']);
});

test('conflicting imports remap ordering to copied IDs without changing originals or duplicating on repeat', () => {
  const local=api.reorderGroupEntries(fixture(),'a',['two','one','three']);
  const incoming=fixture();incoming.groups[0].name='Changed A';incoming.entries[0].key='fixture-other-key';
  const imported=api.reorderGroupEntries(incoming,'a',['three','one','two']);
  const merged=api.mergeCatalogs(local,imported);
  const copiedGroup=merged.groups.find(g=>g.conflictSourceId==='a');assert.ok(copiedGroup);
  assert.deepEqual(Array.from(api.orderedGroupEntries(merged,copiedGroup.id),row=>row.model),['three','one','two']);
  assert.deepEqual(ids(merged,'a'),['two','one','three']);
  assert.deepEqual(plain(api.mergeCatalogs(merged,imported)),plain(merged));
});
