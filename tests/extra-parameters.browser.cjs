const assert = require('node:assert/strict');
const test = require('node:test');
const { withBrowser } = require('./browser-fixture.cjs');

const dialog = (tab, name) => tab.getByRole('dialog', { name, exact: true });
const exactButton = (pane, name) => pane.getByRole('button', { name, exact: true });

for (const mode of ['st', 'tt']) test(mode + ': editing and applying native custom extra parameters', {
  timeout: 30000,
}, () => withBrowser(mode, async ({ tab, open, stores, flush, origin, assertConnection }) => {
  const row = {
    id: 'extra-example', name: '附加参数示例', site: '合成站点', source: 'custom',
    model: 'extra-fixture-model', url: origin + '/compatible/v1', key: 'extra-fixture-key', groupIds: [],
  };
  const other = { ...row, id: 'other-example', model: 'other-fixture-model', key: 'other-fixture-key' };
  const catalog = { format: 'st-api-manager-catalog', version: 2, groups: [], entries: [row, other] };
  stores.set('one', { version: 1, values: { st_api_manager_catalog_v2: JSON.stringify({
    catalog, sync: { revision: null, pending: false },
  }) } });
  // JSON documents are a YAML subset. This fixture provides the two hosts' /lib.js export seam.
  await tab.route('**/lib.js', route => route.fulfill({
    contentType: 'text/javascript',
    body: 'export const yaml = {parse: JSON.parse};',
  }));
  await open();
  const main = dialog(tab, 'API 管理器');
  const editCard = id => main.locator('[data-entry-id="' + id + '"]');
  await exactButton(editCard(row.id), '编辑').click();
  const editor = dialog(tab, '编辑 API 配置');
  await editor.getByText('附加参数', { exact: true }).click();
  const body = editor.getByLabel('包含主体参数');
  const exclusion = editor.getByLabel('排除主体参数');
  const headers = editor.getByLabel('包含请求标头');
  await body.fill('["wrong shape"]');
  await exactButton(editor, '保存').click();
  await editor.getByRole('status').getByText(/包含主体参数需要使用 YAML 对象/).waitFor();
  assert.equal(await body.inputValue(), '["wrong shape"]');
  await assertConnection();
  const extra = { includeBody: '{ "top_k": 20 }', excludeBody: '["presence_penalty"]', includeHeaders: '{"X-Fixture":"extra"}' };
  await body.fill(extra.includeBody);
  await exclusion.fill(extra.excludeBody);
  await headers.fill(extra.includeHeaders);
  await exactButton(editor, '保存').click();
  await editor.waitFor({ state: 'hidden' });
  await flush();
  const saved = JSON.parse(stores.get('one').values.st_api_manager_catalog_v2).catalog;
  assert.deepEqual(saved.entries.find(entry => entry.id === row.id).extra, extra);
  assert.equal(saved.entries.find(entry => entry.id === other.id).extra, undefined);
  await assertConnection();

  if (mode === 'tt') await tab.evaluate(() => {
    SillyTavern.getContext().chatCompletionSettings.additional_parameters_by_source =
      { openai: { include_headers: 'keep this source' } };
  });
  const nativeValues = () => tab.evaluate(mode => {
    const settings = SillyTavern.getContext().chatCompletionSettings;
    const keys = ['include_body', 'exclude_body', 'include_headers'];
    return keys.map(key => mode === 'tt' ? settings.additional_parameters_by_source.custom[key] : settings['custom_' + key]);
  }, mode);
  await exactButton(editCard(row.id), '应用').click();
  await main.getByText(/已应用并发起原生连接/).waitFor();
  assert.deepEqual(await nativeValues(), Object.values(extra));
  await exactButton(editCard(other.id), '应用').click();
  await tab.waitForFunction(model => hostConnection.model === model, other.model);
  assert.deepEqual(await nativeValues(), ['', '', '']);
  if (mode === 'tt') assert.equal(await tab.evaluate(() =>
    SillyTavern.getContext().chatCompletionSettings.additional_parameters_by_source.openai.include_headers),
  'keep this source');
}));
