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
  await tab.evaluate(({ ambiguous, ambiguousModel, shadow }) => {
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
      '<label>模型 ID <input name="apiModel" type="text" value="previous-model"></label>' +
      (ambiguousModel ? '<label>模型名称 <input name="secondModel" type="text" value="second-model"></label>' : '') +
      '<button type="submit">保存插件</button></form>';
    document.body.append(plugin);
    const form = root.querySelector('form');
    window.pluginSaves = 0;
    window.fillEvents = [];
    form.addEventListener('submit', event => { event.preventDefault(); window.pluginSaves++; });
    for (const type of ['input', 'change']) form.addEventListener(type, event => {
      window.fillEvents.push([event.target.name, type,
        form.elements.apiUrl.value, form.elements.apiKey.value, form.elements.apiModel.value]);
    });
    plugin.showModal();
  }, { ambiguous: !!options.ambiguous, ambiguousModel: !!options.ambiguousModel, shadow: !!options.shadow });
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
      assert.equal(await plugin.locator('input[name="apiModel"]').inputValue(), selected.model);
      assert.equal(await tab.evaluate(() => window.pluginSaves), 0);
      const events = await tab.evaluate(() => window.fillEvents);
      assert.deepEqual(events.map(([name, type]) => name + ':' + type),
        ['apiUrl:input', 'apiUrl:change', 'apiKey:input', 'apiKey:change', 'apiModel:input', 'apiModel:change']);
      assert.ok(events.every(([, , address, secret, model]) =>
        address === selected.url && secret === selected.key && model === selected.model));
      await assertConnection();
    }, { hasTouch: true }));
}

for (const [name, options] of [
  ['ambiguous model controls', { ambiguousModel: true }],
  ['an empty directory model', { row: { model: '' } }],
]) test(name + ' preserves the plugin model draft while filling URL and Key', { timeout: 30000 }, () =>
  withBrowser('st', async fixture => {
    const { tab, assertConnection } = fixture;
    const selected = await openFixture(fixture, options);
    const plugin = tab.locator('#fixture-plugin');
    const url = plugin.locator('input[name="apiUrl"]');
    await url.click();
    await button(tab, '填入 API').click();
    const picker = dialog(tab, '填入插件 API');
    await button(picker, /填入.*示例站点/).click();
    await picker.waitFor({ state: 'hidden' });
    assert.equal(await url.inputValue(), selected.url);
    assert.equal(await plugin.locator('input[name="apiKey"]').inputValue(), selected.key);
    assert.equal(await plugin.locator('input[name="apiModel"]').inputValue(), 'previous-model');
    if (options.ambiguousModel) {
      assert.equal(await plugin.locator('input[name="secondModel"]').inputValue(), 'second-model');
    }
    const events = await tab.evaluate(() => window.fillEvents);
    assert.deepEqual(events.map(([field, type]) => field + ':' + type),
      ['apiUrl:input', 'apiUrl:change', 'apiKey:input', 'apiKey:change']);
    await assertConnection();
  }));

test('replacing the model input invalidates the picker before it writes any fields', { timeout: 30000 }, () =>
  withBrowser('st', async fixture => {
    const { tab, assertConnection } = fixture;
    await openFixture(fixture);
    const plugin = tab.locator('#fixture-plugin');
    const url = plugin.locator('input[name="apiUrl"]');
    const model = plugin.locator('input[name="apiModel"]');
    await url.click();
    await button(tab, '填入 API').click();
    const picker = dialog(tab, '填入插件 API');
    await model.evaluate(field => field.replaceWith(field.cloneNode()));
    await button(picker, /填入.*示例站点/).click();
    await picker.getByText(/模型输入框已变化/).waitFor();
    assert.equal(await url.inputValue(), 'https://previous.invalid/v1');
    assert.equal(await plugin.locator('input[name="apiKey"]').inputValue(), 'fixture-old');
    assert.equal(await model.inputValue(), 'previous-model');
    assert.deepEqual(await tab.evaluate(() => window.fillEvents), []);
    await assertConnection();
  }));

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
  ['tt', '七日历', { url: 'URL', key: 'Key', placeholder: '已保存，留空保持不变', ids: 'sp-api-editor', modelPlaceholder: '默认模型', fetchModel: true }],
  ['tt', '百面相', { url: 'URL', key: 'Key', placeholder: '已保存，留空保持不变', accessible: true }],
  ['tt', '两三事', { url: '接口地址', key: '密钥', placeholder: '已保存，留空保持不变', ids: 'api-editor' }],
];

