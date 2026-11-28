const assert = require('node:assert/strict');
const test = require('node:test');
const { withBrowser } = require('./browser-fixture.cjs');

const catalogKey = 'st_api_manager_catalog_v2';
const uiKey = 'st_api_manager_ui_v1';
const connectionKey = 'st_api_manager_connection_v2';
const searchLabel = '搜索模型名称或备注';
const originalOrder = ['', '甲', '乙', '丙'];

for (const host of ['st', 'tt']) test(host + ': the main search keeps matching models in their tag groups',
  { timeout: 35000 }, () => withBrowser(host, async ({ tab, open, stores, origin, flush, assertConnection }) => {
    const groups = ['甲', '乙', '丙'].map(name => ({ id: name, name: '标签' + name, color: '#3578ab' }));
    const entries = [
      { id: 'shared', model: 'model-alpha', modelNote: '夜间 RAPID', groupIds: ['甲', '乙'] },
      { id: 'named', name: '珍藏版 ALPHA', model: 'fixture-title', groupIds: ['甲'] },
      { id: 'noted-key', model: 'fixture-key-note', credentialId: 'key-note', groupIds: ['乙'] },
      { id: 'other', model: 'unrelated-model', groupIds: ['丙'] },
      { id: 'unassigned', model: 'global-model', groupIds: [] },
    ].map(row => ({
      name: '', site: '合成站点', source: 'custom', url: origin + '/provider/v1',
      key: 'fixture-secret-' + row.id,
      ...row,
    }));
    const catalog = {
      format: 'st-api-manager-catalog', version: 2, groups, entries,
      keyNotes: [{ id: 'key-note', note: '签名通道 BLUE' }],
    };
    stores.set('one', { version: 1, values: {
      [catalogKey]: JSON.stringify({ catalog, sync: { revision: null, pending: false } }),
      [uiKey]: JSON.stringify({ collapsedGroups: ['乙', '丙'], pinAppliedGroup: true }),
      [connectionKey]: JSON.stringify({ appliedRowId: 'shared', appliedGroupId: '乙' }),
    } });

    await open();
    const main = tab.getByRole('dialog', { name: 'API 管理器', exact: true });
    const search = main.getByRole('searchbox', { name: searchLabel, exact: true });
    const section = id => main.locator('.api-config-list > details[data-group-id="' + id + '"]');
    const heading = id => section(id).locator('summary.catalog-group-heading');
    const closed = id => section(id).evaluate(element => !element.open);
    const position = id => heading(id).evaluate(element => getComputedStyle(element).position);
    const waitOrder = ids => tab.waitForFunction(expected => {
      const groups = document.querySelectorAll('dialog[open] .api-config-list > details');
      return JSON.stringify(Array.from(groups, group => group.dataset.groupId)) === JSON.stringify(expected);
    }, ids);
    const cards = id => section(id).locator('.catalog-config-card').evaluateAll(elements =>
      elements.map(element => element.dataset.entryId));

    await search.waitFor();
    assert.equal(await search.getAttribute('placeholder'), searchLabel);
    assert.ok(await search.evaluate(input => {
      const toolbar = input.closest('dialog').querySelector('.api-manager-toolbar');
      return Boolean(toolbar.compareDocumentPosition(input) & Node.DOCUMENT_POSITION_FOLLOWING);
    }));
    await waitOrder(originalOrder);
    assert.equal(await closed('乙'), true);
    assert.equal(await closed('丙'), true);
    await flush();
    const snapshot = { ...stores.get('one').values };

    await heading('乙').waitFor();
    assert.equal(await main.getByText('标签乙', { exact: true }).count(), 1);
    assert.notEqual(await position('乙'), 'sticky');
    await search.fill('  ALPHA  ');
    await waitOrder(['甲', '乙']);
    assert.equal(await closed('乙'), false);
    assert.equal(await position('甲'), 'sticky');
    assert.equal(await position('乙'), 'sticky');
    assert.deepEqual(await cards('乙'), ['shared']);
    assert.deepEqual(await cards('甲'), ['shared', 'named']);
    assert.ok(await search.evaluate(input => input === document.activeElement));

    await search.fill('alpha RAPID');
    await waitOrder(['甲', '乙']);
    assert.deepEqual(await cards('甲'), ['shared']);

    await search.fill('签名 Blue');
    await waitOrder(['乙']);
    assert.deepEqual(await cards('乙'), ['noted-key']);
    await heading('乙').click();
    assert.equal(await closed('乙'), true);
    await section('乙').locator('.catalog-config-card').waitFor({ state: 'hidden' });
    assert.notEqual(await position('乙'), 'sticky');
    await search.fill('BLUE');
    await waitOrder(['乙']);
    assert.equal(await closed('乙'), false);

    await search.fill('GLOBAL-model');
    await waitOrder(['']);
    assert.deepEqual(await cards(''), ['unassigned']);
    await search.fill('fixture-no-results');
    await waitOrder([]);
    await main.getByText('没有匹配的模型，试试其他关键词。', { exact: true }).waitFor();
    assert.equal(await heading('乙').count(), 0);
    await search.fill('');
    await waitOrder(originalOrder);
    assert.equal(await closed('乙'), true);
    assert.equal(await closed('丙'), true);
    assert.deepEqual(await cards('乙'), ['shared', 'noted-key']);

    await search.fill('fixture-title');
    await waitOrder(['甲']);
    assert.equal(await heading('乙').count(), 0);
    await main.getByRole('button', { name: '关闭', exact: true }).click();
    await main.waitFor({ state: 'hidden' });
    await tab.locator('#st-api-manager-extension-button').click();
    await search.waitFor();
    assert.equal(await search.inputValue(), '');
    await waitOrder(originalOrder);
    assert.equal(await closed('乙'), true);
    await flush();
    assert.deepEqual(stores.get('one').values, snapshot);
    await assertConnection();
  }, { viewport: { width: 390, height: 844 }, hasTouch: true }));
