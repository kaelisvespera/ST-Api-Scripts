// Optional real-browser regression: requires an installed Playwright and Edge.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const bootstrap = fs.readFileSync(path.join(__dirname, '../src/tt-bootstrap.js'), 'utf8');
const routes = {
  '/': ['text/html', `<!doctype html><script type="module">
    import * as native from '/script.js';
    import * as secrets from '/scripts/secrets.js';
    window.hostNative = native;
    window.hostSecrets = secrets;
    window.ready = true;
  </script>`],
  '/script.js': ['text/javascript', `
    globalThis.initializations = (globalThis.initializations || 0) + 1;
    // TT initializes this property; Tavern Helper exposes a getter in its iframe.
    globalThis.SillyTavern = { getContext: () => ({}) };
    globalThis.__TAURITAVERN__ = { ready: Promise.resolve(), api: { extension: { store: {
      tryGetJson: async () => ({ found: false }), setJson: async () => {}
    } } } };
    export const nativeWindow = window;
    let depth = 0;
    export const isConnectionValidationSuspended = () => depth > 0;
    export async function withConnectionValidationSuspended(reason, callback) {
      depth++;
      try { return await callback(); } finally { depth--; }
    }
  `],
  '/scripts/secrets.js': ['text/javascript', `
    import { nativeWindow } from '/script.js';
    globalThis.secretInitializations = (globalThis.secretInitializations || 0) + 1;
    export const owner = nativeWindow;
    export let active = '';
    export function writeSecret(key, value) { active = value; return 'fixture-secret-id'; }
  `],
  '/scripts/popup.js': ['text/javascript', `
    import { nativeWindow } from '/script.js';
    export const owner = nativeWindow;
    export const Popup = { show: {} };
    export const POPUP_RESULT = { AFFIRMATIVE: 1 };
  `],
  '/bootstrap.js': ['text/javascript', bootstrap + '\nexport { ttSecretsApi, ttPopupApi, ttWithConnectionValidationSuspended };'],
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
        // This is the old importer: absolute host URL, but still the iframe realm.
        await import(new URL('/script.js', parent.location.href).href);
        window.result = { legacyFailed: false };
      } else {
        const api = await import('/bootstrap.js');
        const secrets = await api.ttSecretsApi();
        const popup = await api.ttPopupApi();
        const during = await api.ttWithConnectionValidationSuspended(async () => {
          await secrets.writeSecret('api_key_custom', 'synthetic-fixture-key');
          return parent.hostNative.isConnectionValidationSuspended();
        });
        let callbackError = '';
        try { await api.ttWithConnectionValidationSuspended(() => { throw new Error('callback-fixture'); }); }
        catch (error) { callbackError = error.message; }
        window.result = {
          sharesSecrets: secrets === parent.hostSecrets,
          hostOwner: secrets.owner === nativeParent && popup.owner === nativeParent,
          hostKey: parent.hostSecrets.active,
          during, after: parent.hostNative.isConnectionValidationSuspended(), callbackError,
          childInitializations: window.initializations || 0,
          hostInitializations: parent.initializations,
          hostSecretInitializations: parent.secretInitializations,
          getterUnchanged: !Object.getOwnPropertyDescriptor(window, 'SillyTavern').set,
        };
      }
    } catch (error) { window.result = { legacyFailed: true, name: error.name, message: error.message }; }
  </script>`],
};

test('native modules share the parent realm instead of reinitializing TT in a helper iframe', async () => {
  const server = http.createServer((request, response) => {
    const entry = routes[new URL(request.url, 'http://localhost').pathname];
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
    assert.equal(before.legacyFailed, true);
    assert.equal(before.name, 'TypeError');
    assert.match(before.message, /Cannot set property SillyTavern.*getter/);
    console.log('Reproduced the getter-only SillyTavern failure in a real iframe.');
    const after = await runFrame('');
    assert.deepEqual(after, {
      sharesSecrets: true, hostOwner: true, hostKey: 'synthetic-fixture-key',
      during: true, after: false, callbackError: 'callback-fixture',
      childInitializations: 0, hostInitializations: 1, hostSecretInitializations: 1, getterUnchanged: true,
    });
    assert.deepEqual(await runFrame('?proxy'), after, 'a bound parent Function must still use the host realm');
    assert.deepEqual(errors, []);
    console.log('Verified parent module identity, shared key state, and suspension recovery.');
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
});
