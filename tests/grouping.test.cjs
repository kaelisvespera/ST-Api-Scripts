'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const patchGrouping = require('../tools/grouping-patch.cjs');

const original = fs.readFileSync(path.join(__dirname, '../src/upstream-index-2.1.1.js'), 'utf8');
const patched = patchGrouping(original);
const groupKey = (name, url) => `${name}::${url}`;
const categoryHelpers = original.slice(original.indexOf('function es(e){'), original.indexOf("const is=['id'"));
const configHelpers = original.slice(original.indexOf('function cc(e){'), original.indexOf('function Cc(e){'));

function converter(code) {
  const start = code.indexOf('saveEditForm:function(t,n){const o=') + 'saveEditForm:function(t,n){const o='.length;
  const end = code.indexOf('}(t,n,e.value);', start) + 1;
  const context = vm.createContext({
    _c: { Xd: groupKey },
    er: () => ({ requiresCustomUrl: true, defaultUrl: '' }),
    or: (index, length) => Math.min(Math.max(index || 0, 0), Math.max(length - 1, 0)),
    sr: () => ({ warning() {} }),
  });
  vm.runInContext(categoryHelpers + configHelpers, context);
  return vm.runInContext(`(${code.slice(start, end)})`, context);
}

const save = converter(patched);
test('delivered bundle contains the grouping fix', () => {
  const delivered = fs.readFileSync(path.join(__dirname, '../ST-ApiManager/index-2.1.1-tt2.4.js'), 'utf8');
  const before = [config('claude-1', ['claude']), config('gemini-1', ['gemini'])];
  const result = byModel(converter(delivered)(form(['claude-1', 'gemini-1', 'new-1']), 0, before));
  assert.deepEqual(result['claude-1'].categoryIds, ['claude']);
  assert.deepEqual(result['gemini-1'].categoryIds, ['gemini']);
  assert.deepEqual(result['new-1'].categoryIds, []);
});
const plain = value => JSON.parse(JSON.stringify(value));
const url = 'https://example.test/v1';

function config(model, categories, extra = {}) {
  return {
    name: `[站点] ${model}`, source: 'custom', customUrl: url,
    apiKeys: [{ id: 'old-key', key: 'old-key-value' }], currentKeyIndex: 0,
    enableKeyRotation: false, customModel: model, groupName: '站点',
    groupKey: groupKey('站点', url), categoryId: categories[0], categoryIds: [...categories],
    isActive: false, ...extra,
  };
}

function form(models, extra = {}) {
  return {
    groupName: '站点', source: 'custom', customUrl: url,
    apiKeys: [{ id: 'new-key', key: ' new-key-value ' }], currentKeyIndex: 0,
    enableKeyRotation: true, selectedModels: models, ...extra,
  };
}

function byModel(result) {
  assert.equal(result.success, true);
  return Object.fromEntries(plain(result.configs).map(entry => [entry.customModel, entry]));
}

test('upstream reproduction: editing one site overwrites separate model categories', () => {
  const before = [config('claude-1', ['claude']), config('gemini-1', ['gemini'])];
  const result = byModel(converter(original)(form(['claude-1', 'gemini-1', 'new-1']), 0, before));
  assert.deepEqual(result['gemini-1'].categoryIds, ['claude']);
  assert.deepEqual(result['new-1'].categoryIds, ['claude']);
});

test('editing a site keeps each old model category and leaves new models ungrouped', () => {
  const before = [
    config('claude-1', ['claude', 'favorites']),
    config('gemini-1', ['gemini']),
    config('old-ungrouped', []),
  ];
  const result = byModel(save(form(['claude-1', 'gemini-1', 'old-ungrouped', 'new-1']), 0, before));
  assert.deepEqual(result['claude-1'].categoryIds, ['claude', 'favorites']);
  assert.equal(result['claude-1'].categoryId, 'claude');
  assert.deepEqual(result['gemini-1'].categoryIds, ['gemini']);
  assert.deepEqual(result['old-ungrouped'].categoryIds, []);
  assert.deepEqual(result['new-1'].categoryIds, []);
  assert.equal(result['new-1'].categoryId, undefined);
  assert.deepEqual(before[1].categoryIds, ['gemini']);
});

test('adding a new model to an existing site retains models absent from the add form', () => {
  const before = [config('claude-1', ['claude']), config('gemini-1', ['gemini'])];
  const result = byModel(save(form(['new-1']), null, before));
  assert.deepEqual(Object.keys(result), ['claude-1', 'gemini-1', 'new-1']);
  assert.deepEqual(result['claude-1'].categoryIds, ['claude']);
  assert.deepEqual(result['gemini-1'].categoryIds, ['gemini']);
  assert.deepEqual(result['new-1'].categoryIds, []);
  for (const entry of Object.values(result)) {
    assert.equal(entry.apiKeys[0].key, 'new-key-value');
    assert.equal(entry.enableKeyRotation, true);
  }
});

