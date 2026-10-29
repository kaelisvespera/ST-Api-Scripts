const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const bootstrap = fs.readFileSync(path.join(__dirname, '../src/tt-bootstrap.js'), 'utf8');
const bundle = fs.readFileSync(path.join(__dirname, '../ST-ApiManager/index-2.1.1-tt2.4.js'), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}
function extract(start, end) {
    const first = bundle.indexOf(start);
    const last = bundle.indexOf(end, first);
    assert.ok(first >= 0 && last > first, `Missing bundle function: ${start}`);
    return bundle.slice(first, last);
}

async function load(options = {}) {
    const writes = [], toasts = [], errors = [], imports = [], frameImports = [], reads = [], calls = [];
    const old = options.old || {};
    const store = {
        async tryGetJson(entry) {
            reads.push(plain(entry));
            if (options.readError) throw options.readError;
            return options.saved || { found: false };
        },
        async setJson(entry) {
            writes.push(plain(entry));
            if (options.setJson) await options.setJson(entry, writes.length);
        },
    };
    const host = {
        __TAURITAVERN__: { ready: options.ready || Promise.resolve(), api: { extension: { store } } },
        location: { href: 'tauri://localhost/index.html' },
        fetch(url, init) {
            assert.equal(this, host, 'host fetch must retain its receiver');
            calls.push({ url, init });
            return options.fetchResult || Promise.resolve({ ok: true, json: async () => ({ data: [{ id: 'model-one' }] }) });
        },
        toastr: { error: message => toasts.push(message) },
        SillyTavern: { getContext: () => options.hostContext || {} },
        TavernHelper: options.helper,
    };
    const frame = {
        parent: host,
        localStorage: {
            getItem(key) { return Object.hasOwn(old, key) ? old[key] : null; },
            setItem() { throw new Error('Old browser data must remain untouched'); },
            removeItem() { throw new Error('Old browser data must remain untouched'); },
        },
    };
    const context = vm.createContext({
        window: frame, URL,
        console: { error: (...args) => errors.push(args), warn() {}, log() {} },
        ...(options.globals || {}),
    });
    host.Function = () => { throw new Error('Do not construct a host module importer'); };
    const module = new vm.SourceTextModule(bootstrap + '\n' + (options.extra || '') + '\n' +
        'export { localStorage as storage, fetch as hostFetch, ttPopupApi, ttGenerateRaw };', {
        context,
        async importModuleDynamically(specifier) {
            frameImports.push(specifier);
            throw new Error('Host modules must not load in the iframe realm');
        },
    });
    await module.link(() => { throw new Error('Unexpected static import'); });
    const evaluation = module.evaluate();
    if (!options.deferEvaluate) await evaluation;
    return { module, evaluation, api: module.namespace, host, frame, store, writes, toasts, errors, imports, frameImports, reads, calls };
}

test('loads TT state before readers and leaves old browser state intact', async () => {
    const app = await load({
        saved: { found: true, value: { version: 1, values: { api_configs_manager: '["saved"]' } } },
        old: { api_configs_manager: '["old"]' },
    });
    assert.equal(app.api.storage.getItem('api_configs_manager'), '["saved"]');
    assert.equal(app.api.storage.getItem('missing'), null);
    assert.deepEqual(app.reads, [{ namespace: 'st-api-manager', key: 'state' }]);
    assert.equal(app.writes.length, 0);
});

test('migrates known browser keys only when TT explicitly has no state', async () => {
    const app = await load({ old: {
        api_configs_manager: '["migrated"]',
        st_api_manager_sync_metadata_v1: '{"enabled":true}',
        unrelated: 'private-other-extension-value',
    } });
    assert.equal(app.writes.length, 1);
    assert.deepEqual(app.writes[0].value, { version: 1, values: {
        api_configs_manager: '["migrated"]',
        st_api_manager_sync_metadata_v1: '{"enabled":true}',
    } });
    assert.equal(app.api.storage.getItem('unrelated'), null);
});

test('does not create an empty state during first load', async () => {
    const app = await load();
    assert.equal(app.writes.length, 0);
});

test('read failure stops initialization without overwriting stored data', async () => {
    const failure = new Error('TT store unavailable');
    let writes = 0;
    await assert.rejects(load({ readError: failure, old: { api_configs_manager: '["keep"]' }, setJson() { writes++; } }), failure);
    assert.equal(writes, 0);
});

test('waits for host readiness before reading the store', async () => {
    const ready = deferred();
    const app = await load({ ready: ready.promise, deferEvaluate: true });
    assert.equal(app.reads.length, 0);
    ready.resolve();
    await app.evaluation;
    assert.equal(app.reads.length, 1);
});

test('serializes immutable snapshots while keeping synchronous reads current', async () => {
    const first = deferred();
    const app = await load({ setJson: (_entry, number) => number === 1 ? first.promise : undefined });
    app.api.storage.setItem('key', 1);
    app.api.storage.setItem('key', 2);
    app.api.storage.setItem('other', 'value');
    app.api.storage.removeItem('key');
    await tick();
    assert.equal(app.writes.length, 1, 'second disk write must wait for first');
    assert.equal(app.api.storage.getItem('key'), null);
    assert.equal(app.api.storage.getItem('other'), 'value');
    assert.deepEqual(app.writes[0].value.values, { key: '1' });
    first.resolve();
    await app.api.flushTauriTavernStorage();
    assert.deepEqual(app.writes.map(entry => entry.value.values), [
        { key: '1' }, { key: '2' }, { key: '2', other: 'value' }, { other: 'value' },
    ]);
});

