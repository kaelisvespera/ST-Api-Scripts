const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');
const { legacyValues, flatConfigs } = require('./catalog-fixture.cjs');

const root = path.resolve(__dirname, '..');
const prefix = '/scripts/extensions/third-party/ST-Api-Scripts/';
const connection = { source: 'openai', url: 'https://original.invalid/v1', model: 'original-model', activeSecret: 'original-secret', secret_id: 'original-request-secret' };
const legacySnapshot = JSON.stringify({ version: 1, revision: 'legacy-1', configs: [], categories: [] });
const hostStyle = `
  :root{--mainFontSize:15px;--SmartThemeBodyColor:#e5e4df;--SmartThemeBlurTintColor:#27282d;
    --SmartThemeBorderColor:#59575c;--SmartThemeQuoteColor:#d5ba92;--SmartThemeShadowColor:#0007}
  body{font:var(--mainFontSize) system-ui;background:#202226;color:var(--SmartThemeBodyColor)}
  *{box-sizing:border-box}
  .popup{color:var(--SmartThemeBodyColor);background:var(--SmartThemeBlurTintColor);border:1px solid var(--SmartThemeBorderColor);
    border-radius:10px;padding:12px;box-shadow:0 6px 28px var(--SmartThemeShadowColor)}
  .popup-header{margin:0 0 8px}.popup-controls{margin-top:8px}
  .menu_button,.text_pole,select{color:inherit;background:#393a3f;border:1px solid var(--SmartThemeBorderColor);
    border-radius:5px;font:inherit;padding:4px 6px}
  .menu_button{display:inline-flex;align-items:center;justify-content:center;gap:4px;cursor:pointer}
  .inline-drawer-header{display:flex;align-items:center}.flex-container{display:flex}
  .fa-solid:before{content:'·';display:inline-block;width:.9em;text-align:center;font-style:normal}
  .fa-sliders:before,.fa-layer-group:before{content:'☷'}.fa-tags:before{content:'◇'}.fa-tag:before{content:'◇'}
  .fa-filter:before{content:'▽'}.fa-heart-pulse:before{content:'♡'}.fa-database:before{content:'▤'}
  .fa-bolt:before{content:'ϟ'}.fa-pen-to-square:before,.fa-pen:before{content:'✎'}.fa-trash:before{content:'▣'}
  .fa-circle-chevron-up:before{content:'⌃'}.fa-circle-chevron-down:before{content:'⌄'}
  .fa-check:before{content:'✓'}.fa-plus:before{content:'+'}.fa-xmark:before,.fa-times:before{content:'×'}
`;

