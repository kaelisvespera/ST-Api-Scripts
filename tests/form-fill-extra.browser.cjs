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
  const modelId = style === 'seven-days' ? 'sp-api-editor-model' : style === 'two-more' ? 'api-editor-model' : 'fixture-model';
  await tab.evaluate(({ style, modelId }) => {
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
    const model = '<input id="' + modelId + '" value="old model">';
    const modelField = style === 'yaml' ? '<div><span>模型 ID</span>' + model + '</div>' :
      '<label><span>模型</span><div>' + model + '<button type="button">拉取模型</button></div></label>' +
      '<details open><summary>已加载模型</summary><input type="search" aria-label="搜索模型" value="keep search"></details>';
    const labels = style === 'seven-days' ? ['URL', 'Key'] : style === 'two-more' ? ['接口地址', '密钥'] : ['API 地址', 'API Key'];
    wrapper.innerHTML = '<section role="dialog" aria-label="新增 API"><form class="' +
      (style === 'two-more' ? 'api-editor-form' : 'fixture-form') + '">' +
      '<label>' + labels[0] + '<input id="fixture-url" type="url" value="https://previous.invalid/v1"></label>' +
      '<label>' + labels[1] + '<input id="fixture-key" type="password" value="fixture-old-key"></label>' +
      modelField + advanced +
      '<label>请求头<textarea id="fixture-header">keep headers</textarea></label>' +
      '<button type="button">保存</button></form></section>';
    const form = wrapper.querySelector('form');
    window.advancedEvents = [];
    for (const event of ['input', 'change']) form.addEventListener(event, e => {
      window.advancedEvents.push({
        id: e.target.id, event,
        url: wrapper.querySelector('#fixture-url').value,
        key: wrapper.querySelector('#fixture-key').value,
        model: wrapper.getElementById(modelId).value,
        body: wrapper.querySelector('#api-editor-additional').value,
        exclude: wrapper.querySelector('#api-editor-exclude').value,
        headers: wrapper.querySelector('#fixture-header').value,
      });
    });
    form.lastElementChild.focus();
  }, { style, modelId });
  const plugin = tab.locator('#fixture-extra-fill');
  await plugin.locator('#fixture-url').click();
  await button(plugin, '填入 API').click();
  return { plugin, picker: dialog(tab, '填入插件 API'), row, modelId };
}

for (const [mode, style] of [['st', 'seven-days'], ['st', 'yaml'], ['tt', 'two-more'], ['tt', 'yaml']]) {
  test(mode + ' ' + style + ': URL, Key, model, and advanced values reach the target form together', {
    timeout: 30000,
  }, () => withBrowser(mode, async fixture => {
    const { tab, assertConnection } = fixture;
    const extra = { includeBody: yamlBody, excludeBody: yamlExclude, includeHeaders: 'X-Fixture: header-only' };
    const { plugin, picker, row, modelId } = await prepare(fixture, style, extra);
    await picker.getByText(/模型名也会一并填入/).waitFor();
    await picker.getByText(/一并填入.*主体附加参数.*排除参数/).waitFor();
    await picker.getByText(/本表单无法填入.*请求标头/).waitFor();
    await button(picker, /填入.*附加参数示例/).click();
    await picker.waitFor({ state: 'hidden' });
    const body = await plugin.locator('#api-editor-additional').inputValue();
    const exclude = await plugin.locator('#api-editor-exclude').inputValue();
    if (style === 'yaml') {
      assert.equal(body, yamlBody);
      assert.equal(exclude, yamlExclude);
      assert.equal(await plugin.locator('#fixture-unrelated').inputValue(), 'keep prompt');
    } else {
      assert.deepEqual(JSON.parse(body), expectedBody);
      assert.equal(exclude, 'frequency_penalty\npresence_penalty');
      assert.equal(await plugin.getByRole('searchbox', { name: '搜索模型' }).inputValue(), 'keep search');
    }
    assert.equal(await plugin.locator('#fixture-url').inputValue(), row.url);
    assert.equal(await plugin.locator('#fixture-key').inputValue(), row.key);
    assert.equal(await plugin.locator('#' + modelId).inputValue(), row.model);
    assert.equal(await plugin.locator('#fixture-header').inputValue(), 'keep headers');
    const events = await tab.evaluate(() => window.advancedEvents);
    const expectedEvents = ['fixture-url', 'fixture-key', modelId, 'api-editor-additional', 'api-editor-exclude']
      .flatMap(id => ['input', 'change'].map(type => `${id}:${type}`));
    assert.deepEqual(events.map(({ id, event }) => `${id}:${event}`).sort(), expectedEvents.sort());
    for (const { id, event, ...values } of events) {
      assert.deepEqual(values, {
        url: row.url, key: row.key, model: row.model, body, exclude, headers: 'keep headers',
      }, `${id}:${event}`);
    }
    assert.ok(await plugin.locator(style === 'two-more' ? '.api-editor-advanced-body[hidden]' : 'details:not([open])').count());
    await assertConnection();
  }));
}

test('an incompatible body rejects the entire write, including URL, Key, and model', { timeout: 30000 }, () =>
  withBrowser('st', async fixture => {
    const { tab } = fixture;
    const { plugin, picker, modelId } = await prepare(fixture, 'seven-days', { includeBody: '{"model":"reserved"}' });
    await button(picker, /填入.*附加参数示例/).click();
    await picker.getByText(/插件保留字段/).waitFor();
    assert.equal(await plugin.locator('#fixture-url').inputValue(), 'https://previous.invalid/v1');
    assert.equal(await plugin.locator('#fixture-key').inputValue(), 'fixture-old-key');
    assert.equal(await plugin.locator('#' + modelId).inputValue(), 'old model');
    assert.equal(await plugin.locator('#api-editor-additional').inputValue(), 'previous body');
    assert.deepEqual(await tab.evaluate(() => window.advancedEvents), []);
  }));

for (const [label, extra] of [['no extra settings', undefined], ['headers only', { includeHeaders: '{"X-Fixture":"private"}' }]]) {
  test('an existing advanced draft is preserved with ' + label, {
    timeout: 30000,
  }, () => withBrowser('st', async fixture => {
    const { tab } = fixture;
    const { plugin, picker, row, modelId } = await prepare(fixture, 'seven-days', extra);
    await button(picker, /填入.*附加参数示例/).click();
    await picker.waitFor({ state: 'hidden' });
    assert.equal(await plugin.locator('#api-editor-additional').inputValue(), 'previous body');
    assert.equal(await plugin.locator('#api-editor-exclude').inputValue(), 'previous exclude');
    assert.equal(await plugin.locator('#fixture-url').inputValue(), row.url);
    assert.equal(await plugin.locator('#fixture-key').inputValue(), row.key);
    assert.equal(await plugin.locator('#' + modelId).inputValue(), row.model);
    assert.equal(await plugin.locator('#fixture-header').inputValue(), 'keep headers');
    assert.equal(await tab.evaluate(() => window.advancedEvents.length), 6);
  }));
}
