const assert = require('node:assert/strict');
const test = require('node:test');
const { withBrowser } = require('./browser-fixture.cjs');

const dialog = (tab, name) => tab.getByRole('dialog', { name, exact: true });
const button = (scope, name) => scope.getByRole('button', { name });

async function openFixture({ tab, open, stores, origin }, options = {}) {
  const selected = {
    id: 'fill-selected', name: '选定条目', site: '示例站点', source: 'custom', model: 'fixture-model',
    url: origin + '/compatible/v1', key: 'fixture-fill-secret', groupIds: [],
    ...options.row,
  };
  const other = { ...selected, id: 'fill-other', name: '另一条', site: '其他站点', model: 'other-model', key: 'fixture-other-secret' };
  const catalog = { format: 'st-api-manager-catalog', version: 2, entries: [other, selected], groups: [] };
  stores.set('one', { version: 1, values: { st_api_manager_catalog_v2: JSON.stringify({
    catalog, sync: { revision: null, pending: false },
  }) } });
  await open(options.iframe ? '?iframe=1' : '');
  await button(dialog(tab, 'API 管理器'), '关闭').click();
  await tab.evaluate(({ ambiguous, shadow }) => {
    const plugin = document.createElement('dialog');
    plugin.id = 'fixture-plugin';
    plugin.setAttribute('aria-label', '合成插件设置');
    plugin.style.cssText = 'width:min(280px,90vw);padding:18px;';
    const content = document.createElement('div');
    plugin.append(content);
    const root = shadow ? content.attachShadow({ mode: 'open' }) : content;
    root.innerHTML =
      '<form aria-label="合成 API 表单" style="display:grid;gap:14px;">' +
      '<label>API 地址 <input name="apiUrl" type="url" value="https://previous.invalid/v1"></label>' +
      '<label>API Key <input name="apiKey" type="password" value="fixture-old"></label>' +
      (ambiguous ? '<label>备用 API Key <input name="backupApiKey" value="fixture-backup"></label>' : '') +
      '<button type="submit">保存插件</button></form>';
    document.body.append(plugin);
    const form = root.querySelector('form');
    window.pluginSaves = 0;
    window.fillEvents = [];
    form.addEventListener('submit', event => { event.preventDefault(); window.pluginSaves++; });
    for (const type of ['input', 'change']) form.addEventListener(type, event => {
      window.fillEvents.push([event.target.name, type, form.elements.apiUrl.value, form.elements.apiKey.value]);
    });
    plugin.showModal();
  }, { ambiguous: !!options.ambiguous, shadow: !!options.shadow });
  return selected;
}

for (const [mode, options] of [['st', {}], ['tt', { shadow: true }], ['tt', { iframe: true }]]) {
  test(mode + (options.iframe ? ' iframe' : options.shadow ? ' shadow root' : '') +
    ': selected directory entry fills only the opened plugin form', { timeout: 30000 }, () =>
    withBrowser(mode, async fixture => {
      const { tab, assertConnection } = fixture;
      await tab.setViewportSize({ width: 320, height: 640 });
      const selected = await openFixture(fixture, options);
      const plugin = tab.locator('#fixture-plugin');
      const url = plugin.locator('input[name="apiUrl"]');
      const key = plugin.locator('input[name="apiKey"]');
      await url.tap();
      await button(tab, '填入 API').tap();
      const picker = dialog(tab, '填入插件 API');
      await picker.waitFor();
      assert.equal((await picker.innerText()).includes(selected.key), false);
      assert.equal(await key.inputValue(), 'fixture-old');
      await picker.getByRole('searchbox').fill('示例站点');
      assert.equal(await button(picker, /其他站点/).count(), 0);
      await button(picker, /填入.*示例站点/).tap();
      await picker.waitFor({ state: 'hidden' });
      assert.equal(await url.inputValue(), selected.url);
      assert.equal(await key.inputValue(), selected.key);
      assert.equal(await tab.evaluate(() => window.pluginSaves), 0);
      const events = await tab.evaluate(() => window.fillEvents);
      assert.deepEqual(events.map(([name, type]) => name + ':' + type).sort(),
        ['apiKey:change', 'apiKey:input', 'apiUrl:change', 'apiUrl:input']);
      assert.ok(events.every(([, , address, secret]) => address === selected.url && secret === selected.key));
      await assertConnection();
    }, { hasTouch: true }));
}

test('ambiguous pairs are rejected, and a replaced field cannot use an old picker', { timeout: 30000 }, () =>
  withBrowser('st', async fixture => {
    const { tab, assertConnection } = fixture;
    await openFixture(fixture, { ambiguous: true });
    const plugin = tab.locator('#fixture-plugin');
    const url = plugin.locator('input[name="apiUrl"]');
    await url.click();
    await button(tab, '填入 API').click();
    const picker = dialog(tab, '填入插件 API');
    await picker.getByText(/无法确认配对/).waitFor();
    assert.equal(await button(picker, /填入.*示例站点/).count(), 0);
    assert.equal(await url.inputValue(), 'https://previous.invalid/v1');
    assert.equal(await plugin.locator('input[name="apiKey"]').inputValue(), 'fixture-old');
    assert.equal(await plugin.locator('input[name="backupApiKey"]').inputValue(), 'fixture-backup');
    assert.deepEqual(await tab.evaluate(() => window.fillEvents), []);
    await button(picker, '取消').click();
    await plugin.locator('input[name="backupApiKey"]').evaluate(field => field.closest('label').remove());
    await url.click();
    await button(tab, '填入 API').click();
    await url.evaluate(field => field.replaceWith(field.cloneNode()));
    await button(picker, /填入.*其他站点/).click();
    assert.ok(await picker.getByRole('status').textContent());
    assert.equal(await picker.isVisible(), true);
    assert.equal(await url.inputValue(), 'https://previous.invalid/v1');
    assert.deepEqual(await tab.evaluate(() => window.fillEvents), []);
    await assertConnection();
  }));

