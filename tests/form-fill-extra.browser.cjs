const assert = require('node:assert/strict');
const test = require('node:test');
const { withBrowser } = require('./browser-fixture.cjs');

const dialog = (tab, name) => tab.getByRole('dialog', { name, exact: true });
const button = (scope, name) => scope.getByRole('button', { name });
const yamlBody = 'thinking:\n  type: enabled\nreasoning_effort: low\n';
const yamlExclude = '- frequency_penalty\n- presence_penalty\n';
const expectedBody = { thinking: { type: 'enabled' }, reasoning_effort: 'low' };

async function prepare({ tab, open, stores, origin }, style, extra) {
  const row = {
    id: 'advanced-choice', name: '示例', site: '附加参数示例', source: 'custom', model: 'fixture-model',
    url: origin + '/compatible/v1', key: 'fixture-profile-key', groupIds: [],
    ...(extra === undefined ? {} : { extra }),
  };
  stores.set('one', { version: 1, values: { st_api_manager_catalog_v2: JSON.stringify({
    catalog: { format: 'st-api-manager-catalog', version: 2, entries: [row], groups: [] },
    sync: { revision: null, pending: false },
  }) } });
  const literals = { [yamlBody]: expectedBody, [yamlExclude]: ['frequency_penalty', 'presence_penalty'] };
  await tab.route('**/lib.js', route => route.fulfill({
    contentType: 'text/javascript',
    body: 'const fixture = ' + JSON.stringify(literals) +
      '; export const yaml={parse: source => Object.hasOwn(fixture,source) ? fixture[source] : JSON.parse(source)};',
  }));
  await open();
  await button(dialog(tab, 'API 管理器'), '关闭').click();
  await tab.evaluate(style => {
    const host = document.createElement('div');
    host.id = 'fixture-extra-fill';
    document.body.append(host);
    const wrapper = host.attachShadow({ mode: 'open' });
    const bodyField = '<textarea id="api-editor-additional">previous body</textarea>';
    const exclusions = '<textarea id="api-editor-exclude">previous exclude</textarea>';
    let advanced;
    if (style === 'yaml') {
      advanced = '<details><summary>附加参数</summary>' +
        '<div>包括主体参数</div><div><textarea id="api-editor-additional" placeholder="聊天完成请求主体中要包含的参数（YAML 对象）">previous body</textarea></div>' +
        '<div>排除主体参数</div><div><textarea id="api-editor-exclude" placeholder="要从聊天完成请求主体中排除的参数（YAML 数组）">previous exclude</textarea></div>' +
        '<label>全局提示词<textarea id="fixture-unrelated">keep prompt</textarea></label></details>';
    } else if (style === 'two-more') {
      advanced = '<div class="api-editor-advanced-body" hidden><label>排除参数' + exclusions +
        '</label><label>附加参数（JSON）' + bodyField + '</label></div>';
    } else {
      advanced = '<details><summary>接口高级选项</summary><label>剔除参数（换行或逗号分隔）' + exclusions +
        '</label><label>附加参数（JSON）' + bodyField + '</label></details>';
    }
    wrapper.innerHTML = '<section role="dialog" aria-label="新增 API"><form class="' +
      (style === 'two-more' ? 'api-editor-form' : 'fixture-form') + '">' +
      '<label>API 地址<input id="fixture-url" type="url" value="https://previous.invalid/v1"></label>' +
      '<label>API Key<input id="fixture-key" type="password" value="fixture-old-key"></label>' +
      (style === 'yaml' ? '<div><span>模型 ID</span><input id="fixture-model" value="old model"></div>' : '') + advanced +
      '<label>请求头<textarea id="fixture-header">keep headers</textarea></label>' +
      '<button type="button">保存</button></form></section>';
    const form = wrapper.querySelector('form');
    window.advancedEvents = [];
    for (const event of ['input', 'change']) form.addEventListener(event, e => {
      window.advancedEvents.push({
        id: e.target.id, event,
        url: wrapper.querySelector('#fixture-url').value,
        model: wrapper.querySelector('#fixture-model')?.value,
        body: wrapper.querySelector('#api-editor-additional').value,
        exclude: wrapper.querySelector('#api-editor-exclude').value,
      });
    });
    wrapper.querySelector('button').focus();
  }, style);
  const plugin = tab.locator('#fixture-extra-fill');
  await plugin.locator('#fixture-url').click();
  await button(plugin, '填入 API').click();
  return { plugin, picker: dialog(tab, '填入插件 API'), row };
}

