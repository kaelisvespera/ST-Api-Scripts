const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { withBrowser } = require('./browser-fixture.cjs');

// Original synthetic contract fixture. Real upstream modules were additionally
// checked in local QA, but are intentionally not redistributed with the extension.
function installQr() {
  const root = document.createElement('div'); root.id = 'qr--bar'; document.body.append(root);
  const textarea = document.createElement('textarea'); textarea.id = 'send_textarea';
  textarea.value = 'keep this draft'; document.body.append(textarea);
  const sets = new Map(), config = { setList: [] };
  const userSet = { name: 'User existing', qrList: [{ message: 'unchanged' }] };
  sets.set(userSet.name, userSet);
  window.qrFixture = { userSet, creates: 0 };
  window.quickReplyApi = {
    settings: { isEnabled: true, config },
    getSetByName: name => sets.get(name),
    listGlobalSets: () => config.setList.map(link => link.set.name),
    async createSet(name, props) {
      if (sets.has(name)) throw Error('Attempted replacement');
      qrFixture.creates++;
      const set = { name, ...props, qrList: [], dom: null, async save() {} };
      sets.set(name, set); return set;
    },
    createQuickReply(name, label, props) { sets.get(name).qrList.push({ label, ...props }); },
    addGlobalSet(name, isVisible) {
      const set = sets.get(name); config.setList.push({ set, isVisible });
      const node = document.createElement('div'); node.className = 'qr--buttons';
      for (const qr of set.qrList) {
        const button = document.createElement('button'); button.className = 'qr--button';
        button.textContent = qr.label;
        button.onclick = () => {
          if (qr.message !== '/st-api-manager') throw Error('Unexpected command');
          window.fixtureSlash();
        };
        node.append(button);
      }
      set.dom = node; root.append(node);
    },
    removeGlobalSet(name) {
      const set = sets.get(name);
      config.setList = config.setList.filter(link => link.set !== set); set.dom?.remove();
    },
  };
}
for (const [mode, iframe] of [['st', false], ['tt', false], ['tt', true]]) {
  test(mode + (iframe ? ' iframe' : '') + ' native QR launch, fallback, keyboard and reload', { timeout: 30000 }, () => withBrowser(mode, async ({ tab, open, assertConnection }) => {
    // Expose only synthetic fixture state, without adding a production debug API.
    await tab.route(/\/(?:index[^/]*|compat)\.js(?:\?.*)?$/, async route => {
      const file = route.request().url().includes('compat.js') ? 'ST-ApiManager/index-2.1.1-tt2.4.js' : 'index.js';
      let body = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
      body = body.replace('const connection = createCatalogConnection(host, context, storage);',
        'host.fixtureStorage = storage; const connection = createCatalogConnection(host, context, storage);');
      body = body.replace("const callback = async () => { open(); return ''; };",
        "const callback = async () => { open(); return ''; }; host.fixtureSlash = callback;");
      await route.fulfill({ contentType: 'text/javascript', body });
    });
    await tab.route('**/api/quick-replies/save', route => route.fulfill({ contentType: 'application/json', body: '{}' }));
    await open(iframe ? '?iframe=1' : '');
    await tab.evaluate(async () => {
      await fixtureStorage.setEntryPoints({ wand: false, qr: true });
      await (await window.__stApiManagerStartup).refreshEntries();
    });
    assert.equal(await tab.locator('#st-api-manager-extension-button').count(), 1, 'missing API keeps menu');
    await tab.evaluate(installQr);
    await tab.waitForFunction(() => fixtureStorage.entryPointStatus.qrReady);
    assert.equal(await tab.locator('#st-api-manager-extension-button').count(), 0);
    await tab.getByRole('dialog', { name: 'API 管理器', exact: true }).press('Escape');
    const qr = tab.locator('#qr--bar .qr--button');
    await qr.focus(); await qr.press('Enter');
    await tab.getByRole('dialog', { name: 'API 管理器', exact: true }).waitFor();
    await tab.evaluate(async () => {
      await fixtureStorage.setEntryPoints({ wand: true, qr: true });
      await (await window.__stApiManagerStartup).refreshEntries();
    });
    assert.equal(await qr.count(), 1);
    assert.equal(await tab.locator('#st-api-manager-extension-button').count(), 1);
    await tab.evaluate(async () => {
      await fixtureStorage.setEntryPoints({ wand: true, qr: false });
      await (await window.__stApiManagerStartup).refreshEntries();
    });
    assert.equal(await qr.count(), 0);
    assert.equal(await tab.evaluate(() => qrFixture.creates), 1);
    assert.equal(await tab.evaluate(() => qrFixture.userSet.qrList[0].message), 'unchanged');
    assert.equal(await tab.locator('#send_textarea').inputValue(), 'keep this draft');
    await assertConnection();
    await open(iframe ? '?iframe=1' : '');
    assert.deepEqual(await tab.evaluate(() => fixtureStorage.entryPoints), { wand: true, qr: false });
    await assertConnection();
  }));
}
