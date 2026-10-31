const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');

// The fixture preserves TT's real connection handler and status-body builder.
// Only their external UI, persistence and HTTP dependencies are supplied below.
const native = fs.readFileSync(path.join(__dirname, 'fixtures/tt-openai-native.js'), 'utf8');
const bundle = fs.readFileSync(path.join(__dirname, '../ST-ApiManager/index-2.1.1-tt2.4.js'), 'utf8');
const secrets = bundle.slice(bundle.indexOf('async function ttSecretRequest('), bundle.indexOf('class GA', bundle.indexOf('async function ttSecretRequest(')));
const writer = bundle.slice(bundle.indexOf('async function Ac('), bundle.indexOf('function cc(', bundle.indexOf('async function Ac(')));
for (const name of ['JA', 'WA', 'QA']) {
  assert.equal(bundle.split('async function ' + name + '(').length - 1, 1, 'exactly one delivered secret transport: ' + name);
}
assert.equal(bundle.includes("import('/scripts/secrets.js')"), false);
assert.equal(bundle.includes('ttImportHostModule'), false);

function createApp() {
  const database = [{ id: 'old-native-id', plaintext: 'old-native-token', active: true }];
  const storage = new Map();
  const requests = [], secretReads = [], errors = [], pending = [];
  const settings = { chat_completion_source: 'custom', custom_url: 'https://old.invalid/v1',
    custom_model: 'old-model', custom_api_format: 'claude_messages', reverse_proxy: '', proxy_password: '' };
  const modelDropdown = { value: settings.custom_model, tagName: 'SELECT', options: [{ value: settings.custom_model }] };
  const nodes = new Map([
    ['#main_api', { value: 'openai' }],
    ['#chat_completion_source', { value: 'custom' }],
    ['#custom_api_url_text', { value: settings.custom_url }],
    ['#custom_model_id', { value: settings.custom_model, tagName: 'INPUT' }],
    ['#api_key_custom', { value: 'unfinished-native-input' }],
    ['#model_custom_select', modelDropdown],
    ['.model_custom_select', modelDropdown],
  ]);
  let sequence = 0;
  let environment;
  const metadata = () => ({ api_key_custom: database.map(({ plaintext, ...item }) =>
    ({ ...item, value: '************' })) });
  const response = data => ({ ok: true, status: 200, json: async () => data });
  async function fetch(url, options = {}) {
    const body = options.body ? JSON.parse(options.body) : undefined;
    if (url === '/api/secrets/read') {
      secretReads.push(++sequence);
      return response(metadata());
    }
    if (url === '/api/secrets/write') {
      assert.equal(body.key, 'api_key_custom');
      for (const item of database) item.active = false;
      const id = 'native-id-' + database.length;
      database.push({ id, plaintext: body.value, label: body.label, active: true });
      return response({ id });
    }
    if (url === '/api/secrets/rotate') {
      assert.equal(body.key, 'api_key_custom');
      assert.ok(database.some(item => item.id === body.id), 'rotation must name an existing key');
      for (const item of database) item.active = item.id === body.id;
      return response({ ok: true });
    }
    if (url === '/api/backends/chat-completions/status') {
      const item = database.find(secret => secret.id === body.secret_id);
      requests.push({ body, token: item?.plaintext, model: settings.custom_model,
        fieldModel: nodes.get('#custom_model_id').value, sequence: ++sequence });
      return response({ data: [] });
    }
    throw new Error('Unexpected request: ' + url);
  }
  function connect() {
    const task = environment.onConnectButtonClick({ stopPropagation() {} });
    pending.push(task);
    return task;
  }
  nodes.set('#api_button_openai', { disabled: false, click: connect });
  function $(selector) {
    const node = typeof selector === 'object' ? selector : nodes.get(selector);
    return {
      0: node, length: node ? 1 : 0,
      val(value) {
        if (arguments.length) { if (node) node.value = value; return this; }
        return node?.value;
      },
      text(value) { if (node) node.text = value; return this; },
      first() { return this; },
      prop(name) { return node?.[name]; },
      empty() { if (node) node.options = []; return this; },
      find() { return { toArray: () => node?.options || [] }; },
      append(option) { node.options.push({ value: option.val() }); return this; },
      trigger(event) {
        // TT's source change queues both its async model change and native
        // connect. The dropdown value is captured before the model handler yields.
        if (selector === '#chat_completion_source' && event === 'change') {
          settings.chat_completion_source = node.value;
          $('#model_custom_select').trigger('change');
          connect();
        }
        if (selector === '#model_custom_select' && event === 'change') {
          const selectedModel = node.value;
          pending.push(Promise.resolve().then(() => {
            if (selectedModel) {
              settings.custom_model = selectedModel;
              $('#custom_model_id').val(selectedModel).trigger('input');
            }
          }));
        }
        if (selector === '#custom_api_url_text' && event === 'input') settings.custom_url = node.value;
        if (selector === '#custom_model_id' && (event === 'input' || event === 'change')) settings.custom_model = node.value;
        return this;
      },
    };
  }
  const context = { mainApi: 'openai', chatCompletionSettings: settings,
    getRequestHeaders: () => ({ 'Content-Type': 'application/json' }), saveSettingsDebounced() {} };
  const host = { $: selector => selector === '<option></option>' ? $({ tagName: 'OPTION' }) : $(selector),
    SillyTavern: { getContext: () => context }, crypto: webcrypto, fetch,
    location: { href: 'https://tt.invalid/' }, toastr: { warning() {}, error: message => errors.push(message) } };
  Object.defineProperty(host, 'Function', { get() { throw new Error('Host module import must not be used'); } });
  Object.defineProperty(host.SillyTavern, 'secrets', { get() { throw new Error('Native secrets module import must not be used'); } });
  const names = new Proxy({}, { get: (_, name) => String(name).toLowerCase() });
  const keyNames = new Proxy({}, { get: (_, name) => 'api_key_' + String(name).toLowerCase() });
  class GA extends Error { constructor(message, stage) { super(message); this.stage = stage; } }
  environment = vm.createContext({
    window: { parent: host }, ttHost: host, fetch, TextEncoder, Uint8Array, URL, GA,
    oai_settings: settings, secret_state: metadata(),
    $: host.$, chat_completion_sources: names, SECRET_KEYS: keyNames,
    POLLINATIONS_ENDPOINT: { ANONYMOUS: 'anonymous' },
    abortStatusCheck: { signal: new AbortController().signal },
    localStorage: { getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, String(value)) },
    HA: value => value.trim(),
    er: () => ({ secretKey: 'api_key_custom', requiresCustomUrl: true,
      keyInputSelector: '#api_key_custom', modelSettingKey: 'custom_model',
      stateModelKeys: ['custom_model'], modelInputSelector: '#custom_model_id', modelListSelector: '#model_custom_select' }),
    getRequestHeaders: context.getRequestHeaders,
    async readSecretState() {
      const result = await fetch('/api/secrets/read');
      environment.secret_state = await result.json();
    },
    async writeSecret() { throw new Error('Native connect must not save an unintended input value'); },
    resolveSecretKey: () => 'api_key_custom',
    isConnectionValidationSuspended: () => false,
    resultCheckStatus() {}, startStatusLoading() {}, setOnlineStatus() {},
    updateFeatureSupportFlags() {}, saveSettingsDebounced: context.saveSettingsDebounced,
    saveModelList() {}, applyAdditionalParametersToRequest() {},
    isValidUrl: value => { try { return Boolean(new URL(value)); } catch { return false; } },
    isVertexAiClaudeModelId: () => false,
    t: (parts, ...values) => parts.reduce((text, part, index) => text + part + (values[index] ?? ''), ''),
    toUserFacingErrorText: error => error.message || String(error),
    toastr: host.toastr,
    console: { debug() {}, error: error => errors.push(error.message || String(error)) },
  });
  vm.runInContext(native + '\n' + secrets + '\n' + writer, environment, {
    filename: 'native-connection-chain.js',
    importModuleDynamically() { throw new Error('Native module import must not be used'); },
  });
  return { database, requests, errors, nodes, settings, secretReads,
    apply: (config, options) => environment.Ac(config, options),
    async settle() { for (let index = 0; index < pending.length; index++) await pending[index]; } };
}