test('reports a failed disk write and permits the next save to recover', async () => {
    const failure = new Error('disk write failed');
    const app = await load({ setJson: (_entry, number) => { if (number === 1) throw failure; } });
    app.api.storage.setItem('key', 'kept in memory');
    await assert.rejects(app.api.flushTauriTavernStorage(), failure);
    assert.equal(app.toasts.length, 1);
    assert.match(app.toasts[0], /保存失败/);
    assert.equal(app.errors.length, 1);
    assert.equal(app.api.storage.getItem('key'), 'kept in memory');
    app.api.storage.setItem('next', 'saved');
    await app.api.flushTauriTavernStorage();
    assert.equal(app.writes.length, 2);
    assert.deepEqual(app.writes[1].value.values, { key: 'kept in memory', next: 'saved' });
});

test('forwards requests through bound parent fetch', async () => {
    const app = await load();
    const options = { method: 'POST', body: '{}' };
    await app.api.hostFetch('/api/secrets/read', options);
    assert.equal(app.calls.length, 1);
    assert.equal(app.calls[0].url, '/api/secrets/read');
    assert.equal(app.calls[0].init, options);
});

test('prefers public host context Popup API', async () => {
    const Popup = { show: { confirm: () => 1 } };
    const POPUP_RESULT = { AFFIRMATIVE: 1 };
    const app = await load({ hostContext: { Popup, POPUP_RESULT } });
    const popup = await app.api.ttPopupApi();
    assert.equal(popup.Popup, Popup);
    assert.equal(popup.POPUP_RESULT, POPUP_RESULT);
    assert.deepEqual(app.imports, []);
});

test('missing public popup fails without importing any native module', async () => {
    const app = await load();
    await assert.rejects(app.api.ttPopupApi(), /未提供已初始化的弹窗接口/);
    assert.deepEqual(app.imports, []);
    assert.deepEqual(app.frameImports, []);
});

test('uses injected Tavern Helper generateRaw and preserves its parameters', async () => {
    let received;
    const app = await load({ globals: { generateRaw(config) { received = config; return 'helper result'; } },
        hostContext: { generateRaw() { throw new Error('Wrong SillyTavern function'); } } });
    const config = { ordered_prompts: [{ role: 'user', content: '你好' }], custom_api: { apiurl: 'https://example.invalid/v1', key: 'fake-key', model: 'test-model' } };
    assert.equal(await app.api.ttGenerateRaw(config), 'helper result');
    assert.equal(received, config);
});

test('uses host TavernHelper generateRaw with correct receiver when no frame injection exists', async () => {
    const helper = { generateRaw(config) { assert.equal(this, helper); return config.model; } };
    const app = await load({ helper });
    assert.equal(app.api.ttGenerateRaw({ model: 'host-helper' }), 'host-helper');
});

test('missing helper fails explicitly instead of calling incompatible SillyTavern generateRaw', async () => {
    const app = await load({ hostContext: { generateRaw() { throw new Error('Wrong function'); } } });
    assert.throws(() => app.api.ttGenerateRaw({}), /找不到酒馆助手 generateRaw/);
});

test('patched bundle test message forwards custom endpoint, key, source and model to helper', async () => {
    let received;
    const extra = extract('async function yr(', 'let xr=null;') + '\nexport { yr };';
    const app = await load({ extra, globals: {
        generateRaw(config) { received = plain(config); return ' 连接成功 '; },
        tr: () => ({ isSupported: true }), cr: Error,
    } });
    assert.equal(await app.api.yr({ url: 'https://example.invalid/v1', key: 'fake-key', source: 'custom', model: 'test-model' }), '连接成功');
    assert.deepEqual(received.custom_api, { apiurl: 'https://example.invalid/v1', key: 'fake-key', source: 'custom', model: 'test-model' });
    assert.equal(received.max_chat_history, 0);
    assert.deepEqual(received.ordered_prompts.map(prompt => prompt.role), ['system', 'user']);
});

test('patched bundle model status request declares TT OpenAI-compatible wire format', async () => {
    let request;
    const extra = extract('async function Cr(', 'async function fr(') + '\nexport { Cr };';
    const app = await load({ extra, hostContext: {
        chatCompletionSettings: { reverse_proxy: '', proxy_password: '' },
        getRequestHeaders: () => ({ 'Content-Type': 'application/json' }),
    }, globals: {
        async ur(url, init) { request = { url, ...plain(init) }; return { ok: true, json: async () => ({ models: ['model-one'] }) }; },
        Ar: () => ({ baseUrl: 'https://example.invalid/v1' }),
        gr: value => value.models,
        cr: Error,
    } });
    assert.deepEqual(plain(await app.api.Cr('https://example.invalid/v1', 'fake-key')), ['model-one']);
    assert.equal(request.url, '/api/backends/chat-completions/status');
    assert.equal(request.method, 'POST');
    const body = JSON.parse(request.body);
    assert.equal(body.custom_api_format, 'openai_compat');
    assert.equal(body.custom_url, 'https://example.invalid/v1');
    assert.deepEqual(JSON.parse(body.custom_include_headers), { Authorization: 'Bearer fake-key' });
});

test('initialization never constructs or imports native host modules', async () => {
    const app = await load();
    assert.deepEqual(app.imports, []);
    assert.deepEqual(app.frameImports, []);
});
