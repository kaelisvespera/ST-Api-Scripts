const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const secretCode = fs.readFileSync(path.join(__dirname, '../src/tt-secrets.js'), 'utf8');
const writer = fs.readFileSync(path.join(__dirname, '../src/tt-apply-settings.js'), 'utf8');
const original = fs.readFileSync(path.join(__dirname, '../src/upstream-index-2.1.1.js'), 'utf8');
const oldWriter = original.slice(original.indexOf('async function Ac('), original.indexOf('function cc(', original.indexOf('async function Ac(')));
const config = { source: 'custom', customUrl: 'https://example.invalid/v1', customModel: 'saved-model', name: 'saved config' };
function app(options = {}, code = writer) {
  const nodes = new Map();
  const settings = { custom_model_list: [], custom_api_format: 'anthropic', ...options.initialSettings };
  const events = [], saves = [], warnings = [], secrets = [], connects = [], modelChanges = [];
  const nativeSecrets = options.nativeSecrets || [];
  const storage = new Map();
  const activeToken = () => nativeSecrets.find(secret => secret.active)?.plaintext;
  if (!options.noMain) nodes.set('#main_api', { value: options.main || 'openai' });
  if (options.sourceControl) nodes.set('#chat_completion_source', { value: 'old-source' });
  nodes.set('#api_key_custom', { value: 'old-unsaved-key' });
  if (options.modelControl) nodes.set('#custom_model_id', { value: settings.custom_model || '', tagName: options.modelControl, options: [] });
  if (options.asyncModelDropdown) nodes.set('#model_custom_select', {
    value: 'previous-model', tagName: 'SELECT', options: [{ value: 'previous-model' }],
  });
  if (!options.noButton) nodes.set('#api_button_openai', { disabled: !!options.disabled, async click() { await Promise.resolve(); connects.push({ ...settings, ...(options.realSecrets ? { token: activeToken(), secret_id: nativeSecrets.find(secret => secret.active)?.id } : {}) }); } });
  function $(selector) {
    const node = typeof selector === 'object' ? selector : nodes.get(selector);
    return {
      0: node, length: node ? 1 : 0,
      val(value) { if (arguments.length) { if (node) node.value = value; return this; } return node?.value; },
      text(value) { if (node) node.text = value; return this; },
      trigger(event) {
        events.push({ selector, event, settings: { ...settings }, secretCount: secrets.length });
        if (selector === '#chat_completion_source' && event === 'change') {
          if (options.sourceReset) settings.custom_model = '';
          if (options.sourceDenied) node.value = 'openai';
          if (options.asyncModelDropdown) $('#model_custom_select').trigger('change');
          nodes.get('#api_button_openai')?.click();
        }
        if (selector === '#model_custom_select' && event === 'change' && options.asyncModelDropdown) {
          // TT captures the dropdown selection before awaiting its custom-model
          // action handler, then applies that captured model to the text field.
          const selectedModel = node.value;
          modelChanges.push(Promise.resolve().then(() => {
            if (selectedModel) {
              settings.custom_model = selectedModel;
              nodes.get('#custom_model_id').value = selectedModel;
            }
          }));
        }
        if (selector === '#custom_model_id' && event === 'input') settings.custom_model = node.value;
        return this;
      },
      first() { return this; }, prop(name) { return node?.[name]; },
      find() { return { toArray: () => node?.options || [] }; },
      append(option) { node.options.push({ value: option.val() }); return this; },
    };
  }
  const native$ = selector => selector === '<option></option>' ? $({ tagName: 'OPTION' }) : $(selector);
  const context = { mainApi: options.main || 'openai', chatCompletionSettings: settings,
    saveSettingsDebounced: options.noSave ? undefined : () => saves.push({ ...settings }) };
  class GA extends Error { constructor(message, stage) { super(message); this.stage = stage; } }
  let clock = 0;
  const host = { $: native$, SillyTavern: { getContext: () => context }, toastr: { warning: message => warnings.push(message) } };
  const environment = vm.createContext({
    window: { parent: host, setTimeout: callback => callback() },
    ttHost: { ...host, crypto: webcrypto }, TextEncoder, Uint8Array,
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    Date: { now: () => clock += 100000 }, setTimeout: callback => callback(),
    console: { warn() {}, log() {} }, GA,
    er: name => options.sources?.[name] || ({ requiresCustomUrl: true, secretKey: 'api_key_custom', keyInputSelector: '#api_key_custom', modelSettingKey: 'custom_model', stateModelKeys: ['custom_model'], modelInputSelector: '#custom_model_id', modelListSelector: '#model_custom_select' }),
    HA: value => value.trim(), sc: value => value?.trim().toLowerCase() || '', qA() {},
    PA: ['#main_api'], $A: ['#chat_completion_source'], jA: ['#custom_api_url_text'],
    oc($, selectors, value) {
      events.push({ selectors, value, settings: { ...settings } });
      if (options.sourceReset && selectors[0] === '#chat_completion_source') settings.custom_model = '';
      const target = selectors.find(selector => nodes.has(selector));
      if (target) $(target).val(value);
      return !!target;
    },
    async ec(context, config, keyItem, secretKey, key) {
      if (options.secretError) throw options.secretError;
      if (options.waitSecret) await options.waitSecret;
      secrets.push({ secretKey, key, keyItem });
    },
    ac() {},
    async fetch(url, init) {
      if (options.realSecrets && url === '/api/secrets/write') {
        if (options.secretError) throw options.secretError;
        const body = JSON.parse(init.body);
        for (const secret of nativeSecrets) secret.active = false;
        const id = 'written-' + nativeSecrets.length;
        nativeSecrets.push({ id, value: '**********', plaintext: body.value, active: true });
        return { ok: true, json: async () => ({ id }) };
      }
      if (options.realSecrets && url === '/api/secrets/rotate') {
        const body = JSON.parse(init.body);
        for (const secret of nativeSecrets) secret.active = secret.id === body.id;
        return { ok: true };
      }
      if (options.realSecrets && url === '/api/secrets/read') {
        return { ok: true, json: async () => ({ api_key_custom: nativeSecrets.map(({ plaintext, ...metadata }) => metadata) }) };
      }
      throw new Error('No network probe is allowed during local selection');
    },
    br() { throw new Error('No model probe is allowed during local selection'); },
  });
  if (options.realSecrets) vm.runInContext(secretCode, environment);
  vm.runInContext(code, environment);
  return { apply: environment.Ac, nodes, settings, events, saves, warnings, secrets, connects, modelChanges };
}
test('reproduces old wait on parked AI settings drawer', async () => {
  const old = app({}, oldWriter);
  await assert.rejects(old.apply(config, { connectionTimeoutMs: 10 }), /切换到聊天补全 API 超时/);
  assert.equal(old.saves.length, 0);
});
test('closed drawer, absent provider controls and empty model list do not block local selection', async () => {
  const instance = app();
  assert.equal(await instance.apply(config, { apiKey: ' fake-key ', keyItem: { id: 'selected' } }), true);
  assert.equal(instance.settings.custom_model, 'saved-model');
  assert.equal(instance.settings.custom_url, config.customUrl);
  assert.equal(instance.settings.custom_api_format, 'openai_compat');
  assert.equal(instance.secrets[0].key, 'fake-key');
  assert.equal(instance.saves.length, 1);
  assert.equal(instance.connects[0].custom_model, 'saved-model');
});
test('native change handlers see complete fields and cannot erase the final selected model', async () => {
  const instance = app({ sourceControl: true, sourceReset: true, modelControl: 'INPUT' });
  await instance.apply(config, { apiKey: 'fake-key' });
  const sourceChange = instance.events.find(event => event.selector === '#chat_completion_source' && event.event === 'change');
  assert.equal(sourceChange.settings.custom_model, config.customModel);
  assert.equal(sourceChange.settings.custom_url, config.customUrl);
  assert.equal(sourceChange.secretCount, 1);
  assert.equal(instance.settings.custom_model, config.customModel);
  assert.equal(instance.nodes.get('#custom_model_id').value, config.customModel);
  assert.equal(instance.connects.length, 1);
  assert.equal(instance.nodes.get('#api_key_custom').value, '');
});

