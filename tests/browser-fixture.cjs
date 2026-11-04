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

async function withBrowser(mode, callback) {
  const stores = new Map();
  const accounts = new Map([['st_api_manager_sync_v1', legacySnapshot]]);
  const models = [], unexpected = [], errors = [];
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
    return `<!doctype html><html lang="zh"><head><meta charset="utf-8"><style id="host-style">body{font:16px system-ui}</style></head>
      <body><div id="extensionsMenu"></div><section id="openai_settings">
      <input id="host-url" value="${connection.url}"><input id="host-model" value="${connection.model}">
      <button id="connect">连接</button></section>
      <script>
        const device = ${JSON.stringify(device)};
        const mode = ${JSON.stringify(mode)};
        window.hostConnection = ${JSON.stringify(connection)};
        window.connectionTouches = [];
        for (const el of document.querySelectorAll('#host-url,#host-model,#connect')) {
          for (const event of ['change','input','click']) el.addEventListener(event, () => connectionTouches.push(el.id));
        }
        const store = () => '/fixture/store?device=' + device;
        const write = (url, body) => fetch(url, { method:'POST', body:JSON.stringify(body) }).then(response => {
          if (!response.ok) throw Error('Fixture write failed');
        });
        window.settingsSave = Promise.resolve();
        const extensionSettings = ${JSON.stringify(existing ? { 'st-api-manager': existing } : {})};
        const context = {
          extensionSettings,
          saveSettingsDebounced() {
            settingsSave = write(store(), extensionSettings['st-api-manager']);
          },
          accountStorage: {
            async getItem(key) { return (await fetch('/fixture/account?key=' + key)).json(); },
            setItem(key,value) { return write('/fixture/account?key=' + key,value); },
          },
          registerSlashCommand(name,callback) { window.runSlash = callback; },
          get chatCompletionSettings() { connectionTouches.push('chat settings'); throw Error('Unexpected settings access'); },
          get eventSource() { connectionTouches.push('chat hook'); throw Error('Unexpected event registration'); },
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
      [prefix + 'manifest.json', ['manifest.json', 'application/json']],
      [prefix + 'index.js', ['index.js', 'text/javascript']],
      ['/compat.js', ['ST-ApiManager/index-2.1.1-tt2.4.js', 'text/javascript']],
    ]).get(url.pathname);
    if (file) return reply(fs.readFileSync(path.join(root, file[0])), file[1]);
    if (url.pathname === '/fixture/store' || url.pathname === '/fixture/account') {
      const isStore = url.pathname.endsWith('/store');
      const map = isStore ? stores : accounts;
      const key = url.searchParams.get(isStore ? 'device' : 'key');
      if (request.method === 'POST') {
        let body = '';
        for await (const chunk of request) body += chunk.toString();
        map.set(key, JSON.parse(body));
      }
      return json(map.get(key) ?? null);
    }
    if (url.pathname === '/provider/v1/models') {
      const { authorization, cookie } = request.headers;
      models.push({ method: request.method, path: url.pathname, authorization, cookie });
      if (authorization === 'Bearer fixture-key-a') return json({ data: [{ id: 'available-for-a' }] });
      if (authorization === 'Bearer fixture-key-b') return json({ data: [{ id: 'available-for-b' }] });
      return json({ error: true }, 401);
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
    tab.on('pageerror', error => errors.push(error.message));
    await tab.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
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
      assert.equal(await tab.locator('#host-url').inputValue(), connection.url);
      assert.equal(await tab.locator('#host-model').inputValue(), connection.model);
    };
    await callback({ tab, open, flush, assertConnection, stores, accounts, models, legacySnapshot, origin });
    assert.deepEqual(unexpected, [], 'host secrets, model status and generation routes must never be used');
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
}

module.exports = { withBrowser };
