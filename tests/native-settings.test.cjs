const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const secretCode = fs.readFileSync(path.join(__dirname, '../src/tt-secrets.js'), 'utf8');
const bundle = fs.readFileSync(path.join(__dirname, '../ST-ApiManager/index-2.1.1-tt2.4.js'), 'utf8');
const nativeSecretHelpers = bundle.slice(bundle.indexOf('async function JA('), bundle.indexOf('function tc(', bundle.indexOf('async function JA(')));
const writer = bundle.slice(bundle.indexOf('async function Ac('), bundle.indexOf('function cc(', bundle.indexOf('async function Ac(')));
const original = fs.readFileSync(path.join(__dirname, '../src/upstream-index-2.1.1.js'), 'utf8');
const oldWriter = original.slice(original.indexOf('async function Ac('), original.indexOf('function cc(', original.indexOf('async function Ac(')));
const config = { source: 'custom', customUrl: 'https://example.invalid/v1', customModel: 'saved-model', name: 'saved config' };
function app(options = {}, code = writer) {
  const nodes = new Map();
  const settings = { custom_model_list: [], custom_api_format: 'anthropic' };
  const events = [], saves = [], warnings = [], secrets = [], connects = [];
  let suspensionDepth = 0;
  const nativeSecrets = options.nativeSecrets || [];
  const storage = new Map();
  const activeToken = () => nativeSecrets.find(secret => secret.active)?.plaintext;
  if (!options.noMain) nodes.set('#main_api', { value: options.main || 'openai' });
  if (options.sourceControl) nodes.set('#chat_completion_source', { value: 'old-source' });
  nodes.set('#api_key_custom', { value: 'old-unsaved-key' });
  if (options.modelControl) nodes.set('#custom_model_id', { value: '', tagName: options.modelControl, options: [] });
  if (!options.noButton) nodes.set('#api_button_openai', { disabled: !!options.disabled, click() { if (!suspensionDepth) connects.push({ ...settings, ...(options.realSecrets ? { token: activeToken(), secret_id: nativeSecrets.find(secret => secret.active)?.id } : {}) }); } });
  function $(selector) {
    const node = typeof selector === 'object' ? selector : nodes.get(selector);
    return {
      0: node, length: node ? 1 : 0,
      val(value) { if (arguments.length) { if (node) node.value = value; return this; } return node?.value; },
      text(value) { if (node) node.text = value; return this; },
      trigger(event) {
        events.push({ selector, event, settings: { ...settings }, secretCount: secrets.length, suspended: suspensionDepth > 0 });
        if (selector === '#chat_completion_source' && event === 'change') {
          if (options.sourceReset) settings.custom_model = '';
          if (options.sourceDenied) node.value = 'openai';
          if (!suspensionDepth) nodes.get('#api_button_openai')?.click();
        }
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
  host.SillyTavern.secrets = {
    async readSecretState() { return { api_key_custom: nativeSecrets }; },
    async writeSecret(secretKey, value) {
      if (options.secretError) throw options.secretError;
      for (const secret of nativeSecrets) secret.active = false;
      const id = 'written-' + nativeSecrets.length;
      nativeSecrets.push({ id, value: '**********', plaintext: value, active: true });
      $('#api_key_custom').val('').trigger('input');
      await this.readSecretState();
      return id;
    },
    async rotateSecret(secretKey, id) {
      for (const secret of nativeSecrets) secret.active = secret.id === id;
      await this.readSecretState();
      $('#main_api').trigger('change');
      return true;
    },
  };
  const environment = vm.createContext({
    window: { parent: host, setTimeout: callback => callback() },
    ttHost: { ...host, crypto: webcrypto }, TextEncoder, Uint8Array,
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    async JA() { return { api_key_custom: nativeSecrets.map(({ plaintext, ...metadata }) => metadata) }; },
    async WA(context, secretKey, key) {
      if (options.secretError) throw options.secretError;
      for (const secret of nativeSecrets) secret.active = false;
      const id = 'written-' + nativeSecrets.length;
      nativeSecrets.push({ id, value: '**********', plaintext: key, active: true });
      return id;
    },
    async QA(context, secretKey, id) {
      for (const secret of nativeSecrets) secret.active = secret.id === id;
    },
    Date: { now: () => clock += 100000 }, setTimeout: callback => callback(),
    console: { warn() {}, log() {} }, GA,
    er: () => ({ requiresCustomUrl: true, secretKey: 'api_key_custom', keyInputSelector: '#api_key_custom', modelSettingKey: 'custom_model', stateModelKeys: ['custom_model'], modelInputSelector: '#custom_model_id' }),
    HA: value => value.trim(), sc: value => value?.trim().toLowerCase() || '', qA() {},
    PA: ['#main_api'], $A: ['#chat_completion_source'], jA: ['#custom_api_url_text'],
    oc($, selectors, value) {
      events.push({ selectors, value, settings: { ...settings } });
      if (options.sourceReset && selectors[0] === '#chat_completion_source') settings.custom_model = '';
      const target = selectors.find(selector => nodes.has(selector));
      if (target) $(target).val(value);
      return !!target;
    },
    async ttWithConnectionValidationSuspended(callback) {
      suspensionDepth++;
      try { return await callback(); } finally { suspensionDepth--; }
    },
    async ec(context, config, keyItem, secretKey, key) {
      if (options.secretError) throw options.secretError;
      if (options.waitSecret) await options.waitSecret;
      secrets.push({ secretKey, key, keyItem });
    },
    ac() {},
    async fetch(url) {
      if (options.realSecrets && url === '/api/secrets/read') {
        return { ok: true, json: async () => ({ api_key_custom: nativeSecrets.map(({ plaintext, ...metadata }) => metadata) }) };
      }
      throw new Error('No network probe is allowed during local selection');
    },
    br() { throw new Error('No model probe is allowed during local selection'); },
  });
  if (options.realSecrets) vm.runInContext(nativeSecretHelpers + secretCode, environment);
  vm.runInContext(code, environment);
  return { apply: environment.Ac, nodes, settings, events, saves, warnings, secrets, connects };
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
test('triggerConnect false synchronizes the source without an implicit reconnection', async () => {
  const instance = app({ sourceControl: true });
  await instance.apply(config, { apiKey: 'fake-key', triggerConnect: false });
  assert.equal(instance.connects.length, 0);
  assert.equal(instance.events.filter(event => event.selector === '#chat_completion_source').length, 1);
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
  // Reusing the first key exercises the real QA -> rotateSecret -> ZA path.
  await instance.apply(config, { apiKey: keyItem.key, keyItem });
  assert.equal(instance.connects.length, 3);
  assert.equal(instance.connects[2].token, 'new-token');
  assert.equal(instance.connects[2].secret_id, keyItem.secretId);
  assert.equal(instance.connects[2].custom_url, config.customUrl);
  const mainChanges = instance.events.filter(event => event.selector === '#main_api' && event.event === 'change');
  assert.equal(mainChanges.length, 1, 'rotation must not add a redundant main API change');
  assert.equal(mainChanges[0].suspended, true);

});

test('failed native secret write releases the validation scope and sends no connection request', async () => {
  const instance = app({ sourceControl: true, realSecrets: true, secretError: new Error('write denied') });
  await assert.rejects(instance.apply(config, { apiKey: 'selected-token' }), /write denied/);
  assert.equal(instance.connects.length, 0);
  instance.nodes.get('#api_button_openai').click();
  assert.equal(instance.connects.length, 1, 'the native connection must be usable after failure');
});