test('editing site metadata and shared keys still updates every selected model', () => {
  const before = [config('claude-1', ['claude'], { isActive: true }), config('gemini-1', ['gemini'])];
  const newUrl = 'https://renamed.example.test/api';
  const result = byModel(save(form(['claude-1', 'gemini-1', 'new-1'], {
    groupName: '重命名站点', customUrl: newUrl, source: 'openai',
  }), 1, before));
  for (const entry of Object.values(result)) {
    assert.equal(entry.groupName, '重命名站点');
    assert.equal(entry.customUrl, newUrl);
    assert.equal(entry.source, 'openai');
    assert.equal(entry.groupKey, groupKey('重命名站点', newUrl));
    assert.equal(entry.apiKeys[0].key, 'new-key-value');
    assert.equal(entry.enableKeyRotation, true);
  }
  assert.deepEqual(result['claude-1'].categoryIds, ['claude']);
  assert.deepEqual(result['gemini-1'].categoryIds, ['gemini']);
  assert.deepEqual(result['new-1'].categoryIds, []);
  assert.equal(result['claude-1'].isActive, true);
  assert.equal(result['gemini-1'].isActive, false);
});

test('adding models to the active site keeps the active model and rotation settings', () => {
  const before = [config('claude-1', ['claude']), config('gemini-1', ['gemini'], { isActive: true })];
  const result = byModel(save(form(['new-1'], {
    apiKeys: [{ id: 'key-1', key: 'first' }, { id: 'key-2', key: 'second' }],
    currentKeyIndex: 1, enableKeyRotation: true,
  }), null, before));
  assert.equal(result['claude-1'].isActive, false);
  assert.equal(result['gemini-1'].isActive, true);
  assert.equal(result['new-1'].isActive, false);
  assert.equal(Object.values(result).filter(entry => entry.isActive).length, 1);
  for (const entry of Object.values(result)) {
    assert.equal(entry.enableKeyRotation, true);
    assert.equal(entry.currentKeyIndex, 1);
    assert.equal(entry.apiKeys[entry.currentKeyIndex].key, 'second');
  }
});

test('adding a new site does not activate it or clear an unrelated active site', () => {
  const active = config('other-active', ['elsewhere'], { groupKey: 'other-site', isActive: true });
  const result = byModel(save(form(['new-1']), null, [active]));
  assert.equal(result['other-active'].isActive, true);
  assert.equal(result['new-1'].isActive, false);
  assert.equal(result['new-1'].enableKeyRotation, true);
});

test('an explicit edit can still remove a model; unrelated sites are preserved', () => {
  const unrelated = config('other', ['elsewhere'], { groupKey: 'unrelated-site' });
  const before = [config('claude-1', ['claude']), config('gemini-1', ['gemini']), unrelated];
  const result = byModel(save(form(['gemini-1']), 0, before));
  assert.deepEqual(Object.keys(result), ['other', 'gemini-1']);
  assert.deepEqual(result['gemini-1'].categoryIds, ['gemini']);
  assert.deepEqual(result.other, unrelated);
});

test('legacy categoryId-only assignments survive while a fresh site stays ungrouped', () => {
  const before = [config('old-1', [], { categoryId: 'legacy', categoryIds: undefined })];
  const result = byModel(save(form(['old-1', 'new-1']), 0, before));
  assert.deepEqual(result['old-1'].categoryIds, ['legacy']);
  assert.deepEqual(result['new-1'].categoryIds, []);
  const fresh = byModel(save(form(['new-1']), null, []));
  assert.deepEqual(fresh['new-1'].categoryIds, []);
});

test('explicit batch regrouping is unchanged and still adds/removes requested categories', () => {
  const marker = 'handleBatchCategoryApply:function(t,n,o,r){';
  const start = original.indexOf(marker) + 'handleBatchCategoryApply:'.length;
  const end = original.indexOf(',handleAddCategoryFromBatch:', start);
  const handler = original.slice(start, end);
  assert.equal(patched.slice(patched.indexOf(marker) + 'handleBatchCategoryApply:'.length,
    patched.indexOf(',handleAddCategoryFromBatch:', patched.indexOf(marker))), handler);
  const configs = [config('claude-1', ['claude']), config('gemini-1', ['gemini'])];
  let saves = 0;
  const context = vm.createContext({ e: { value: configs }, s: () => saves++, sr: () => ({ success() {} }) });
  vm.runInContext(categoryHelpers, context);
  const batch = vm.runInContext(`(${handler})`, context);
  batch([configs[0]], ['favorites'], ['claude']);
  assert.deepEqual(plain(configs[0].categoryIds), ['favorites']);
  assert.deepEqual(configs[1].categoryIds, ['gemini']);
  assert.equal(saves, 1);
});