for (const [mode, name, layout] of shadowForms) test(mode + ': ' + name + ' shadow dialog fills URL, Key and model ID', {
  timeout: 30000,
}, () => withBrowser(mode, async ({ tab, open, origin, assertConnection, stores }) => {
  const selected = {
    id: 'shadow-fill', name: '合成连接', source: 'custom', site: '合成站点', groupIds: [],
    url: origin + '/compatible/v1', key: 'fixture-shadow-key', model: 'provider/model-id-001',
  };
  const catalog = { format: 'st-api-manager-catalog', version: 2, entries: [selected], groups: [] };
  stores.set('one', { version: 1, values: { st_api_manager_catalog_v2: JSON.stringify({
    catalog, sync: { revision: null, pending: false },
  }) } });
  await open();
  await button(dialog(tab, 'API 管理器'), '关闭').click();
  const modelPlaceholder = layout.modelPlaceholder ?? '模型名称';
  await tab.evaluate(({ url, key, placeholder, accessible, ids, modelPlaceholder, fetchModel }) => {
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
      '<label><span>模型</span><input type="text" placeholder="' + modelPlaceholder + '" value="previous-model"' +
      (ids ? ' id="' + ids + '-model"' : '') + '>' +
      (fetchModel ? '<button type="button">拉取模型</button>' : '') + '</label>' +
      '<button type="button">保存</button></form></section>';
    const root = host.shadowRoot;
    window.shadowModelEvents = [];
    const model = root.querySelector('input[placeholder="' + modelPlaceholder + '"]');
    for (const type of ['input', 'change']) model.addEventListener(type, event =>
      window.shadowModelEvents.push([event.type, event.target.value]));
    root.querySelector('form > button').focus();
  }, { ...layout, modelPlaceholder });
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
  assert.equal(await url.inputValue(), selected.url);
  assert.equal(await key.inputValue(), selected.key);
  assert.equal(await custom.getByPlaceholder(modelPlaceholder).inputValue(), selected.model);
  assert.deepEqual(await tab.evaluate(() => window.shadowModelEvents),
    [['input', selected.model], ['change', selected.model]]);
  await assertConnection();
}, { hasTouch: true }));

