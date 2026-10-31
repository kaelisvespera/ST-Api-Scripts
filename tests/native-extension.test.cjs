const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');

const bootstrap = fs.readFileSync(path.join(__dirname, '../src/native-bootstrap.js'), 'utf8');
const secretCode = fs.readFileSync(path.join(__dirname, '../src/tt-secrets.js'), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
const entry = { namespace: 'st-api-manager', key: 'state' };

async function load(options = {}) {
  const writes = [], reads = [], saves = [], calls = [], errors = [], imports = [];
  const old = { ...(options.old || {}) };
  const extensionSettings = options.extensionSettings || {};
  const secrets = {
    api_key_custom: [{ id: 'active-custom', plaintext: 'active-custom-token', active: true }],
    api_key_makersuite: [{ id: 'active-google', plaintext: 'active-google-token', active: true }],
  };
  if (options.emptySource) secrets[options.emptySource] = [];
  const metadata = () => Object.fromEntries(Object.entries(secrets).filter(([, values]) => values.length)
    .map(([key, values]) => [key, values.map(({ plaintext, ...item }) => ({ ...item, value: '********' }))]));
  let nativeSecretState = metadata();
  const listeners = new Map();
  const eventSource = {
    makeFirst(event, listener) {
      listeners.set(event, [listener, ...(listeners.get(event) || [])]);
    },
    removeListener(event, listener) {
      listeners.set(event, (listeners.get(event) || []).filter(item => item !== listener));
    },
    async emit(event, payload) {
      for (const listener of listeners.get(event) || []) await listener(payload);
    },
  };
  const context = {
    extensionSettings, eventSource,
    eventTypes: { CHAT_COMPLETION_SETTINGS_READY: 'chat_completion_settings_ready' },
    chatCompletionSettings: { openai_max_tokens: 2048, temp_openai: 0.4 },
    getRequestHeaders: () => ({ 'Content-Type': 'application/json', 'X-CSRF-Token': 'test-csrf' }),
    saveSettingsDebounced() { saves.push(plain(extensionSettings)); },
    generateRaw() { throw new Error('Native generateRaw has a different interface'); },
  };
  const store = {
    async tryGetJson(input) {
      reads.push(plain(input));
      if (options.readError) throw options.readError;
      return options.saved || { found: false };
    },
    async setJson(input) { writes.push(plain(input)); },
  };
  const browserStorage = {
    getItem(key) { return Object.hasOwn(old, key) ? old[key] : null; },
    setItem() { throw new Error('Old browser data must remain untouched'); },
    removeItem() { throw new Error('Old browser data must remain untouched'); },
  };
  const response = (data, status = 200) => ({ ok: status < 400, status, json: async () => data });
  const host = {
    localStorage: browserStorage, crypto: webcrypto,
    SillyTavern: { getContext: () => context },
    toastr: { error: message => errors.push(message) },
    async fetch(url, init) {
      assert.equal(this, host, 'native fetch must retain its receiver');
      const body = init?.body ? JSON.parse(init.body) : undefined;
      calls.push({ url, body, headers: init?.headers });
      if (options.respond) {
        const result = await options.respond(url, body);
        if (result) return result;
      }
      if (url === '/api/secrets/read') {
        return response(metadata());
      }
      if (url === '/api/secrets/write') {
        const values = secrets[body.key] || (secrets[body.key] = []);
        for (const item of values) item.active = false;
        const id = body.key + '-' + values.length;
        values.push({ id, plaintext: body.value, active: true });
        return response({ id });
      }
      if (url === '/api/secrets/rotate') {
        for (const item of secrets[body.key]) item.active = item.id === body.id;
        return response({ ok: true });
      }
      if (url === '/api/backends/chat-completions/generate') {
        return response({ choices: [{ message: { content: '连接成功' } }] });
      }
      throw new Error('Unexpected request: ' + url);
    },
  };
  if (options.tauri) host.__TAURITAVERN__ = {
    ready: Promise.resolve(), api: { extension: { store } },
  };
  Object.defineProperty(host, 'TavernHelper', {
    get() { throw new Error('Native extension must not require Tavern Helper'); },
  });
  class GA extends Error { constructor(message, stage) { super(message); this.stage = stage; } }
  const environment = vm.createContext({
    window: host, TextEncoder, Uint8Array, GA,
    HA: value => value.trim(),
    er: source => ({ secretKey: source === 'makersuite' ? 'api_key_makersuite' : 'api_key_custom',
      requiresCustomUrl: source === 'custom' }),
    generateRaw() { throw new Error('No iframe helper exists in a native extension'); },
    console: { error: (...args) => errors.push(args), warn() {}, log() {} },
  });
  let nativeSecretsModule;
  const module = new vm.SourceTextModule(bootstrap + '\n' + secretCode + '\n' +
    'export { localStorage as storage, ttOnSettingsReady, ttGenerateRaw, ec };', {
    context: environment,
    async importModuleDynamically(specifier) {
      assert.equal(options.tauri, undefined, 'TT must use its existing HTTP bridge without module imports');
      assert.equal(specifier, '/scripts/secrets.js');
      imports.push(specifier);
      if (!nativeSecretsModule) {
        nativeSecretsModule = new vm.SyntheticModule(['readSecretState'], function () {
          this.setExport('readSecretState', async () => {
            const result = await host.fetch('/api/secrets/read');
            nativeSecretState = await result.json();
          });
        }, { context: environment });
        await nativeSecretsModule.link(() => { throw new Error('Unexpected secrets import'); });
        await nativeSecretsModule.evaluate();
      }
      return nativeSecretsModule;
    },
  });
  await module.link(() => { throw new Error('Unexpected module import'); });
  await module.evaluate();
  return { api: module.namespace, host, context, store, writes, reads, saves, calls,
    old, browserStorage, extensionSettings, secrets, listeners, errors, imports,
    nativeConnect(secretKey) {
      if (!nativeSecretState[secretKey]) throw new Error('Please enter an API key or select a saved key.');
      return nativeSecretState[secretKey].find(secret => secret.active)?.id;
    } };
}

test('native TT reads the script storage namespace in place and saves there without browser overwrite', async () => {
  const saved = { version: 1, values: { api_configs_manager: '["saved-site"]', api_configs_categories: '["saved-group"]' } };
  const app = await load({ tauri: true, saved: { found: true, value: saved },
    old: { api_configs_manager: '["stale-browser-site"]' },
    extensionSettings: { 'st-api-manager': { version: 1, values: { api_configs_manager: '["other-store"]' } } } });
  assert.deepEqual(app.reads, [entry]);
  assert.equal(app.api.storage.getItem('api_configs_manager'), '["saved-site"]');
  assert.equal(app.writes.length, 0);
  app.api.storage.setItem('api_configs_manager', '["updated-site"]');
  await app.api.flushTauriTavernStorage();
  assert.deepEqual(app.writes, [{ ...entry, value: { version: 1, values: {
    api_configs_manager: '["updated-site"]', api_configs_categories: '["saved-group"]',
  } } }]);
  assert.equal(app.old.api_configs_manager, '["stale-browser-site"]');
  assert.equal(saved.values.api_configs_manager, '["saved-site"]');
  assert.equal(app.saves.length, 0);
  assert.equal(app.host.localStorage, app.browserStorage);
});

test('standard ST loads its existing extension settings and updates that user storage', async () => {
  const app = await load({ old: { api_configs_manager: '["stale-browser-site"]' },
    extensionSettings: { 'st-api-manager': { version: 1, values: { api_configs_manager: '["saved-site"]' } } } });
  assert.equal(app.api.storage.getItem('api_configs_manager'), '["saved-site"]');
  assert.equal(app.saves.length, 0);
  app.api.storage.setItem('api_configs_categories', '["group"]');
  await app.api.flushTauriTavernStorage();
  assert.deepEqual(plain(app.extensionSettings['st-api-manager']), { version: 1, values: {
    api_configs_manager: '["saved-site"]', api_configs_categories: '["group"]',
  } });
  assert.equal(app.saves.length, 1);
  assert.equal(app.reads.length, 0);
  assert.equal(app.writes.length, 0);
  assert.equal(app.old.api_configs_manager, '["stale-browser-site"]');
});

test('standard ST migrates known browser keys once while preserving the original browser values', async () => {
  const old = { api_configs_manager: '["migrated-site"]', api_configs_categories: '["migrated-group"]',
    st_api_manager_sync_metadata_v1: '{"enabled":true}', unrelated_extension: 'leave alone' };
  const app = await load({ old });
  assert.deepEqual(plain(app.extensionSettings['st-api-manager']), { version: 1, values: {
    api_configs_manager: old.api_configs_manager, api_configs_categories: old.api_configs_categories,
    st_api_manager_sync_metadata_v1: old.st_api_manager_sync_metadata_v1,
  } });
  assert.deepEqual(app.old, old);
  assert.equal(app.api.storage.getItem('unrelated_extension'), null);
  assert.equal(app.saves.length, 1);
  app.api.storage.removeItem('api_configs_categories');
  await app.api.flushTauriTavernStorage();
  assert.equal(app.extensionSettings['st-api-manager'].values.api_configs_categories, undefined);
  assert.equal(app.old.api_configs_categories, old.api_configs_categories);
  assert.equal(app.host.localStorage, app.browserStorage);
});

test('a TT storage read error stops initialization before saving migrated browser data', async () => {
  const failure = new Error('TT store unavailable');
  await assert.rejects(load({ tauri: true, readError: failure, old: { api_configs_manager: '["keep"]' } }), failure);
});

test('the native key rotation hook runs before other settings listeners and can be removed', async () => {
  const app = await load();
  const event = app.context.eventTypes.CHAT_COMPLETION_SETTINGS_READY;
  const order = [];
  const payload = { model: 'chosen-model' };
  app.listeners.set(event, [value => { assert.equal(value, payload); order.push('generate'); }]);
  const hook = app.api.ttOnSettingsReady(async value => {
    assert.equal(value, payload);
    order.push('rotate');
  });
  await app.context.eventSource.emit(event, payload);
  assert.deepEqual(order, ['rotate', 'generate']);
  hook.stop();
  order.length = 0;
  await app.context.eventSource.emit(event, payload);
  assert.deepEqual(order, ['generate']);
});

test('standard ST can connect after adding its first key using refreshed native secret metadata', async () => {
  const app = await load({ emptySource: 'api_key_makersuite' });
  assert.throws(() => app.nativeConnect('api_key_makersuite'), /Please enter an API key/);
  const keyItem = { key: 'first-google-token' };
  await app.api.ec(app.context, { source: 'makersuite', name: 'Google' }, keyItem, 'api_key_makersuite', keyItem.key);
  assert.equal(app.nativeConnect('api_key_makersuite'), keyItem.secretId);
  assert.deepEqual(app.imports, ['/scripts/secrets.js']);
});

test('TT secret registration and rotation stay on the host bridge without importing internal modules', async () => {
  const app = await load({ tauri: true });
  assert.equal(await app.api.ttGenerateRaw(generation()), '连接成功');
  assert.deepEqual(app.imports, []);
  assert.equal(app.secrets.api_key_custom.find(secret => secret.active).id, 'active-custom');
});

function generation(source = 'custom') {
  return { ordered_prompts: [{ role: 'system', content: 'Reply briefly.' }, { role: 'user', content: '你好' }],
    custom_api: { source, apiurl: 'https://selected.invalid/v1', key: 'selected-test-token', model: 'selected-model' } };
}

test('native test messages use the selected secret and custom endpoint without changing the active key', async () => {
  const app = await load();
  const config = generation();
  assert.equal(await app.api.ttGenerateRaw(config), '连接成功');
  await app.api.flushTauriTavernStorage();
  const requests = app.calls.filter(call => call.url === '/api/backends/chat-completions/generate');
  assert.equal(requests.length, 1);
  const request = requests[0];
  assert.equal(request.body.chat_completion_source, 'custom');
  assert.equal(request.body.model, config.custom_api.model);
  assert.equal(request.body.custom_url, config.custom_api.apiurl);
  assert.equal(request.body.custom_api_format, 'openai_compat');
  assert.deepEqual(request.body.messages, config.ordered_prompts);
  assert.equal(request.body.stream, false);
  assert.equal(request.headers['X-CSRF-Token'], 'test-csrf');
  assert.equal(app.secrets.api_key_custom.find(secret => secret.id === request.body.secret_id).plaintext, config.custom_api.key);
  assert.equal(app.secrets.api_key_custom.find(secret => secret.active).id, 'active-custom');
  assert.equal('api_key' in request.body, false);
  assert.equal(await app.api.ttGenerateRaw(config), '连接成功');
  assert.equal(app.secrets.api_key_custom.length, 2, 'repeated tests reuse their registered key');
  assert.equal(app.secrets.api_key_custom.find(secret => secret.active).id, 'active-custom');
});

test('native provider test messages retain their source, model and multipart text without a custom URL', async () => {
  const app = await load({ respond: url => url === '/api/backends/chat-completions/generate'
    ? { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: [{ type: 'text', text: '你好' }, { type: 'text', text: '，成功' }] } }] }) }
    : undefined });
  const config = generation('makersuite');
  assert.equal(await app.api.ttGenerateRaw(config), '你好，成功');
  const request = app.calls.find(call => call.url === '/api/backends/chat-completions/generate');
  assert.equal(request.body.chat_completion_source, 'makersuite');
  assert.equal(request.body.model, 'selected-model');
  assert.deepEqual(request.body.messages, config.ordered_prompts);
  assert.equal('custom_url' in request.body, false);
  assert.equal('custom_api_format' in request.body, false);
  assert.equal(app.secrets.api_key_makersuite.find(secret => secret.id === request.body.secret_id).plaintext, config.custom_api.key);
  assert.equal(app.secrets.api_key_makersuite.find(secret => secret.active).id, 'active-google');
});

test('provider authentication errors propagate from the native generation endpoint', async () => {
  const app = await load({ respond: url => url === '/api/backends/chat-completions/generate'
    ? { ok: false, status: 401, json: async () => ({ error: { message: 'Unauthorized: invalid token' } }) }
    : undefined });
  await assert.rejects(app.api.ttGenerateRaw(generation()), /Unauthorized: invalid token/);
  assert.equal(app.secrets.api_key_custom.find(secret => secret.active).id, 'active-custom');
});

test('native HTTP and secret errors are reported rather than returning a successful test message', async () => {
  const app = await load({ respond: url => url === '/api/backends/chat-completions/generate'
    ? { ok: false, status: 502, json: async () => ({}) } : undefined });
  await assert.rejects(app.api.ttGenerateRaw(generation()), /HTTP 502/);
  const secretFailure = await load({ respond: url => url === '/api/secrets/read'
    ? { ok: false, status: 503, json: async () => ({}) } : undefined });
  await assert.rejects(secretFailure.api.ttGenerateRaw(generation()), /读取密钥状态失败.*HTTP 503/);
  assert.equal(secretFailure.calls.some(call => call.url === '/api/backends/chat-completions/generate'), false);
});
