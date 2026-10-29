'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const { TextEncoder } = require('node:util');

const sourcePath = path.join(__dirname, '../src/tt-secrets.js');
const bindingKey = 'st_api_manager_tt_secret_bindings_v1';

function createHost(initial = {}, existingStorage = new Map()) {
  const stores = structuredClone(initial);
  const writes = [], rotations = [];
  let failWrite = false, failRotate = false, serial = 0;
  const localStorage = {
    getItem: key => existingStorage.has(key) ? existingStorage.get(key) : null,
    setItem: (key, value) => existingStorage.set(key, String(value)),
    removeItem: key => existingStorage.delete(key),
  };
  const state = {
    async JA() {
      return Object.fromEntries(Object.entries(stores).map(([key, items]) => [key,
        items.map(({ value, visible, ...item }) => visible ? { ...item, value } : { ...item })]));
    },
    async WA(context, key, value, label) {
      if (failWrite) throw new Error('write failed');
      const items = stores[key] ||= [];
      for (const item of items) item.active = false;
      const id = `created-${++serial}`;
      items.push({ id, value, label, active: true });
      writes.push({ key, value, id });
      return id;
    },
    async QA(context, key, id) {
      if (failRotate) throw new Error('rotate failed');
      const items = stores[key] || [];
      if (!items.some(item => item.id === id)) throw new Error('missing ID');
      for (const item of items) item.active = item.id === id;
      rotations.push({ key, id });
    },
    stores, writes, rotations, localStorage, existingStorage,
    set failWrite(value) { failWrite = value; },
    set failRotate(value) { failRotate = value; },
  };
  return state;
}
function load(host) {
  const source = fs.readFileSync(sourcePath, 'utf8');
  const context = vm.createContext({
    ttHost: { crypto: webcrypto }, TextEncoder, localStorage: host.localStorage,
    JA: host.JA, WA: host.WA, QA: host.QA,
    HA: value => typeof value === 'string' ? value.normalize('NFKC').replace(/[\u200B-\u200D\uFEFF]/g, '').trim() : '',
    ttWithConnectionValidationSuspended: async callback => callback(),
    console,
  });
  vm.runInContext(source, context, { filename: sourcePath });
  assert.equal(typeof context.ttRegisterSecret, 'function');
  return context.ttRegisterSecret;
}
const config = { name: 'example', groupName: 'site' };
const context = {};
const custom = 'api_key_custom';
const active = (host, type = custom) => host.stores[type].find(item => item.active);

// The upstream function trusted keyItem.secretId even after its key changed.
test('editing a key with a stale ID registers and activates the new key', async () => {
  const host = createHost({ [custom]: [
    { id: 'old-id', value: 'old-key', active: false },
    { id: 'other-id', value: 'other-key', active: true },
  ] });
  const item = { key: 'new-key', secretId: 'old-id' };
  await load(host)(context, config, item, custom, item.key, true);
  assert.equal(active(host).value, 'new-key');
  assert.notEqual(item.secretId, 'old-id');
  assert.equal(item.secretId, active(host).id);
  assert.equal(host.writes.length, 1);
});

test('a bound ID that disappeared is replaced instead of rotated', async () => {
  const host = createHost({ [custom]: [{ id: 'initial', value: 'initial', active: true }] });
  const register = load(host), item = { key: 'saved-key' };
  await register(context, config, item, custom, item.key, true);
  const old = item.secretId;
  host.stores[custom] = host.stores[custom].filter(s => s.id !== old);
  await register(context, config, item, custom, item.key, true);
  assert.notEqual(item.secretId, old);
  assert.equal(active(host).value, item.key);
  assert.equal(host.writes.length, 2);
});