for (const [mode, hasTouch] of [['st', false], ['tt', true]]) {
  test(mode + ': 千千结 vector draft fills URL, Key and model independently of the chat API', { timeout: 30000 }, () =>
    withBrowser(mode, async ({ tab, open, stores, origin, assertConnection }) => {
      const selected = {
        id: 'vector', name: '向量服务', site: '示例向量站', source: 'custom',
        url: origin + '/embedding/v1', key: 'fixture-vector-key', model: 'example/embedding-v2', groupIds: ['vector'],
      };
      const catalog = {
        format: 'st-api-manager-catalog', version: 2, entries: [selected],
        groups: [{ id: 'vector', name: '向量模型', color: '#3b82f6' }],
      };
      stores.set('one', { version: 1, values: { st_api_manager_catalog_v2: JSON.stringify({
        catalog, sync: { revision: null, pending: false },
      }) } });
      await open();
      await button(dialog(tab, 'API 管理器'), '关闭').click();

      // 千千结 settings nest both drawers in the same open shadow root. The vector
      // URL and model are plain text inputs, and a saved Key stays out of the draft.
      await tab.evaluate(() => {
        const host = document.createElement('div');
        host.id = 'qqj-panel-host';
        document.body.append(host);
        const root = host.attachShadow({ mode: 'open' });
        root.innerHTML = [
          '<div class="panel"><details class="settings-group" id="qqj-settings-group-general" open>',
          '<summary class="settings-group-summary"><h3>通用设置</h3></summary><div class="settings-group-body">',
          '<details class="settings-sub qqj-api-editor" id="qqj-settings-api" open>',
          '<summary class="settings-sub-summary"><h4>API 配置</h4></summary><div class="settings-sub-body">',
          '<form class="qqj-api-editor-dialog" aria-label="聊天 API">',
          '<label>API 地址<input type="url" value="https://chat.invalid/v1"></label>',
          '<label>API Key<input type="password" value="fixture-chat-key"></label>',
          '<label>模型<input type="text" value="fixture-chat-model"></label></form></div></details>',
          '<details class="settings-sub qqj-vector-api-settings" id="qqj-settings-vector-api">',
          '<summary class="settings-sub-summary"><h4>向量配置</h4></summary><div class="settings-sub-body">',
          '<label class="setting-switch qqj-vector-enable"><span>开启向量召回</span><input type="checkbox" aria-label="开启向量召回" checked></label>',
          '<label class="settings-field"><span>URL</span><input class="settings-input" value="https://old-vector.invalid/v1" placeholder="https://example.invalid/v1"></label>',
          '<label class="settings-field"><span>Key</span><input class="settings-input" type="password" placeholder="已保存，留空保持不变"></label>',
          '<label class="settings-field"><span>模型</span><input class="settings-input" value="previous-embedding" placeholder="previous-embedding"></label>',
          '<div class="settings-actions qqj-vector-actions"><button type="button">保存</button><button type="button">测试</button>',
          '<button type="button">建立索引</button><button type="button" hidden>取消</button></div></div></details></div></details></div>',
        ].join('');
        const vector = root.getElementById('qqj-settings-vector-api');
        const fields = [...vector.querySelectorAll('input.settings-input')];
        window.vectorFixture = {
          saved: ['https://old-vector.invalid/v1', 'fixture-saved-vector-key', 'previous-embedding'],
          actions: [],
        };
        for (const control of vector.querySelectorAll('button')) control.addEventListener('click', () => {
          window.vectorFixture.actions.push(control.textContent);
          if (control.textContent !== '保存') return;
          const [url, key, model] = fields;
          window.vectorFixture.saved = [url.value, key.value || window.vectorFixture.saved[1], model.value];
          key.value = '';
        });
      });

      const vector = tab.locator('#qqj-settings-vector-api');
      const chat = tab.locator('#qqj-settings-api input');
      await vector.locator('summary').click();
      const url = vector.getByLabel('URL', { exact: true });
      const key = vector.getByLabel('Key', { exact: true });
      const model = vector.getByLabel('模型', { exact: true });
      const trigger = button(vector, '填入 API');
      if (hasTouch) {
        await url.tap();
        await trigger.tap({ timeout: 2500 });
      } else {
        await key.focus();
        await trigger.waitFor({ timeout: 2500 });
        await tab.keyboard.press('Tab');
        assert.equal(await trigger.evaluate(node => node.matches(':focus')), true);
        await tab.keyboard.press('Enter');
      }
      const picker = dialog(tab, '填入插件 API');
      await picker.getByText(/千千结 · 向量配置/).waitFor();
      await picker.getByText('向量模型', { exact: true }).waitFor();
      assert.equal((await picker.innerText()).includes(selected.key), false);
      await button(picker, /填入.*示例向量站/).click();
      await picker.waitFor({ state: 'hidden' });

      assert.deepEqual([await url.inputValue(), await key.inputValue(), await model.inputValue()],
        [selected.url, selected.key, selected.model]);
      assert.deepEqual(await chat.evaluateAll(inputs => inputs.map(input => input.value)),
        ['https://chat.invalid/v1', 'fixture-chat-key', 'fixture-chat-model']);
      assert.equal(await vector.getByRole('checkbox').isChecked(), true);
      assert.deepEqual(await tab.evaluate(() => window.vectorFixture), {
        saved: ['https://old-vector.invalid/v1', 'fixture-saved-vector-key', 'previous-embedding'],
        actions: [],
      });
      const save = vector.getByRole('button', { name: '保存', exact: true });
      await save.and(vector.locator('button:focus')).waitFor({ timeout: 2500 });
      assert.equal(await trigger.count(), 0);
      await (hasTouch ? save.tap() : save.click());
      assert.deepEqual(await tab.evaluate(() => window.vectorFixture), {
        saved: [selected.url, selected.key, selected.model], actions: ['保存'],
      });
      assert.equal(await key.inputValue(), '');
      await assertConnection();
    }, { hasTouch, viewport: hasTouch ? { width: 390, height: 760 } : { width: 950, height: 800 } }));
}
