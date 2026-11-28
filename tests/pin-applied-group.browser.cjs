
const assert = require('node:assert/strict');
const test = require('node:test');
const { withBrowser } = require('./browser-fixture.cjs');

const catalogKey = 'st_api_manager_catalog_v2';
const uiKey = 'st_api_manager_ui_v1';
const connectionKey = 'st_api_manager_connection_v2';
const originalOrder = ['未分类', '标签甲', '标签乙', '标签丙'];
const pinLabel = '固定当前应用标签';

for (const host of ['st', 'tt']) test(host + ': the last successfully applied tag stays visible while groups scroll',
  { timeout: 45000 }, () => withBrowser(host, async ({ tab, open, stores, origin, flush }) => {
    const groups = ['甲', '乙', '丙'].map(name => ({ id: name, name: '标签' + name, color: '#3578ab' }));
    const fillers = groupId => Array.from({ length: 8 }, (_, i) => ({ id: groupId + '-filler-' + i, groupIds: [groupId] }));
    const aFillers = fillers('甲');
    const bFillers = fillers('乙');
    const entries = [
      ...aFillers,
      ...bFillers,
      { id: 'multi', groupIds: ['乙', '甲'] },
      { id: 'second', groupIds: ['乙'] },
      { id: 'missing-key', groupIds: ['乙'] },
      { id: 'closed', groupIds: ['丙'] },
      { id: 'unassigned', groupIds: [] },
    ].map(row => ({
      name: '', model: row.id, site: '合成站点', source: 'custom', url: origin + '/provider/v1',
      key: row.id === 'missing-key' ? '' : 'fixture-key-a',
      ...row,
    }));
    const groupOrders = [{ groupId: '乙', entryIds: ['second', ...bFillers.map(row => row.id), 'multi', 'missing-key'] }];
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
    const applyButton = (name, id) => button(card(name, id), '应用');
    const apply = (name, id) => applyButton(name, id).click();
    const scroller = main.locator('.popup-scroll-content');
    const fixed = main.locator('.catalog-fixed-group[role="status"]');
    const assertScrolled = async () => assert.ok(await scroller.evaluate(node => node.scrollTop > node.clientHeight));
    const assertFixed = async name => {
      await fixed.getByText(name, { exact: true }).waitFor();
      assert.equal(await fixed.locator('.catalog-fixed-group-name').textContent(), name);
      assert.equal(await fixed.getByText('当前应用', { exact: true }).isVisible(), true);
      const geometry = await fixed.evaluate(node => {
        const dialog = node.closest('dialog');
        const scroll = dialog.querySelector('.popup-scroll-content');
        const search = dialog.querySelector('.catalog-main-search');
        const bar = node.getBoundingClientRect();
        return { insideScroll: scroll.contains(node), top: bar.top, bottom: bar.bottom,
          scrollTopEdge: scroll.getBoundingClientRect().top, searchBottom: search.getBoundingClientRect().bottom };
      });
      assert.equal(geometry.insideScroll, false);
      assert.ok(geometry.top >= geometry.searchBottom - 1 && geometry.bottom <= geometry.scrollTopEdge + 1, JSON.stringify(geometry));
      return geometry.top;
    };
    const remainsCollapsed = () => section('标签丙').evaluate(element => !element.open);
    const orderWithinB = () => section('标签乙').locator('.catalog-config-card')
      .evaluateAll(cards => cards.map(row => row.dataset.entryId));

    assert.deepEqual(await order(), originalOrder);
    assert.equal(await remainsCollapsed(), true);

    // An application while the preference is off still supplies the current tag.
    await apply('标签乙', 'multi');
    await card('标签乙', 'multi').getByText('已应用', { exact: true }).waitFor();
    assert.deepEqual(await order(), originalOrder);
    assert.equal(await fixed.isVisible(), false);
    await assertScrolled();
    await setPin(true, false);
    await assertFixed('标签乙');
    await assertScrolled();
    assert.deepEqual(await order(), originalOrder);
    assert.equal(await remainsCollapsed(), true);
    assert.deepEqual(await orderWithinB(), groupOrders[0].entryIds);

    // Scroll from the beginning through other groups without moving the status bar.
    await scroller.evaluate(node => { node.scrollTop = 0; });
    const beforeWheel = await assertFixed('标签乙');
    const scrollBox = await scroller.boundingBox();
    await tab.mouse.move(scrollBox.x + scrollBox.width / 2, scrollBox.y + scrollBox.height / 2);
    await tab.mouse.wheel(0, 900);
    await tab.waitForFunction(() => {
      const scroll = document.querySelector('dialog[open] .popup-scroll-content');
      return scroll.scrollTop > scroll.clientHeight;
    });
    assert.ok(Math.abs(await assertFixed('标签乙') - beforeWheel) <= 1);

    await button(main, '关闭').click();
    await tab.locator('#st-api-manager-extension-button').click();
    await assertFixed('标签乙');
    assert.deepEqual(await order(), originalOrder);

    await flush();
    await open();
    await assertFixed('标签乙');
    assert.deepEqual(await order(), originalOrder);
    await button(main, '设置').click();
    assert.equal(await pin.isChecked(), true);
    await button(settings, '关闭').click();
    assert.equal(await remainsCollapsed(), true);

    // The same model can set a different tag from its actual clicked row.
    await apply('标签甲', 'multi');
    await assertFixed('标签甲');
    assert.deepEqual(await order(), originalOrder);
    await assertScrolled();
    assert.ok(await applyButton('标签甲', 'multi').evaluate(node => document.activeElement === node));
    await apply('标签乙', 'missing-key');
    await main.getByText(/这条配置没有密钥/).waitFor();
    assert.deepEqual(await order(), originalOrder);
    await assertFixed('标签甲');

    await setPin(false, true);
    await fixed.waitFor({ state: 'hidden' });
    assert.deepEqual(await order(), originalOrder);
    await setPin(true, false);
    await assertFixed('标签甲');
    await apply('未分类', 'unassigned');
    await fixed.waitFor({ state: 'hidden' });
    assert.deepEqual(await order(), originalOrder);
    assert.deepEqual(await orderWithinB(), groupOrders[0].entryIds);
    assert.equal(await remainsCollapsed(), true);
    await flush();
    const saved = JSON.parse(stores.get('one').values[catalogKey]).catalog;
    assert.deepEqual(saved.groups, groups);
    assert.deepEqual(saved.groupOrders, groupOrders);

    // Pre-2.2.26 state remembers only the row, whose membership order differs from the tag order.
    const stored = stores.get('one');
    stores.set('one', { ...stored, values: { ...stored.values,
      [connectionKey]: JSON.stringify({ appliedRowId: 'multi' }),
      [uiKey]: JSON.stringify({ pinAppliedGroup: true, collapsedGroups: ['甲', '丙'] }),
    } });
    await open();
    await waitOrder(originalOrder);
    await assertFixed('标签甲');
    assert.equal(await section('标签甲').evaluate(element => element.open), false);
    assert.equal(await remainsCollapsed(), true);
  }, { viewport: { width: 1280, height: 580 } }));