test('matching masked suffixes and labels are not proof of a key match', async () => {
  for (const candidate of [
    { id: 'masked', value: 'different-123', display_value: '********123', label: '***123', active: true },
    { id: 'label', value: 'different-key', label: 'requested-key', active: true },
  ]) {
    const host = createHost({ [custom]: [candidate] });
    const key = candidate.id === 'masked' ? 'requested-123' : 'requested-key';
    const item = { key, secretId: candidate.id };
    await load(host)(context, config, item, custom, key, true);
    assert.equal(active(host).value, key);
    assert.notEqual(item.secretId, candidate.id);
    assert.equal(host.writes.length, 1);
  }
});

test('an explicit native plaintext value may be reused', async () => {
  const host = createHost({ [custom]: [
    { id: 'match', value: 'actual-key', visible: true, active: false },
    { id: 'other', value: 'other', active: true },
  ] });
  const item = { key: 'actual-key' };
  await load(host)(context, config, item, custom, item.key, true);
  assert.equal(item.secretId, 'match');
  assert.equal(active(host).id, 'match');
  assert.equal(host.writes.length, 0);
});

test('repeat apply and a fresh script instance reuse a verified binding', async () => {
  const host = createHost({ [custom]: [{ id: 'original', value: 'original', active: true }] });
  const item = { key: ' saved-key ' };
  await load(host)(context, config, item, custom, item.key, true);
  const id = item.secretId;
  await load(host)(context, config, { key: 'saved-key' }, custom, 'saved-key', true);
  assert.equal(host.writes.length, 1);
  assert.equal(active(host).id, id);
  assert.ok(host.localStorage.getItem(bindingKey));
  assert.equal(host.localStorage.getItem(bindingKey).includes('saved-key'), false);
});

test('registering for generation restores the previously active secret', async () => {
  const host = createHost({ [custom]: [{ id: 'previous', value: 'previous-key', active: true }] });
  const item = { key: 'generation-key' };
  await load(host)(context, config, item, custom, item.key, false);
  assert.equal(active(host).id, 'previous');
  assert.equal(host.stores[custom].find(s => s.id === item.secretId).value, 'generation-key');
  assert.deepEqual(host.rotations, [{ key: custom, id: 'previous' }]);
});

test('failed write does not replace the stored binding or key item ID', async () => {
  const host = createHost({ [custom]: [{ id: 'previous', value: 'previous', active: true }] });
  const register = load(host);
  const first = { key: 'first' };
  await register(context, config, first, custom, first.key, true);
  const saved = host.localStorage.getItem(bindingKey);
  host.failWrite = true;
  const item = { key: 'new-key', secretId: 'untrusted-old-id' };
  await assert.rejects(register(context, config, item, custom, item.key, true), /write failed/);
  assert.equal(item.secretId, 'untrusted-old-id');
  assert.equal(host.localStorage.getItem(bindingKey), saved);
});

test('failed rotation does not replace the key item ID or its binding', async () => {
  const host = createHost({ [custom]: [{ id: 'other', value: 'other', active: true }] });
  const register = load(host), item = { key: 'first' };
  await register(context, config, item, custom, item.key, true);
  await host.QA(context, custom, 'other');
  const saved = host.localStorage.getItem(bindingKey);
  host.failRotate = true;
  const again = { key: 'first', secretId: 'untrusted' };
  await assert.rejects(register(context, config, again, custom, again.key, true), /rotate failed/);
  assert.equal(again.secretId, 'untrusted');
  assert.equal(host.localStorage.getItem(bindingKey), saved);
});

test('identical key text uses distinct bindings for different native secret types', async () => {
  const otherType = 'api_key_openai';
  const host = createHost({ [custom]: [], [otherType]: [] });
  const register = load(host), a = { key: 'same' }, b = { key: 'same' };
  await register(context, config, a, custom, a.key, true);
  await register(context, config, b, otherType, b.key, true);
  assert.notEqual(a.secretId, b.secretId);
  assert.equal(host.writes.length, 2);
  assert.equal(active(host, custom).value, 'same');
  assert.equal(active(host, otherType).value, 'same');
});