test('one application synchronizes the custom model dropdown before its asynchronous change handler runs', async () => {
  const instance = app({ sourceControl: true, modelControl: 'INPUT', asyncModelDropdown: true });
  await instance.apply(config, { apiKey: 'fake-key' });
  await Promise.all(instance.modelChanges);
  assert.equal(instance.settings.custom_model, config.customModel);
  assert.equal(instance.nodes.get('#custom_model_id').value, config.customModel);
  assert.equal(instance.nodes.get('#model_custom_select').value, config.customModel);
  assert.ok(instance.nodes.get('#model_custom_select').options.some(option => option.value === config.customModel));
  assert.equal(instance.connects.length, 1);
  assert.equal(instance.connects[0].custom_model, config.customModel);
});

test('missing provider controls preserve other source models while accepting the same-source alias', async () => {
  const deepseek = { requiresCustomUrl: false, keyInputSelector: '#api_key_deepseek',
    modelSettingKey: 'deepseek_model', stateModelKeys: ['deepseek_model', 'custom_model'],
    modelInputSelector: '#model_deepseek_select', modelListSelector: '#model_deepseek_select',
    fallbackModelInputSelectors: ['#model_deepseek_select', '#deepseek_model', '#model_openai_select', '#custom_model_id'] };
  for (const alias of [false, true]) {
    const instance = app({ modelControl: 'INPUT', initialSettings: { custom_model: 'keep-custom' }, sources: { deepseek } });
    if (alias) instance.nodes.set('#deepseek_model', { value: 'old-deepseek', tagName: 'INPUT' });
    await instance.apply({ ...config, source: 'deepseek', customModel: 'selected-deepseek' });
    assert.equal(instance.settings.deepseek_model, 'selected-deepseek');
    assert.equal(instance.settings.custom_model, 'keep-custom');
    assert.equal(instance.nodes.get('#custom_model_id').value, 'keep-custom');
    if (alias) assert.equal(instance.nodes.get('#deepseek_model').value, 'selected-deepseek');
  }
});
test('no native reconnect starts before the selected secret is activated', async () => {
  let activate;
  const waitSecret = new Promise(resolve => { activate = resolve; });
  const instance = app({ sourceControl: true, main: 'textgenerationwebui', waitSecret });
  const applying = instance.apply(config, { apiKey: 'fake-key' });
  await Promise.resolve();
  assert.equal(instance.events.length, 0);
  assert.equal(instance.connects.length, 0);
  activate();
  await applying;
  assert.equal(instance.connects.length, 1);
  assert.equal(instance.connects[0].custom_model, config.customModel);
  assert.equal(instance.events.filter(event => event.selector === '#chat_completion_source' && event.event === 'change').length, 1);
});
test('triggerConnect false writes settings without a source-change reconnection', async () => {
  const instance = app({ sourceControl: true });
  await instance.apply(config, { apiKey: 'fake-key', triggerConnect: false });
  assert.equal(instance.connects.length, 0);
  assert.equal(instance.events.filter(event => event.selector === '#chat_completion_source').length, 0);
  assert.equal(instance.saves.length, 1);
});
test('manual model not present in a select is added before connecting', async () => {
  const instance = app({ modelControl: 'SELECT' });
  await instance.apply(config);
  assert.equal(instance.nodes.get('#custom_model_id').options[0].value, config.customModel);
  assert.equal(instance.connects[0].custom_model, config.customModel);
});
test('switches the real main API selector rather than mutating a context snapshot', async () => {
  const instance = app({ main: 'textgenerationwebui' });
  await instance.apply(config);
  assert.equal(instance.nodes.get('#main_api').value, 'openai');
  const missing = app({ main: 'textgenerationwebui', noMain: true });
  await assert.rejects(missing.apply(config), /未找到主 API 选择框/);
});
test('failed secret writes remain failures and do not claim a saved selection', async () => {
  const error = new Error('secret write failed');
  const instance = app({ secretError: error });
  await assert.rejects(instance.apply(config, { apiKey: 'fake-key' }), /secret write failed/);
  assert.equal(instance.saves.length, 0);
  assert.equal(instance.connects.length, 0);
});
test('disabled or absent connect button preserves saved config and reports it explicitly', async () => {
  for (const options of [{ disabled: true }, { noButton: true }]) {
    const instance = app(options);
    assert.equal(await instance.apply(config), true);
    assert.equal(instance.saves.length, 1);
    assert.equal(instance.connects.length, 0);
    assert.match(instance.warnings[0], /配置已写入/);
  }
});
test('missing save interface is a concrete local error', async () => {
  const instance = app({ noSave: true });
  await assert.rejects(instance.apply(config), /未提供设置保存接口/);
});

