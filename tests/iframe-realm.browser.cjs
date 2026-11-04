const test = require('node:test');
const assert = require('node:assert/strict');
const { withBrowser } = require('./browser-fixture.cjs');

test('complete compatibility bundle manages entries from a proxied TT helper iframe without touching chat', { timeout: 30000 }, () => withBrowser('tt', async ({ tab, open, assertConnection, stores, models }) => {
  await open('?iframe=1');
  const panel = tab.getByRole('dialog');
  assert.equal(await panel.getByText('same-model', { exact: true }).count(), 2);
  await panel.getByRole('button', { name: '编辑', exact: true }).nth(1).click();
  await panel.getByRole('button', { name: '拉取模型', exact: true }).click();
  await panel.getByRole('option', { name: 'available-for-b', exact: true }).waitFor({ state: 'attached' });
  await panel.getByLabel('模型', { exact: true }).fill('frame-edited-model');
  await panel.getByRole('button', { name: '保存配置', exact: true }).click();
  await panel.getByText('frame-edited-model', { exact: true }).waitFor();
  assert.deepEqual(models.map(call => call.authorization), ['Bearer fixture-key-b']);
  assert.deepEqual(JSON.parse(stores.get('one').values.st_api_manager_catalog_v2).catalog.entries.map(row => row.model),
    ['same-model', 'frame-edited-model']);
  await assertConnection();
  await open('?iframe=1');
  await panel.getByText('frame-edited-model', { exact: true }).waitFor();
  await assertConnection();
}));