async function withBrowser(mode, callback) {
  const stores = new Map();
  const accounts = new Map([['st_api_manager_sync_v1', legacySnapshot]]);
  const models = [], unexpected = [], errors = [], secretCalls = [], testCalls = [];
  const held = new Map(), failures = new Set();
  const secrets = new Map(['api_key_openai', 'api_key_custom'].map(type => [type,
    [{ id: 'original-secret', key: 'fixture-original-key', active: true }]]));
  let serial = 0;
  let origin;
  function page(device, iframe) {
    const existing = stores.get(device) || (device === 'one' ? {
      version: 1, values: {
        ...legacyValues, api_configs_manager: JSON.stringify(flatConfigs.map(row => ({
          ...row, customUrl: origin + '/provider/v1',
        }))),
      },
    } : undefined);
    if (existing) stores.set(device, existing);
    return `<!doctype html><html lang="zh"><head><meta charset="utf-8"><style id="host-style">${hostStyle}</style><script src="/jquery.js"></script></head>
      <body><div id="extensionsMenu"></div><section id="openai_settings" hidden>
      <input id="custom_api_url_text" value="${connection.url}"><input id="custom_model_id" value="${connection.model}">
      <select id="main_api"><option value="openai">聊天补全</option></select>
      <select id="chat_completion_source"><option value="openai">OpenAI</option><option value="custom">Custom</option>
      <option value="deepseek">DeepSeek</option><option value="makersuite">Google</option></select>
      <select id="model_custom_select"><option value="original-model">original-model</option></select>
      <select id="model_openai_select"><option value="original-model">original-model</option></select>
      <input id="api_key_custom" value=""><button id="api_button_openai">连接</button></section>
      <script>
        const device = ${JSON.stringify(device)};
        const mode = ${JSON.stringify(mode)};
        window.hostConnection = ${JSON.stringify(connection)};
        window.connectionTouches = [];
        window.nativeRequests = [];
        window.secretState = { api_key_custom: [{ id:'original-secret', active:true }], api_key_openai: [{ id:'original-secret', active:true }] };
        window.fixtureReadNativeSecrets = async () => {
          secretState = await (await fetch('/api/secrets/read',{method:'POST'})).json();
        };
        const settings = {
          chat_completion_source:hostConnection.source, custom_url:hostConnection.url,
          custom_model:hostConnection.model, openai_model:hostConnection.model,
        };
        const listeners = [];
        window.fixtureEmit = async payload => {
          for (const listener of listeners) await listener(payload);
          return payload;
        };
        for (const el of document.querySelectorAll('#custom_api_url_text,#custom_model_id,#api_button_openai,#chat_completion_source,#model_custom_select')) {
          $(el).on('change input click', () => connectionTouches.push(el.id));
        }
        const source = document.getElementById('chat_completion_source');
        const dropdown = document.getElementById('model_custom_select');
        $(dropdown).on('change', async () => {
          const model = dropdown.value;
          await Promise.resolve();
          settings.custom_model = model;
          document.getElementById('custom_model_id').value = model;
        });
        async function connect() {
          if (mode === 'tt') await fixtureReadNativeSecrets();
          else await Promise.resolve();
          const active = secretState['api_key_' + settings.chat_completion_source]?.find(item => item.active);
          Object.assign(hostConnection, { source:settings.chat_completion_source, url:settings.custom_url,
            model:settings.chat_completion_source === 'custom' ? settings.custom_model : settings.openai_model,
            activeSecret:active?.id, secret_id:active?.id });
          nativeRequests.push({...hostConnection});
        }
        $(source).on('change', () => {
          settings.chat_completion_source = source.value;
          $(dropdown).trigger('change');
          void connect();
        });
        $('#api_button_openai').on('click', connect);
        const store = () => '/fixture/store?device=' + device;
        const write = (url, body) => fetch(url, { method:'POST', body:JSON.stringify(body) }).then(response => {
          if (!response.ok) throw Error('Fixture write failed');
        });
        window.settingsSave = Promise.resolve();
        const extensionSettings = ${JSON.stringify(existing ? { 'st-api-manager': existing } : {})};
        const context = {
          extensionSettings,
          saveSettingsDebounced() {
            if (mode === 'st') settingsSave = write(store(), extensionSettings['st-api-manager']);
          },
          accountStorage: {
            async getItem(key) { return (await fetch('/fixture/account?key=' + key)).json(); },
            setItem(key,value) { return write('/fixture/account?key=' + key,value); },
          },
          registerSlashCommand(name,callback) { window.runSlash = callback; },
          mainApi: 'openai',
          get chatCompletionSettings() { connectionTouches.push('chat settings'); return settings; },
          eventTypes: { CHAT_COMPLETION_SETTINGS_READY: 'settings-ready' },
          eventSource: { makeFirst(event, callback) {
            if(event !== 'settings-ready') throw Error('Unexpected listener');
            listeners.unshift(callback);
          } },
          get generateRaw() { connectionTouches.push('generation'); throw Error('Unexpected generation'); },
        };
        window.SillyTavern = { getContext:() => context };
        if (mode === 'tt') window.__TAURITAVERN__ = { ready: Promise.resolve(), api: { extension: { store: {
          async tryGetJson({namespace,key}) {
            if (namespace !== 'st-api-manager' || key !== 'state') throw Error('Incorrect namespace');
            const value = await (await fetch(store())).json();
            return { found: value !== null, value };
          },
          async setJson({ namespace,key,value }) {
            if (namespace !== 'st-api-manager' || key !== 'state') throw Error('Incorrect namespace');
            await write(store(),value);
          },
        } } } };
      </script>
      ${iframe ? '<iframe src="/frame?proxy=1" title="helper fixture"></iframe>' : `<script type="module">
        const base = ${JSON.stringify(prefix)};
        const manifest = await (await fetch(base + 'manifest.json')).json();
        try { window.manager = await import(base + manifest.js); }
        catch (error) { window.moduleError = error.stack; throw error; }
      </script>`}</body></html>`;
  }
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    const reply = (body, type = 'application/json', status = 200) => {
      response.writeHead(status, { 'content-type': type });
      response.end(body);
    };
    const json = (body, status) => reply(JSON.stringify(body), 'application/json', status);
    if (url.pathname === '/') return reply(page(url.searchParams.get('device') || 'one', url.searchParams.has('iframe')), 'text/html; charset=utf-8');
    if (url.pathname === '/frame') return reply(`<!doctype html><script type="module">
      const original = window.parent;
      if (location.search.includes('proxy')) Object.defineProperty(window,'parent',{value:new Proxy(original,{
        get(target,key) { const value = Reflect.get(target,key,target); return typeof value === 'function' ? value.bind(target) : value; }
      })});
      Object.defineProperty(window,'SillyTavern',{get:() => original.SillyTavern});
      try {
        const manager = await import('/compat.js');
        await manager.flushTauriTavernStorage();
        original.frameResult = { preserved: !Object.getOwnPropertyDescriptor(window,'SillyTavern').set };
      } catch (error) { original.frameResult = { error: error.stack }; throw error; }
    </script>`, 'text/html; charset=utf-8');
    const file = new Map([
      ['/jquery.js', ['tests/fixtures/jquery-3.5.1.min.js', 'text/javascript']],
      [prefix + 'manifest.json', ['manifest.json', 'application/json']],
      [prefix + 'index.js', ['index.js', 'text/javascript']],
      ['/compat.js', ['ST-ApiManager/index-2.1.1-tt2.4.js', 'text/javascript']],
    ]).get(url.pathname);
    if (file) return reply(fs.readFileSync(path.join(root, file[0])), file[1]);
    if (url.pathname === '/scripts/secrets.js') {
      if (mode !== 'st') unexpected.push(url.pathname);
      return reply('export async function readSecretState(){await window.fixtureReadNativeSecrets();}', 'text/javascript');
    }
    if (url.pathname.startsWith('/api/secrets/')) {
      const action = url.pathname.split('/').pop();
      let text = '';
      for await (const chunk of request) text += chunk.toString();
      const body = text ? JSON.parse(text) : {};
      secretCalls.push({ action, ...body });
      if (action === 'read') {
        return json(Object.fromEntries([...secrets].map(([type, entries]) =>
          [type, entries.map(({ id, active }) => ({ id, active, value: '••••' }))])));
      }
      if (!secrets.has(body.key)) secrets.set(body.key, []);
      const entries = secrets.get(body.key);
      if (action === 'write') {
        for (const entry of entries) entry.active = false;
        const id = 'fixture-secret-' + (++serial);
        entries.push({ id, key: body.value, active: true });
        return json({ id });
      }
      if (action === 'rotate' && entries.some(entry => entry.id === body.id)) {
        for (const entry of entries) entry.active = entry.id === body.id;
        return json({});
      }
    }
    if (url.pathname === '/fixture/store' || url.pathname === '/fixture/account') {
      const isStore = url.pathname.endsWith('/store');
      const map = isStore ? stores : accounts;
      const key = url.searchParams.get(isStore ? 'device' : 'key');
      if (request.method === 'POST') {
        try {
          const chunks = [];
          for await (const chunk of request) chunks.push(chunk);
          map.set(key, JSON.parse(Buffer.concat(chunks).toString('utf8')));
        } catch {
          unexpected.push(url.pathname + ' (invalid fixture write)');
          return json({ error: true }, 400);
        }
      }
      return json(map.get(key) ?? null);
    }
    if (url.pathname === '/provider/v1/models') {
      const { authorization, cookie } = request.headers;
      models.push({ method: request.method, path: url.pathname, authorization, cookie });
      const credential = authorization?.replace(/^Bearer /, '');
      if (held.has(credential)) {
        const gate = held.get(credential);
        held.delete(credential);
        gate.arrive();
        await gate.untilReleased;
      }
      if (failures.delete(credential)) return json({ error: true }, 401);
      if (authorization === 'Bearer fixture-key-a') return json({ data: [{ id: 'available-for-a' }] });
      if (authorization === 'Bearer fixture-key-b') return json({ data: [{ id: 'available-for-b' }] });
      if (credential === 'fixture-new-a') return json({ data: [{ id: 'shared-model' }, { id: 'second-shared' }, { id: 'only-a' }] });
      if (credential === 'fixture-new-b') return json({ data: [{ id: 'shared-model' }, { id: 'second-shared' }, { id: 'only-b' }] });
      return json({ error: true }, 401);
    }
    if (url.pathname === '/provider/v1/chat/completions' && request.method === 'POST') {
      let body = '';
      for await (const chunk of request) body += chunk.toString();
      testCalls.push({ authorization: request.headers.authorization, cookie: request.headers.cookie, body: JSON.parse(body) });
      return json({ choices: [{ message: { content: '连接成功' } }] });
    }
    if (url.pathname === '/favicon.ico') return reply('', 'text/plain', 204);
    unexpected.push(url.pathname);
    return json({ error: true }, 404);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = 'http://127.0.0.1:' + server.address().port;
  let browser;
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const tab = await browser.newPage({ viewport: { width: 390, height: 844 } });
    tab.setDefaultTimeout(7000);
    tab.on('pageerror', error => errors.push(error.message));
    await tab.route(url => url.protocol.startsWith('http') && url.origin !== origin, route => route.abort());
    await tab.context().addCookies([{ name: 'fixture-session', value: 'test', url: origin }]);
    const open = async (query = '') => {
      await tab.goto(origin + '/' + query, { waitUntil: 'networkidle' });
      if (query.includes('iframe')) {
        await tab.waitForFunction(() => window.frameResult);
        assert.deepEqual(await tab.evaluate(() => window.frameResult), { preserved: true });
      } else {
        await tab.waitForFunction(() => window.manager || window.moduleError);
        assert.equal(await tab.evaluate(() => window.moduleError), undefined);
      }
      await tab.locator('#st-api-manager-extension-button').click();
      await tab.getByRole('dialog', { name: 'API 管理器' }).waitFor();
    };
    const flush = async () => tab.evaluate(async () => {
      await window.manager?.flushTauriTavernStorage();
      await window.settingsSave;
    });
    const assertConnection = async () => {
      assert.deepEqual(await tab.evaluate(() => window.hostConnection), connection);
      assert.deepEqual(await tab.evaluate(() => window.connectionTouches), []);
      assert.equal(await tab.locator('#custom_api_url_text').inputValue(), connection.url);
      assert.equal(await tab.locator('#custom_model_id').inputValue(), connection.model);
      assert.deepEqual(secretCalls, []);
    };
    const holdNextModels = credential => {
      let arrive, release;
      const arrived = new Promise(resolve => { arrive = resolve; });
      const untilReleased = new Promise(resolve => { release = resolve; });
      held.set(credential, { arrive, untilReleased });
      return { arrived, release };
    };
    await callback({ tab, open, flush, assertConnection, stores, accounts, models, legacySnapshot, origin,
      secretCalls, secrets, testCalls, holdNextModels, failNextModels: credential => failures.add(credential) });
    assert.deepEqual(unexpected, [], 'host secrets, model status and generation routes must never be used');
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
}

module.exports = { withBrowser, hostStyle };
