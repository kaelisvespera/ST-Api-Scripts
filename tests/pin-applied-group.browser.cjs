
const assert = require('node:assert/strict');
const test = require('node:test');
const { withBrowser } = require('./browser-fixture.cjs');

const catalogKey = 'st_api_manager_catalog_v2';
const uiKey = 'st_api_manager_ui_v1';
const originalOrder = ['未分类', '标签甲', '标签乙', '标签丙'];
const pinLabel = '当前应用分组置顶';

for (const host of ['st', 'tt']) test(host + ': the last successfully applied tag group stays on top when enabled',
  { timeout: 45000 }, () => withBrowser(host, async ({ tab, open, stores, origin, flush }) => {
    const groups = ['甲', '乙', '丙'].map(name => ({ id: name, name: '标签' + name, color: '#3578ab' }));
    const entries = [
      { id: 'multi', groupIds: ['甲', '乙'] },
      { id: 'second', groupIds: ['乙'] },
      { id: 'missing-key', groupIds: ['乙'] },
      { id: 'closed', groupIds: ['丙'] },
      { id: 'unassigned', groupIds: [] },
    ].map(row => ({
      name: '', model: row.id, site: '合成站点', source: 'custom', url: origin + '/provider/v1',
      key: row.id === 'missing-key' ? '' : 'fixture-key-a',
      ...row,
    }));
    const groupOrders = [{ groupId: '乙', entryIds: ['second', 'multi', 'missing-key'] }];
    const catalog = { format: 'st-api-manager-catalog', version: 2, groups, entries, groupOrders };
    stores.set('one', { version: 1, values: {
      [catalogKey]: JSON.stringify({ catalog, sync: { revision: null, pending: false } }),
      [uiKey]: JSON.stringify({ collapsedGroups: ['丙'] }),
    } });

    await open();
    const main = tab.getByRole('dialog', { name: 'API 管理器', exact: true });
    const settings = tab.getByRole('dialog', { name: '设置', exact: true });
    const button = (pane, name) => pane.getByRole('button', { name, exact: true });
    const section = name => main.locator('.api-config-list > details').filter({
      has: tab.locator('summary').getByText(name, { exact: true }),
    });
    const card = (name, id) => section(name).locator('.catalog-config-card[data-entry-id="' + id + '"]');
    const order = () => main.locator('.api-config-list > details > summary b').allTextContents();
    const waitOrder = expected => tab.waitForFunction(expected => {
      const titles = document.querySelectorAll('dialog[open] .api-config-list > details > summary b');
      return JSON.stringify([...titles].map(title => title.textContent)) === JSON.stringify(expected);
    }, expected);
    const pin = settings.getByLabel(pinLabel, { exact: true });
    const setPin = async (enabled, expectedBefore) => {
      await button(main, '设置').click();
      assert.equal(await pin.isChecked(), expectedBefore);
      await pin.setChecked(enabled);
      await button(settings, '关闭').click();
    };
    const apply = (name, id) => button(card(name, id), '应用').click();
    const remainsCollapsed = () => section('标签丙').evaluate(element => !element.open);
    const orderWithinB = () => section('标签乙').locator('.catalog-config-card')
      .evaluateAll(cards => cards.map(row => row.dataset.entryId));

    assert.deepEqual(await order(), originalOrder);
    assert.equal(await remainsCollapsed(), true);

    // A use while the preference is off is still the most recent choice.
    await apply('标签乙', 'multi');
    await card('标签乙', 'multi').getByText('已应用', { exact: true }).waitFor();
    assert.deepEqual(await order(), originalOrder);
    await setPin(true, false);
    const bFirst = ['标签乙', '未分类', '标签甲', '标签丙'];
    await waitOrder(bFirst);
    assert.equal(await remainsCollapsed(), true);
    assert.deepEqual(await orderWithinB(), groupOrders[0].entryIds);

    await flush();
    await open();
    await waitOrder(bFirst);
    await button(main, '设置').click();
    assert.equal(await pin.isChecked(), true);
    await button(settings, '关闭').click();
    assert.equal(await remainsCollapsed(), true);

    // Clicking the same model from another tag must move that tag, not the old tag.
    const aFirst = ['标签甲', '未分类', '标签乙', '标签丙'];
    await apply('标签甲', 'multi');
    await waitOrder(aFirst);
    await apply('标签乙', 'missing-key');
    await main.getByText(/这条配置没有密钥/).waitFor();
    assert.deepEqual(await order(), aFirst);

    await setPin(false, true);
    await waitOrder(originalOrder);
    await setPin(true, false);
    await waitOrder(aFirst);
    await apply('未分类', 'unassigned');
    await waitOrder(originalOrder);
    assert.deepEqual(await orderWithinB(), groupOrders[0].entryIds);
    assert.equal(await remainsCollapsed(), true);
    await flush();
    const saved = JSON.parse(stores.get('one').values[catalogKey]).catalog;
    assert.deepEqual(saved.groups, groups);
    assert.deepEqual(saved.groupOrders, groupOrders);
  }));