test('normal login and native ST credential fields do not offer plugin filling', { timeout: 30000 }, () =>
  withBrowser('st', async ({ tab, open, assertConnection }) => {
    await open();
    await button(dialog(tab, 'API 管理器'), '关闭').click();
    await tab.evaluate(() => {
      const form = document.createElement('form');
      form.innerHTML = '<label>登录密码 <input type="password" id="fixture-login"></label>';
      document.body.append(form);
      document.querySelector('#openai_settings').hidden = false;
      const chat = document.querySelector('#chat') ?? document.body.appendChild(document.createElement('section'));
      chat.id = 'chat';
      const chatInput = document.createElement('input');
      chatInput.id = 'fixture-chat-input';
      chatInput.name = 'apiKey'; // The chat container takes precedence over metadata.
      chat.append(chatInput);
    });
    for (const selector of ['#fixture-login', '#custom_api_url_text', '#api_key_custom', '#fixture-chat-input']) {
      await tab.locator(selector).focus();
      assert.equal(await button(tab, '填入 API').count(), 0);
    }
    await assertConnection();
  }));


test('a URL with embedded credentials is rejected before either field changes', { timeout: 30000 }, () =>
  withBrowser('st', async fixture => {
    const { tab, assertConnection } = fixture;
    await openFixture(fixture, { row: { url: fixture.origin + '/v1?api_key=fixture-in-url' } });
    const plugin = tab.locator('#fixture-plugin');
    const url = plugin.locator('input[name="apiUrl"]');
    const key = plugin.locator('input[name="apiKey"]');
    await key.focus();
    await tab.keyboard.press('Tab');
    const trigger = button(tab, '填入 API');
    assert.equal(await trigger.evaluate(element => element === document.activeElement), true);
    await tab.keyboard.press('Enter');
    const picker = dialog(tab, '填入插件 API');
    await button(picker, /填入.*示例站点/).click();
    await picker.getByText(/URL 中的密钥参数/).waitFor();
    assert.equal(await url.inputValue(), 'https://previous.invalid/v1');
    assert.equal(await key.inputValue(), 'fixture-old');
    assert.deepEqual(await tab.evaluate(() => window.fillEvents), []);
    await assertConnection();
  }));


// Input shapes from the four public editors. Use local markup and synthetic credentials.
const shadowForms = [
  ['st', '千千结', { url: 'URL', key: 'Key', placeholder: '输入 API Key' }],
  ['tt', '千千结', { url: 'URL', key: 'Key', placeholder: '输入 API Key' }],
  ['tt', '七日历', { url: 'URL', key: 'Key', placeholder: '已保存，留空保持不变', ids: 'sp-api-editor' }],
  ['tt', '百面相', { url: 'URL', key: 'Key', placeholder: '已保存，留空保持不变', accessible: true }],
  ['tt', '两三事', { url: '接口地址', key: '密钥', placeholder: '已保存，留空保持不变', ids: 'api-editor' }],
];

for (const [mode, name, layout] of shadowForms) test(mode + ': ' + name + ' shadow dialog fills one URL and Key pair', {
  timeout: 30000,
}, () => withBrowser(mode, async ({ tab, open, origin, assertConnection }) => {
  await open();
  await button(dialog(tab, 'API 管理器'), '关闭').click();
  await tab.evaluate(({ url, key, placeholder, accessible, ids }) => {
    const host = document.createElement('div');
    host.id = 'fixture-custom-shadow';
    document.body.append(host);
    host.attachShadow({ mode: 'open' }).innerHTML =
      '<section role="dialog" aria-labelledby="draft-title">' +
      '<h2 id="draft-title">' + (placeholder.startsWith('输入') ? '新增 API' : '编辑 API') + '</h2><form>' +
      '<label><span>预设名称</span><input type="text"></label>' +
      '<label><span>' + url + '</span><input type="url" placeholder="https://example.invalid/v1"' +
      (accessible ? ' aria-label="API 地址"' : '') + (ids ? ' id="' + ids + '-url"' : '') + '></label>' +
      '<label><span>' + key + '</span><input type="password" placeholder="' + placeholder + '"' +
      (accessible ? ' aria-label="API Key（留空保留已保存 Key）" autocomplete="new-password"' : '') +
      (ids ? ' id="' + ids + '-key"' : '') + '></label>' +
      '<label><span>模型</span><input type="text" placeholder="模型名称"></label>' +
      '<button type="button">保存</button></form></section>';
    host.shadowRoot.querySelector('button').focus();
  }, layout);
  const custom = tab.locator('#fixture-custom-shadow');
  const url = custom.getByPlaceholder('https://example.invalid/v1');
  const key = custom.getByPlaceholder(layout.placeholder);
  await key.focus();
  assert.equal(await button(custom, '填入 API').count(), 1, 'focus moved within the opened shadow root');
  await url.tap();
  const trigger = button(custom, '填入 API');
  assert.equal(await url.evaluate(el => el.closest('label').nextElementSibling?.textContent), '填入 API');
  // A framework can remove the extra button without blurring its field.
  await trigger.evaluate(el => el.remove());
  await url.tap();
  await trigger.tap();
  const picker = dialog(tab, '填入插件 API');
  const pick = button(picker, /^填入 /).first();
  await pick.tap();
  await picker.waitFor({ state: 'hidden' });
  assert.ok((await url.inputValue()).startsWith(origin));
  assert.match(await key.inputValue(), /^fixture-key-/);
  await assertConnection();
}, { hasTouch: true }));
