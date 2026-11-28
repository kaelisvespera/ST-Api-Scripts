
const assert = require('node:assert/strict');
const test = require('node:test');
const { withBrowser } = require('./browser-fixture.cjs');

const catalogKey = 'st_api_manager_catalog_v2';
const uiKey = 'st_api_manager_ui_v1';
const connectionKey = 'st_api_manager_connection_v2';
const originalOrder = ['', '甲', '乙', '丙'];
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
    const section = id => main.locator('.api-config-list > [data-group-id="' + id + '"]');
    const card = (groupId, id) => section(groupId).locator('.catalog-config-card[data-entry-id="' + id + '"]');
    const order = () => main.locator('.api-config-list > [data-group-id]')
      .evaluateAll(items => items.map(item => item.dataset.groupId));
    const pin = settings.getByLabel(pinLabel, { exact: true });
    const setPin = async (enabled, expectedBefore) => {
      await button(main, '设置').click();
      assert.equal(await pin.isChecked(), expectedBefore);
      await pin.setChecked(enabled);
      await button(settings, '关闭').click();
    };
    const applyButton = (groupId, id) => button(card(groupId, id), '应用');
    const apply = (groupId, id) => applyButton(groupId, id).click();
    const scroller = main.locator('.popup-scroll-content');
    const fixed = main.locator('.catalog-fixed-group');
    const fixedHeader = fixed.locator('details > summary.inline-drawer-header.catalog-group-heading');
    const assertScrolled = async () => assert.ok(await scroller.evaluate(node => node.scrollTop > node.clientHeight));
    const assertFixed = async id => {
      const name = '标签' + id;
      await fixedHeader.getByText(name, { exact: true }).waitFor();
      assert.equal(await main.getByText(name, { exact: true }).count(), 1);
      assert.equal(await main.getByText('当前应用', { exact: true }).count(), 0);
      assert.equal(await fixed.getAttribute('role'), null);
      assert.equal(await fixedHeader.evaluate(node => node.parentElement.dataset.groupId), id);
      assert.equal(await fixedHeader.getAttribute('aria-controls'), 'st-api-manager-docked-group-content');
      assert.equal(await section(id).getAttribute('id'), 'st-api-manager-docked-group-content');
      assert.ok(await section(id).evaluate(node => node.matches('div.catalog-docked-body')));
      assert.equal(await fixedHeader.locator('.category-count').textContent(),
        '(' + await section(id).locator('.catalog-config-card').count() + ')');
      assert.equal(await fixedHeader.locator('.catalog-group-rail').evaluate(node => getComputedStyle(node).backgroundColor),
        'rgb(53, 120, 171)');
      assert.equal(await fixedHeader.locator('.category-color-dot').count(), 1);
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
    const remainsCollapsed = () => section('丙').evaluate(element => !element.open);
    const orderWithinB = () => section('乙').locator('.catalog-config-card')
      .evaluateAll(cards => cards.map(row => row.dataset.entryId));

    assert.deepEqual(await order(), originalOrder);
    assert.equal(await remainsCollapsed(), true);

    // An application while the preference is off still supplies the current tag.
    await apply('乙', 'multi');
    await card('乙', 'multi').getByText('已应用', { exact: true }).waitFor();
    assert.deepEqual(await order(), originalOrder);
    assert.equal(await fixed.isVisible(), false);
    await assertScrolled();
    await setPin(true, false);
    await assertFixed('乙');
    await assertScrolled();
    assert.deepEqual(await order(), originalOrder);
    assert.equal(await remainsCollapsed(), true);
    assert.deepEqual(await orderWithinB(), groupOrders[0].entryIds);

    // The docked original bar still controls its cards and their sort mode.
    await fixedHeader.press('Space');
    await section('乙').waitFor({ state: 'hidden' });
    assert.equal(await fixedHeader.locator('.fa-circle-chevron-down').count(), 1);
    await fixedHeader.press('Enter');
    await section('乙').waitFor();
    assert.equal(await fixedHeader.locator('.fa-circle-chevron-up').count(), 1);
    await button(fixedHeader, '排序').click();
    await section('乙').getByRole('button', { name: '拖动排序：second', exact: true }).waitFor();
    await button(fixedHeader, '完成').click();
    await section('乙').getByRole('button', { name: '拖动排序：second', exact: true }).waitFor({ state: 'hidden' });
    assert.deepEqual(await orderWithinB(), groupOrders[0].entryIds);

    // Scroll from the beginning through other groups without moving the original header.
    await scroller.evaluate(node => { node.scrollTop = 0; });
    const beforeWheel = await assertFixed('乙');
    const scrollBox = await scroller.boundingBox();
    await tab.mouse.move(scrollBox.x + scrollBox.width / 2, scrollBox.y + scrollBox.height / 2);
    await tab.mouse.wheel(0, 900);
    await tab.waitForFunction(() => {
      const scroll = document.querySelector('dialog[open] .popup-scroll-content');
      return scroll.scrollTop > scroll.clientHeight;
    });
    assert.ok(Math.abs(await assertFixed('乙') - beforeWheel) <= 1);

    await button(main, '关闭').click();
    await tab.locator('#st-api-manager-extension-button').click();
    await assertFixed('乙');
    assert.deepEqual(await order(), originalOrder);

    await flush();
    await open();
    await assertFixed('乙');
    assert.deepEqual(await order(), originalOrder);
    await button(main, '设置').click();
    assert.equal(await pin.isChecked(), true);
    await button(settings, '关闭').click();
    assert.equal(await remainsCollapsed(), true);

    // The same model can set a different tag from its actual clicked row.
    await apply('甲', 'multi');
    await assertFixed('甲');
    assert.deepEqual(await order(), originalOrder);
    await assertScrolled();
    assert.ok(await applyButton('甲', 'multi').evaluate(node => document.activeElement === node));
    await apply('乙', 'missing-key');
    await main.getByText(/这条配置没有密钥/).waitFor();
    assert.deepEqual(await order(), originalOrder);
    await assertFixed('甲');

    await setPin(false, true);
    await fixedHeader.waitFor({ state: 'hidden' });
    assert.deepEqual(await order(), originalOrder);
    await setPin(true, false);
    await assertFixed('甲');
    await apply('', 'unassigned');
    await fixedHeader.waitFor({ state: 'hidden' });
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
    await assertFixed('甲');
    assert.deepEqual(await order(), originalOrder);
    assert.equal(await fixedHeader.evaluate(node => node.parentElement.open), false);
    assert.equal(await section('甲').isVisible(), false);
    assert.equal(await remainsCollapsed(), true);
  }, { viewport: { width: 1280, height: 580 } }));
