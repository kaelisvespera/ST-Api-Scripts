'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const patch = require('../tools/create-apply-patch.cjs');
const original = fs.readFileSync(path.join(__dirname, '../src/upstream-index-2.1.1.js'), 'utf8');
const patched = patch(original);
const delivered = fs.readFileSync(path.join(__dirname, '../ST-ApiManager/index-2.1.1-tt2.4.js'), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
class HostSettingsError extends Error { constructor(message, stage) { super(message); this.stage = stage; } }
const key = (id, value) => ({ id, key: value, successCount: 4, failureCount: 2, isFailed: true, lastTestTime: 700, testResult: { success: false, message: 'previous test' } });
function config(name, extra = {}) {
  return { name, groupName: name, source: 'custom', customUrl: 'https://fixture.invalid/v1', customModel: name,
    apiKeys: [key('first', 'first-key'), key('second', 'second-key')], currentKeyIndex: 1, enableKeyRotation: false,
    isActive: false, lastVerifiedAt: 123, lastVerifiedKeyIndex: 0, lastHealthStatus: 'unhealthy', lastHealthError: 'previous health failure', categoryIds: ['models'], ...extra };
}
function snippet(code, category) {
  if (category) {
    const start = code.indexOf('handleSwitchInCategory:async function(t,o,r){') + 'handleSwitchInCategory:'.length;
    return code.slice(start, code.indexOf(',resetFilterState:', start));
  }
  const start = code.indexOf('async function u(o,a){', code.indexOf('function Mc(){'));
  return code.slice(start, code.indexOf('return window.addEventListener(zc,c)', start));
}
function harness(code = delivered, options = {}) {
  const configs = options.configs || [config('selected')];
  const calls = { apply: [], probes: 0, zr: 0, saved: 0, registrations: [], toasts: [], storage: [] };
  const progress = { value: { configName: '', message: '', step: 'idle' } };
  const verifying = { value: null };
  const switching = { value: null };
  const indexes = { value: {} };
  const context = vm.createContext({
    e: { value: configs }, t: verifying, r: progress, u: switching, l: indexes,
    i: value => { progress.value = { ...progress.value, ...value }; }, s() {},
    p: () => { calls.saved++; return { success: true }; }, g: () => { calls.saved++; },
    f: category => configs.filter(entry => entry.categoryIds.includes(category)),
    sr: () => Object.fromEntries(['info', 'error', 'success', 'warning'].map(type => [type, message => calls.toasts.push({ type, message })])),
    GA: HostSettingsError, Error,
    pr: error => /timeout|超时/i.test(error.message) ? new Error('请求超时，请稍后重试') : error,
    RA: async (entry, item) => { calls.registrations.push(item.id); if (options.registerError) throw options.registerError; return item.id; },
    br: async () => { calls.probes++; throw new Error('request timeout'); },
    Ac: async (entry, settings) => { calls.apply.push({ entry, settings }); if (options.applyError) throw options.applyError; settings.onProgress?.('本地配置已写入'); return true; },
    localStorage: { setItem: (name, value) => calls.storage.push({ name, value }) },
    Zo: { d5: { CATEGORY_SWITCH_INDEXES: 'category-indexes' } },
    setTimeout() {}, console: { error() {} },
  });
  vm.runInContext('function Er(e){return e.apiKeys.length?Math.min(Math.max(e.currentKeyIndex||0,0),e.apiKeys.length-1):0}', context);
  context.zr = async (entry, callback) => {
    calls.zr++;
    const index = context.Er(entry), item = entry.apiKeys[index];
    return { result: await callback(item.key, item, index), keyIndex: index };
  };
  const apply = vm.runInContext('(' + snippet(code, false) + ')', context);
  const category = vm.runInContext('(' + snippet(code, true) + ')', context);
  return { configs, calls, progress, verifying, switching, indexes, apply, category };
}

test('original apply blocks a local switch on a model-list timeout', async () => {
  const h = harness(original);
  assert.equal(await h.apply(h.configs[0]), false);
  assert.equal(h.calls.probes, 1);
  assert.equal(h.calls.apply.length, 0);
});

test('applying uses the selected key without probing models or invoking health-test rotation', async () => {
  const h = harness();
  const selected = h.configs[0], before = plain(selected);
  assert.equal(await h.apply(selected), true);
  assert.equal(h.calls.probes, 0);
  assert.equal(h.calls.zr, 0);
  assert.equal(h.calls.apply.length, 1);
  assert.equal(h.calls.apply[0].settings.apiKey, 'second-key');
  assert.equal(h.calls.apply[0].settings.keyItem, selected.apiKeys[1]);
  assert.equal(h.calls.apply[0].settings.knownModels, undefined);
  assert.equal(selected.isActive, true);
  assert.deepEqual(plain({ ...selected, isActive: false }), before);
  assert.equal(h.calls.saved, 1);
  assert.equal(h.verifying.value, null);
  assert.equal(h.progress.value.step, 'completed');
});

test('key rotation registration is preserved without advancing the selected key', async () => {
  const entry = config('rotating', { enableKeyRotation: true });
  const before = plain(entry.apiKeys);
  const h = harness(patched, { configs: [entry] });
  assert.equal(await h.apply(entry), true);
  assert.deepEqual(h.calls.registrations, ['first', 'second']);
  assert.equal(entry.currentKeyIndex, 1);
  assert.deepEqual(plain(entry.apiKeys), before);
});

test('a host control timeout retains the actual stage message and prior health result', async () => {
  const error = new HostSettingsError('来源切换超时：原生 API 控件未挂载', 'write');
  const h = harness(patched, { applyError: error });
  const entry = h.configs[0], before = plain(entry);
  assert.equal(await h.apply(entry), false);
  assert.deepEqual(plain(entry), before);
  assert.equal(h.progress.value.error, error.message);
  assert.ok(h.calls.toasts.some(toast => toast.message === '应用配置失败: ' + error.message));
  assert.equal(h.calls.saved, 0);
});

test('local registration failures do not invent a new provider-health result', async () => {
  const entry = config('rotating', { enableKeyRotation: true });
  const before = plain(entry);
  const h = harness(patched, { configs: [entry], registerError: new HostSettingsError('写入 secret 失败', 'write') });
  assert.equal(await h.apply(entry), false);
  assert.deepEqual(plain(entry), before);
  assert.equal(h.calls.apply.length, 0);
});

test('configuration completeness is still required before applying', async () => {
  const h = harness();
  const entry = h.configs[0];
  entry.customModel = '';
  const before = plain(entry);
  assert.equal(await h.apply(entry), false);
  assert.equal(h.calls.apply.length, 0);
  assert.equal(h.calls.probes, 0);
  assert.match(h.progress.value.error, /没有选择模型/);
  assert.deepEqual(plain(entry), before);
  assert.equal(h.calls.saved, 0);
});

test('all local host error stages retain their original diagnostic message', async () => {
  for (const stage of ['context', 'write', 'connect', 'models']) {
    const error = new HostSettingsError(stage + ': 原生控件超时，具体诊断', stage);
    const h = harness(patched, { applyError: error });
    assert.equal(await h.apply(h.configs[0]), false);
    assert.equal(h.progress.value.error, error.message);
  }
});

test('an empty selected key cannot silently apply with the host previous key', async () => {
  const h = harness();
  const entry = h.configs[0];
  entry.apiKeys[1].key = ' ';
  assert.equal(await h.apply(entry), false);
  assert.equal(h.calls.apply.length, 0);
  assert.match(h.progress.value.error, /当前 API Key 为空/);
});

test('category switching applies the next configuration without a model-list probe', async () => {
  const old = config('old', { isActive: true });
  const next = config('next');
  const before = plain(next);
  const h = harness(patched, { configs: [old, next] });
  let fetches = 0;
  assert.equal(await h.category('models', async () => { fetches++; throw new Error('timeout'); }), next);
  assert.equal(fetches, 0);
  assert.equal(h.calls.probes, 0);
  assert.equal(h.calls.zr, 0);
  assert.equal(h.calls.apply[0].settings.apiKey, 'second-key');
  assert.equal(next.isActive, true);
  assert.equal(old.isActive, false);
  assert.deepEqual(plain({ ...next, isActive: false }), before);
  assert.equal(h.indexes.value.models, 1);
  assert.equal(h.calls.saved, 1);
  assert.equal(h.switching.value, null);
});

test('failed category switching preserves the active model, key index and health metadata', async () => {
  const old = config('old', { isActive: true });
  const next = config('next');
  const before = plain([old, next]);
  const error = new HostSettingsError('原生 API 控件未准备好', 'write');
  const h = harness(patched, { configs: [old, next], applyError: error });
  assert.equal(await h.category('models', async () => []), null);
  assert.deepEqual(plain([old, next]), before);
  assert.equal(h.calls.saved, 0);
  assert.deepEqual(h.indexes.value, {});
  assert.ok(h.calls.toasts.some(toast => toast.message === '切换失败: ' + error.message));
});

test('explicit model-detection functions remain unchanged', () => {
  const start = original.indexOf('async function ur(');
  const end = original.indexOf('async function vr(', start);
  assert.equal(patched.slice(patched.indexOf('async function ur('), patched.indexOf('async function vr(')), original.slice(start, end));
});
