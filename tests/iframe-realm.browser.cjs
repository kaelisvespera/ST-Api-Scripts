// Optional real-browser regression: requires an installed Playwright and Edge.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const bootstrap = fs.readFileSync(path.join(__dirname, '../src/tt-bootstrap.js'), 'utf8');
const secretsSource = fs.readFileSync(path.join(__dirname, '../src/tt-secrets.js'), 'utf8');
const fixtureKey = 'synthetic-fixture-key';
const routes = {
  '/': ['text/html', `<!doctype html><script>
    let state = null;
    const store = {
      tryGetJson: async () => state ? { found: true, value: state } : { found: false },
      setJson: async ({ value }) => { state = value; },
    };
    const context = {
      Popup: { show: {} }, POPUP_RESULT: { AFFIRMATIVE: 1 },
      getRequestHeaders: () => ({ 'Content-Type': 'application/json' }),
    };
    window.SillyTavern = { getContext: () => context };
    window.__TAURITAVERN__ = { ready: Promise.resolve(), api: { extension: { store } } };
    const nativeFetch = window.fetch;
    window.hostFetchCount = 0;
    window.fetch = function (...args) {
      if (this !== window) throw new Error('fetch must use the host window');
      window.hostFetchCount++;
      return nativeFetch.apply(this, args);
    };
    window.functionAccesses = 0;
    Object.defineProperty(window, 'Function', { configurable: true, get() {
      window.functionAccesses++;
      throw new Error('host Function must not be accessed');
    } });
    window.ready = true;
  </script>`],
  '/script.js': ['text/javascript', `
    globalThis.initializations = (globalThis.initializations || 0) + 1;
    globalThis.SillyTavern = { getContext: () => ({}) };
  `],
  '/scripts/secrets.js': ['text/javascript', `import '/script.js';`],
  '/bootstrap.js': ['text/javascript', bootstrap + '\n' + `
    function HA(value) { return typeof value === 'string' ? value.normalize('NFKC').replace(/[\\u200B-\\u200D\\uFEFF]/g, '').trim() : ''; }
    class GA extends Error { constructor(message, stage) { super(message); this.stage = stage; } }
  ` + secretsSource + '\nexport { ttRegisterSecret, ttPopupApi };'],
  '/frame.html': ['text/html', `<!doctype html><script type="module">
    const nativeParent = parent;
    if (location.search.includes('proxy')) {
      const proxiedParent = new Proxy(nativeParent, { get(target, key) {
        const value = Reflect.get(target, key, target);
        return typeof value === 'function' ? value.bind(target) : value;
      } });
      Object.defineProperty(window, 'parent', { value: proxiedParent });
    }
    Object.defineProperty(window, 'SillyTavern', { get: () => parent.SillyTavern });
    try {
      if (location.search.includes('legacy')) {
        await import(new URL('/script.js', parent.location.href).href);
        window.result = { legacyFailed: false };
      } else {
        const api = await import('/bootstrap.js');
        const popup = await api.ttPopupApi();
        const context = nativeParent.SillyTavern.getContext();
        const selected = { key: 'synthetic-fixture-key' };
        const config = { name: 'fixture', groupName: 'site' };
        await api.ttRegisterSecret(context, config, selected, 'api_key_custom', selected.key, true);
        const other = { key: 'synthetic-other-key' };
        await api.ttRegisterSecret(context, config, other, 'api_key_custom', other.key, true);
        await api.ttRegisterSecret(context, config, selected, 'api_key_custom', selected.key, true);
        await api.flushTauriTavernStorage();
        const response = await nativeParent.fetch('/api/secrets/read', { method: 'POST', headers: context.getRequestHeaders() });
        const state = await response.json();
        window.result = {
          activeId: state.api_key_custom.find(secret => secret.active).id,
          selectedId: selected.secretId,
          popupMatches: popup.Popup === context.Popup && popup.POPUP_RESULT === context.POPUP_RESULT,
          childInitializations: window.initializations || 0,
          getterUnchanged: !Object.getOwnPropertyDescriptor(window, 'SillyTavern').set,
          functionAccesses: nativeParent.functionAccesses,
          hostFetchCount: nativeParent.hostFetchCount,
        };
      }
    } catch (error) { window.result = { failed: true, name: error.name, message: error.message }; }
  </script>`],
};

test('helper iframe applies secrets through host fetch without loading TT modules', async () => {
  const database = { api_key_custom: [{ id: 'previous', value: 'synthetic-previous-key', active: true }] };
  const moduleRequests = [], apiRequests = [];
  let serial = 0;
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, 'http://localhost').pathname;
    if (url === '/script.js' || url === '/scripts/secrets.js') moduleRequests.push(url);
    if (url.startsWith('/api/secrets/')) {
      apiRequests.push(url);
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
      response.setHeader('content-type', 'application/json');
      if (url === '/api/secrets/read') {
        // Native secret state reveals only metadata, never the stored values.
        return response.end(JSON.stringify(Object.fromEntries(Object.entries(database).map(([key, items]) => [key,
          items.map(({ id, active }) => ({ id, active }))]))));
      }
      const items = database[body.key] ||= [];
      if (url === '/api/secrets/write') {
        for (const item of items) item.active = false;
        const id = `fixture-${++serial}`;
        items.push({ id, value: body.value, active: true });
        return response.end(JSON.stringify({ id }));
      }
      if (url === '/api/secrets/rotate' && items.some(item => item.id === body.id)) {
        for (const item of items) item.active = item.id === body.id;
        return response.end('{}');
      }
      response.statusCode = 404;
      return response.end('{}');
    }
    const entry = routes[url];
    response.writeHead(entry ? 200 : 404, { 'content-type': entry?.[0] || 'text/plain' });
    response.end(entry?.[1] || 'Not found');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.ready);
    async function runFrame(suffix) {
      await page.evaluate(suffix => {
        document.querySelector('iframe')?.remove();
        const frame = document.createElement('iframe');
        frame.src = '/frame.html' + suffix;
        document.body.append(frame);
      }, suffix);
      await page.waitForFunction(() => document.querySelector('iframe')?.contentWindow?.result);
      return page.evaluate(() => document.querySelector('iframe').contentWindow.result);
    }
    const before = await runFrame('?legacy');
    assert.equal(before.failed, true);
    assert.equal(before.name, 'TypeError');
    assert.match(before.message, /Cannot set property SillyTavern.*getter/);
    assert.deepEqual(moduleRequests, ['/script.js']);
    for (const suffix of ['', '?proxy']) {
      const beforeApiCount = apiRequests.length;
      const beforeFetchCount = await page.evaluate(() => window.hostFetchCount);
      const result = await runFrame(suffix);
      assert.equal(result.failed, undefined, result.message);
      assert.equal(result.activeId, result.selectedId);
      assert.equal(database.api_key_custom.find(secret => secret.id === result.activeId)?.value, fixtureKey);
      assert.equal(result.popupMatches, true);
      assert.equal(result.childInitializations, 0);
      assert.equal(result.getterUnchanged, true);
      assert.equal(result.functionAccesses, 0);
      assert.ok(result.hostFetchCount > beforeFetchCount);
      const calls = apiRequests.slice(beforeApiCount);
      assert.ok(calls.includes('/api/secrets/read'));
      assert.ok(calls.includes('/api/secrets/rotate'));
      assert.deepEqual(moduleRequests, ['/script.js'], `unexpected native module load in ${suffix || 'normal'} iframe`);
    }
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
});
