const assert = require('node:assert/strict');
const test = require('node:test');
const { withBrowser } = require('./browser-fixture.cjs');

const catalogKey = 'st_api_manager_catalog_v2';
const uiKey = 'st_api_manager_ui_v1';
const connectionKey = 'st_api_manager_connection_v2';
const originalOrder = ['', '甲', '乙', '丙', '丁'];

for (const host of ['st', 'tt']) test(host + ': each expanded group header sticks only while its own cards scroll',
  { timeout: 45000 }, () => withBrowser(host, async ({ tab, open, stores, origin, flush }) => {
    const groups = originalOrder.slice(1).map(name => ({ id: name, name: '标签' + name, color: '#3578ab' }));
    const fillers = groupId => Array.from({ length: 8 }, (_, i) => ({ id: groupId + '-' + i, groupIds: [groupId] }));
    const bFillers = fillers('乙').reverse();
    const entries = [
      ...fillers('甲'),
      ...fillers('乙'),
      { id: 'current', groupIds: ['丙'] },
      ...fillers('丁'),
      { id: 'unassigned', groupIds: [] },
    ].map(row => ({
      name: '', model: row.id, site: '合成站点', source: 'custom', url: origin + '/provider/v1',
      key: 'fixture-key-a', ...row,
    }));
    const groupOrders = [{ groupId: '乙', entryIds: bFillers.map(row => row.id) }];
    const catalog = { format: 'st-api-manager-catalog', version: 2, groups, entries, groupOrders };
    stores.set('one', { version: 1, values: {
      [catalogKey]: JSON.stringify({ catalog, sync: { revision: null, pending: false } }),
      [uiKey]: JSON.stringify({ collapsedGroups: ['丙'] }),
      [connectionKey]: JSON.stringify({ appliedRowId: 'current', appliedGroupId: '丙' }),
    } });

    await open();
    const main = tab.getByRole('dialog', { name: 'API 管理器', exact: true });
    const settings = tab.getByRole('dialog', { name: '设置', exact: true });
    const button = (pane, name) => pane.getByRole('button', { name, exact: true });
    const section = id => main.locator('.api-config-list > details[data-group-id="' + id + '"]');
    const header = id => section(id).locator('summary.catalog-group-heading');
    const cards = id => section(id).locator('.catalog-config-card');
    const order = () => main.locator('.api-config-list > details[data-group-id]')
      .evaluateAll(items => items.map(item => item.dataset.groupId));
    const orderWithinB = () => cards('乙').evaluateAll(items => items.map(item => item.dataset.entryId));
    const pin = settings.getByLabel('展开分组标题吸顶', { exact: true });
    const setPin = async (enabled, expectedBefore) => {
      await button(main, '设置').click();
      assert.equal(await pin.isChecked(), expectedBefore);
      await pin.setChecked(enabled);
      await button(settings, '关闭').click();
    };
    const scroller = main.locator('.popup-scroll-content');
    const scrollTo = y => scroller.evaluate((node, top) => node.scrollTo({ top, behavior: 'instant' }), y);
    const y = node => node.evaluate(element => {
      const scroll = element.closest('.popup-scroll-content');
      return element.getBoundingClientRect().top - scroll.getBoundingClientRect().top - scroll.clientTop;
    });
    const assertAtTop = async id => {
      const position = await y(header(id));
      assert.ok(Math.abs(position) <= 1, JSON.stringify({ id, position }));
      assert.ok(await header(id).evaluate(node => {
        const bar = node.getBoundingClientRect();
        return node.contains(document.elementFromPoint(bar.left + bar.width / 2, bar.top + bar.height / 2));
      }), 'the sticky summary must be the actual interactive header on top of its cards');
    };

    assert.deepEqual(await order(), originalOrder);
    assert.equal(await section('丙').evaluate(node => node.open), false);
    assert.deepEqual(await orderWithinB(), groupOrders[0].entryIds);
    const disabledTop = await y(header('甲'));
    await scrollTo(Math.ceil(disabledTop) + 90);
    assert.ok(await y(header('甲')) < -70);
    await setPin(true, false);

    await scrollTo(0);
    const aTop = await y(header('甲'));
    const bTop = await y(header('乙'));
    const cTop = await y(header('丙'));
    const firstBCard = cards('乙').first();
    const firstBCardTop = await y(firstBCard);
    await scrollTo(Math.floor(aTop) - 25);
    assert.ok(await y(header('甲')) > 20);
    await scrollTo(Math.ceil(aTop) + 90);
    await assertAtTop('甲');
    assert.equal(await main.getByText('标签甲', { exact: true }).count(), 1);
    assert.equal(await main.getByText('当前应用', { exact: true }).count(), 0);
    assert.equal(await header('甲').locator('.category-count').textContent(), '(8)');
    assert.equal(await header('甲').locator('.catalog-group-rail').evaluate(node => getComputedStyle(node).backgroundColor),
      'rgb(53, 120, 171)');
    assert.equal(await header('甲').locator('.category-color-dot').count(), 1);

    // The next open group takes over and the earlier header releases at its cards' boundary.
    await scrollTo(Math.floor(bTop) - 8);
    assert.ok(await y(header('甲')) < -5);
    assert.ok(await y(header('乙')) >= 7);
    await scrollTo(Math.ceil(bTop) + 90);
    await assertAtTop('乙');
    assert.ok(await y(header('甲')) < -50);
    await scrollTo(Math.ceil(cTop) + 90);
    assert.ok(await y(header('丙')) < -70, 'the collapsed applied group scrolls away normally');

    // The original title must hide pixels under it, even with a competing translucent host drawer style.
    const translucentTheme = await tab.addStyleTag({ content: `
      :is(#test-host-theme, .api-config-list) > details.inline-drawer {
        overflow: hidden !important;
        opacity: .7 !important;
      }
      :is(#test-host-theme, details[data-group-id]) > .inline-drawer-header {
        background: rgb(210 170 115 / 25%) !important;
        opacity: .6 !important;
        filter: blur(.5px) !important;
        mix-blend-mode: multiply !important;
        backdrop-filter: invert(1) !important;
      }
    ` });
    await scrollTo(Math.ceil(firstBCardTop) + 8);
    await assertAtTop('乙');
    const box = await header('乙').boundingBox();
    const mobile = await tab.evaluate(() => matchMedia('(hover: none) and (pointer: coarse)').matches);
    const radius = await header('乙').evaluate(node => getComputedStyle(node).borderTopLeftRadius);
    assert.equal(radius, mobile ? '5px' : '0px', 'a phone keeps rounded corners and the desktop keeps its existing shape');
    let corner;
    if (mobile) {
      // Move the existing card under the rounded corner too, beyond the normal card inset.
      await firstBCard.evaluate((node, headerLeft) => {
        const inset = node.getBoundingClientRect().left - headerLeft + 1;
        node.style.setProperty('margin-inline-start', -inset + 'px', 'important');
        node.style.setProperty('border-radius', '0', 'important');
      }, box.x);
      corner = { x: Math.ceil(box.x), y: Math.ceil(box.y), width: 4, height: 4 };
      assert.ok(await firstBCard.evaluate((node, clip) =>
        document.elementsFromPoint(clip.x + .5, clip.y + .5).includes(node), corner),
      'the changing card must also overlap the rounded corner');
    }
    const covered = { x: Math.ceil(box.x + box.width / 2), y: Math.ceil(box.y),
      width: 20, height: Math.floor(box.y + box.height) - Math.ceil(box.y) };
    const exposed = { x: covered.x, y: Math.ceil(box.y + box.height) + 4, width: 20, height: 8 };
    assert.ok(await firstBCard.evaluate((node, clip) => document.elementsFromPoint(
      clip.x + clip.width / 2, clip.y + clip.height / 2,
    ).includes(node), covered), 'the changing card must overlap the sticky title');
    const paintCard = color => firstBCard.evaluate((node, value) => node.style.setProperty('background', value, 'important'), color);
    await firstBCard.evaluate(node => Object.assign(node.style, { position: 'relative', zIndex: '99' }));
    await assertAtTop('乙');
    await paintCard('#ff00ff');
    const coveredBefore = await tab.screenshot({ clip: covered });
    const exposedBefore = await tab.screenshot({ clip: exposed });
    const cornerBefore = corner && await tab.screenshot({ clip: corner });
    await paintCard('#00ffff');
    assert.ok(!exposedBefore.equals(await tab.screenshot({ clip: exposed })), 'exposed card pixels must change');
    assert.ok(coveredBefore.equals(await tab.screenshot({ clip: covered })), 'the sticky title fully covers the scrolling card');
    if (corner) assert.ok(cornerBefore.equals(await tab.screenshot({ clip: corner })), 'the rounded corner also covers the scrolling card');
    await firstBCard.evaluate(node => {
      for (const property of ['background', 'position', 'z-index', 'margin-inline-start', 'border-radius']) {
        node.style.removeProperty(property);
      }
    });
    await translucentTheme.evaluate(node => node.remove());

    // Tab reveals the next action even when the whole button row was behind the sticky title.
    const focusCard = cards('乙').nth(3);
    const editAction = button(focusCard, '编辑');
    await button(focusCard, '应用').evaluate(node => node.focus({ preventScroll: true }));
    await scrollTo(await scroller.evaluate(node => node.scrollTop) + await y(editAction) - 5);
    await assertAtTop('乙');
    const canHitAction = () => editAction.evaluate(node => {
      const bounds = node.getBoundingClientRect();
      return node.contains(document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2));
    });
    assert.equal(await canHitAction(), false, 'the sticky title covers the next keyboard target initially');
    await tab.keyboard.press('Tab');
    assert.ok(await editAction.evaluate(node => node === document.activeElement));
    assert.ok(await y(editAction) >= (await header('乙').boundingBox()).height - 1);
    assert.ok(await canHitAction(), 'the focused action is visible below the sticky title');

    // Native keyboard disclosure and sorting stay on the same header.
    await button(header('乙'), '排序').click();
    await section('乙').getByRole('button', { name: '拖动排序：乙-7', exact: true }).waitFor();
    await button(header('乙'), '完成').click();
    await section('乙').getByRole('button', { name: '拖动排序：乙-7', exact: true }).waitFor({ state: 'hidden' });
    const bHeight = await section('乙').evaluate(node => node.getBoundingClientRect().height);
    await scrollTo(Math.ceil(bTop + bHeight / 2));
    await assertAtTop('乙');
    await header('乙').evaluate(node => node.focus({ preventScroll: true }));
    await tab.keyboard.press('Space');
    await firstBCard.waitFor({ state: 'hidden' });
    await header('乙').locator('.fa-circle-chevron-down').waitFor();
    assert.ok(await header('乙').evaluate(node => {
      const scroll = node.closest('.popup-scroll-content');
      const bar = node.getBoundingClientRect();
      const top = scroll.getBoundingClientRect().top + scroll.clientTop;
      return getComputedStyle(node).position !== 'sticky' && document.activeElement === node
        && bar.top >= top - 1 && bar.bottom <= top + scroll.clientHeight + 1;
    }), 'the collapsed summary remains in view and keeps keyboard focus');
    await tab.keyboard.press('Enter');
    await firstBCard.waitFor();
    await header('乙').locator('.fa-circle-chevron-up').waitFor();
    assert.deepEqual(await orderWithinB(), groupOrders[0].entryIds);

    await scrollTo(Math.ceil(aTop) + 90);
    await assertAtTop('甲');
    await scrollTo(0);
    assert.ok(Math.abs(await y(header('甲')) - aTop) <= 1);
    assert.deepEqual(await order(), originalOrder);
    await flush();
    assert.deepEqual(JSON.parse(stores.get('one').values[catalogKey]).catalog.groupOrders, groupOrders);

    // The old preference key is still read on reload; the applied group remains collapsed.
    await open();
    await button(main, '设置').click();
    assert.equal(await pin.isChecked(), true);
    await button(settings, '关闭').click();
    assert.equal(await section('丙').evaluate(node => node.open), false);
    await scrollTo(Math.ceil(await y(header('甲'))) + 90);
    await assertAtTop('甲');
    assert.deepEqual(await order(), originalOrder);
  }, host === 'tt' ? { viewport: { width: 1280, height: 580 } }
    : { viewport: { width: 390, height: 740 }, hasTouch: true }));
