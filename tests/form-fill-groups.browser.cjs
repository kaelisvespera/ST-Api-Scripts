const assert = require('node:assert/strict');
const test = require('node:test');
const { withBrowser } = require('./browser-fixture.cjs');

const dialog = (tab, name) => tab.getByRole('dialog', { name, exact: true });

test('the form fill picker shows ordered groups, searches all entries and preserves main panel state',
  { timeout: 30000 }, () => withBrowser('st', async ({ tab, open, stores, origin, assertConnection }) => {
    const entry = (id, model, groupIds) => ({
      id, name: model, site: '示例站点', model, groupIds, source: 'custom',
      url: origin + '/provider/' + id, key: 'fixture-group-' + id,
    });
    const shared = entry('both', '共用模型', ['a', 'b']);
    const catalog = {
      format: 'st-api-manager-catalog', version: 2,
      groups: [
        { id: 'b', name: '乙组', color: '#a95502', icon: 'gemini' },
        { id: 'a', name: '甲组', color: '#3b82f6' },
        { id: 'empty', name: '空标签', color: '#3b82f6' },
      ],
      entries: [shared, entry('a2', '甲组专属模型', ['a']), entry('b2', '乙组专属模型', ['b']), entry('free', '自由模型', [])],
      groupOrders: [
        { groupId: 'a', entryIds: ['a2', 'both'] },
        { groupId: 'b', entryIds: ['b2', 'both'] },
      ],
    };
    stores.set('one', { version: 1, values: { st_api_manager_catalog_v2: JSON.stringify({
      catalog, sync: { revision: null, pending: false },
    }) } });
    await tab.setViewportSize({ width: 320, height: 640 });
    await open();
    const main = dialog(tab, 'API 管理器');
    const mainGroup = main.locator('details').filter({ has: tab.getByText('甲组', { exact: true }) });
    await mainGroup.locator('summary').click();
    assert.equal(await mainGroup.evaluate(el => el.open), false);
    await main.getByRole('button', { name: '关闭', exact: true }).click();
    await tab.evaluate(() => {
      const form = document.createElement('form');
      form.id = 'fixture-group-target';
      form.setAttribute('aria-label', '目标 API 表单');
      form.innerHTML = '<label>API 地址<input type="url" name="apiUrl"></label>' +
        '<label>API Key<input type="password" name="apiKey"></label>';
      document.body.append(form);
    });
    const target = tab.locator('#fixture-group-target');
    const url = target.locator('[name="apiUrl"]');
    await url.click();
    await target.getByRole('button', { name: '填入 API', exact: true }).click();
    const picker = dialog(tab, '填入插件 API');
    const groups = picker.locator('.catalog-fill-group');
    const group = name => groups.filter({ has: tab.getByText(name, { exact: true }) });
    const groupNames = () => groups.locator('summary .catalog-fill-group-name').allTextContents();
    const rows = name => group(name).locator('.catalog-fill-summary strong').allTextContents();

    assert.deepEqual(await groupNames(), ['未分类', '乙组', '甲组']);
    assert.deepEqual(await rows('乙组'), ['[示例站点] 乙组专属模型', '[示例站点] 共用模型']);
    assert.deepEqual(await rows('甲组'), ['[示例站点] 甲组专属模型', '[示例站点] 共用模型']);
    assert.equal(await group('乙组').locator('summary .catalog-tag-icon--gemini').count(), 1);
    assert.equal(await group('甲组').evaluate(el => el.open), false);

    const search = picker.getByRole('searchbox');
    await search.fill('甲组专属模型');
    assert.deepEqual(await groupNames(), ['甲组']);
    assert.equal(await group('甲组').evaluate(el => el.open), true);
    await search.fill('不存在的模型');
    await picker.getByText('没有找到 API 配置。').waitFor();
    assert.deepEqual(await groupNames(), []);
    await search.fill('');
    assert.equal(await group('甲组').evaluate(el => el.open), false);

    await group('甲组').locator('summary').press('Enter');
    assert.equal(await group('甲组').evaluate(el => el.open), true);
    await group('甲组').getByRole('button', { name: /填入.*共用模型/ }).click();
    await picker.waitFor({ state: 'hidden' });
    assert.equal(await url.inputValue(), shared.url);
    assert.equal(await target.locator('[name="apiKey"]').inputValue(), shared.key);
    await tab.locator('#st-api-manager-extension-button').click();
    assert.equal(await mainGroup.evaluate(el => el.open), false);
    await assertConnection();
  }));