function config(site) {
  return { source: 'custom', name: site, customUrl: 'https://' + site + '.invalid/v1',
    customModel: site + '-model' };
}

test('real TT connect refreshes native secrets before building each cross-site status request', async () => {
  const app = createApp();
  const firstKey = { key: 'first-token', secretId: 'old-native-id' };
  const secondKey = { key: 'second-token', secretId: 'old-native-id' };
  for (const [site, keyItem] of [['first', firstKey], ['second', secondKey], ['first', firstKey]]) {
    const before = app.requests.length;
    const beforeReads = app.secretReads.length;
    await app.apply(config(site), { apiKey: keyItem.key, keyItem });
    await app.settle();
    assert.deepEqual(app.errors, []);
    assert.equal(app.requests.length, before + 1, 'one source switch must issue exactly one native status request');
    assert.ok(app.secretReads.length >= beforeReads + 2, 'registration and native connect must both refresh metadata');
    const request = app.requests.at(-1);
    assert.equal(request.body.custom_url, config(site).customUrl);
    assert.equal(request.body.secret_id, keyItem.secretId);
    assert.equal(request.body.custom_api_format, 'openai_compat');
    assert.equal(request.token, keyItem.key, 'resolve the exact secret_id sent by real getStatusOpen');
    assert.equal(request.model, config(site).customModel);
    assert.equal(request.fieldModel, config(site).customModel);
    assert.equal(app.nodes.get('#model_custom_select').value, config(site).customModel);
    assert.ok(app.secretReads.at(-1) < request.sequence);
    assert.equal(app.nodes.get('#api_key_custom').value, '');
  }
  assert.notEqual(firstKey.secretId, 'old-native-id');
  assert.notEqual(secondKey.secretId, 'old-native-id');
  assert.equal(app.database.length, 3, 'switching back must reuse its verified key binding');
  assert.equal(app.requests.some(request => request.token === 'old-native-token'), false);
});

test('native button fallback uses the same refreshed state when the source control is absent', async () => {
  const app = createApp();
  app.nodes.delete('#chat_completion_source');
  const keyItem = { key: 'fallback-token', secretId: 'old-native-id' };
  await app.apply(config('fallback'), { apiKey: keyItem.key, keyItem });
  await app.settle();
  assert.deepEqual(app.errors, []);
  assert.equal(app.requests.length, 1);
  assert.equal(app.requests[0].token, keyItem.key);
  assert.equal(app.requests[0].body.secret_id, keyItem.secretId);
  assert.equal(app.requests[0].body.custom_url, config('fallback').customUrl);
});

test('silent application registers the selected token without starting native connection', async () => {
  const app = createApp();
  const keyItem = { key: 'silent-token', secretId: 'old-native-id' };
  await app.apply(config('silent'), { apiKey: keyItem.key, keyItem, triggerConnect: false });
  await app.settle();
  assert.deepEqual(app.errors, []);
  assert.equal(app.requests.length, 0);
  assert.equal(app.settings.custom_model, 'silent-model');
  assert.equal(app.database.find(secret => secret.active).plaintext, keyItem.key);
});