for (const [mode, style] of [['st', 'seven-days'], ['tt', 'two-more'], ['tt', 'yaml']]) {
  test(mode + ' ' + style + ': a profile supplies advanced values in the target format', {
    timeout: 30000,
  }, () => withBrowser(mode, async fixture => {
    const { tab, assertConnection } = fixture;
    const extra = { includeBody: yamlBody, excludeBody: yamlExclude, includeHeaders: 'X-Fixture: header-only' };
    const { plugin, picker, row } = await prepare(fixture, style, extra);
    await picker.getByText(/一并填入.*主体附加参数.*排除参数/).waitFor();
    await picker.getByText(/本表单无法填入.*请求标头/).waitFor();
    await button(picker, /填入.*附加参数示例/).click();
    await picker.waitFor({ state: 'hidden' });
    const body = await plugin.locator('#api-editor-additional').inputValue();
    const exclude = await plugin.locator('#api-editor-exclude').inputValue();
    if (style === 'yaml') {
      assert.equal(body, yamlBody);
      assert.equal(exclude, yamlExclude);
      assert.equal(await plugin.locator('#fixture-model').inputValue(), row.model);
      assert.equal(await plugin.locator('#fixture-unrelated').inputValue(), 'keep prompt');
    } else {
      assert.deepEqual(JSON.parse(body), expectedBody);
      assert.equal(exclude, 'frequency_penalty\npresence_penalty');
    }
    assert.equal(await plugin.locator('#fixture-key').inputValue(), row.key);
    assert.equal(await plugin.locator('#fixture-header').inputValue(), 'keep headers');
    const events = await tab.evaluate(() => window.advancedEvents);
    assert.equal(events.length, style === 'yaml' ? 10 : 8);
    if (style === 'yaml') assert.ok(events.every(event => event.model === row.model));
    assert.ok(events.every(event => event.url === row.url && event.body === body && event.exclude === exclude));
    assert.ok(events.some(event => event.id === 'api-editor-additional' && event.event === 'input'));
    assert.ok(await plugin.locator(style === 'two-more' ? '.api-editor-advanced-body[hidden]' : 'details:not([open])').count());
    await assertConnection();
  }));
}

test('an incompatible body rejects the entire write, including URL and Key', { timeout: 30000 }, () =>
  withBrowser('st', async fixture => {
    const { tab } = fixture;
    const { plugin, picker } = await prepare(fixture, 'seven-days', { includeBody: '{"model":"reserved"}' });
    await button(picker, /填入.*附加参数示例/).click();
    await picker.getByText(/插件保留字段/).waitFor();
    assert.equal(await plugin.locator('#fixture-url').inputValue(), 'https://previous.invalid/v1');
    assert.equal(await plugin.locator('#fixture-key').inputValue(), 'fixture-old-key');
    assert.equal(await plugin.locator('#api-editor-additional').inputValue(), 'previous body');
    assert.deepEqual(await tab.evaluate(() => window.advancedEvents), []);
  }));

for (const [label, extra] of [['no extra settings', undefined], ['headers only', { includeHeaders: '{"X-Fixture":"private"}' }]]) {
  test('an existing advanced draft is preserved with ' + label, {
    timeout: 30000,
  }, () => withBrowser('st', async fixture => {
    const { tab } = fixture;
    const { plugin, picker, row } = await prepare(fixture, 'seven-days', extra);
    await button(picker, /填入.*附加参数示例/).click();
    await picker.waitFor({ state: 'hidden' });
    assert.equal(await plugin.locator('#api-editor-additional').inputValue(), 'previous body');
    assert.equal(await plugin.locator('#api-editor-exclude').inputValue(), 'previous exclude');
    assert.equal(await plugin.locator('#fixture-url').inputValue(), row.url);
    assert.equal(await tab.evaluate(() => window.advancedEvents.length), 4);
  }));
}