test('real apply repairs a stale secret ID and connects the target endpoint with the selected token', async () => {
  const instance = app({ sourceControl: true, sourceReset: true, realSecrets: true,
    nativeSecrets: [{ id: 'old-id', plaintext: 'old-token', value: '**********', active: true }] });
  const keyItem = { key: 'new-token', secretId: 'old-id' };
  await instance.apply(config, { apiKey: keyItem.key, keyItem });
  assert.equal(instance.connects.length, 1);
  assert.equal(instance.connects[0].token, 'new-token');
  assert.equal(instance.connects[0].custom_url, config.customUrl);
  assert.equal(instance.connects[0].custom_model, config.customModel);
  assert.notEqual(keyItem.secretId, 'old-id');
  await instance.apply({ ...config, customUrl: 'https://second.invalid/v1' }, { apiKey: 'second-token', keyItem: { secretId: 'old-id' } });
  assert.equal(instance.connects.length, 2);
  assert.equal(instance.connects[1].token, 'second-token');
  assert.equal(instance.connects[1].custom_url, 'https://second.invalid/v1');
  // Reusing the first key exercises the real HTTP rotation path.
  await instance.apply(config, { apiKey: keyItem.key, keyItem });
  assert.equal(instance.connects.length, 3);
  assert.equal(instance.connects[2].token, 'new-token');
  assert.equal(instance.connects[2].secret_id, keyItem.secretId);
  assert.equal(instance.connects[2].custom_url, config.customUrl);
  const mainChanges = instance.events.filter(event => event.selector === '#main_api' && event.event === 'change');
  assert.equal(mainChanges.length, 0, 'HTTP rotation must not emit a main API event');

});

test('failed secret write sends no connection request and leaves the native button usable', async () => {
  const instance = app({ sourceControl: true, realSecrets: true, secretError: new Error('write denied') });
  await assert.rejects(instance.apply(config, { apiKey: 'selected-token' }), /write denied/);
  assert.equal(instance.connects.length, 0);
  await instance.nodes.get('#api_button_openai').click();
  assert.equal(instance.connects.length, 1, 'the native connection must be usable after failure');
});
