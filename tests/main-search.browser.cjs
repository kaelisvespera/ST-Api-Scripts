const assert = require('node:assert/strict');
const test = require('node:test');
const { withBrowser } = require('./browser-fixture.cjs');

const catalogKey = 'st_api_manager_catalog_v2';
const uiKey = 'st_api_manager_ui_v1';
const connectionKey = 'st_api_manager_connection_v2';
const searchLabel = '搜索模型名称或备注';
const originalOrder = ['未分类', '标签甲', '标签乙', '标签丙'];

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
    const fixedTag = main.locator('.catalog-fixed-group[role="status"] .catalog-fixed-group-name').filter({ hasText: /^标签乙$/ });
    const section = name => main.locator('.api-config-list > details').filter({
      has: tab.locator('summary').getByText(name, { exact: true }),
    });
    const closed = name => section(name).evaluate(element => !element.open);
    const waitOrder = expected => tab.waitForFunction(expected => {
      const headings = document.querySelectorAll('dialog[open] .api-config-list > details > summary b');
      return JSON.stringify([...headings].map(heading => heading.textContent)) === JSON.stringify(expected);
    }, expected);
    const cards = name => section(name).locator('.catalog-config-card').evaluateAll(elements =>
      elements.map(element => element.dataset.entryId));

    await search.waitFor();
    assert.equal(await search.getAttribute('placeholder'), searchLabel);
    assert.ok(await search.evaluate(input => {
      const toolbar = input.closest('dialog').querySelector('.api-manager-toolbar');
      return Boolean(toolbar.compareDocumentPosition(input) & Node.DOCUMENT_POSITION_FOLLOWING);
    }));
    await waitOrder(originalOrder);
    assert.equal(await closed('标签乙'), true);
    assert.equal(await closed('标签丙'), true);
    await flush();
    const snapshot = { ...stores.get('one').values };

    await fixedTag.waitFor();
    await search.fill('  ALPHA  ');
    await waitOrder(['标签甲', '标签乙']);
    assert.equal(await fixedTag.isVisible(), true);
    assert.equal(await closed('标签乙'), false);
    assert.deepEqual(await cards('标签乙'), ['shared']);
    assert.deepEqual(await cards('标签甲'), ['shared', 'named']);
    assert.ok(await search.evaluate(input => input === document.activeElement));

    await search.fill('alpha RAPID');
    await waitOrder(['标签甲', '标签乙']);
    assert.deepEqual(await cards('标签甲'), ['shared']);

    await search.fill('签名 Blue');
    await waitOrder(['标签乙']);
    assert.deepEqual(await cards('标签乙'), ['noted-key']);
    await section('标签乙').locator('summary').click();
    assert.equal(await closed('标签乙'), true);
    await search.fill('BLUE');
    await waitOrder(['标签乙']);
    assert.equal(await closed('标签乙'), false);

    await search.fill('GLOBAL-model');
    await waitOrder(['未分类']);
    assert.deepEqual(await cards('未分类'), ['unassigned']);
    await search.fill('fixture-no-results');
    await waitOrder([]);
    assert.equal(await fixedTag.isVisible(), true);
    await search.fill('');
    await waitOrder(originalOrder);
    assert.equal(await closed('标签乙'), true);
    assert.equal(await closed('标签丙'), true);
    assert.deepEqual(await cards('标签乙'), ['shared', 'noted-key']);

    await search.fill('fixture-title');
    await waitOrder(['标签甲']);
    assert.equal(await fixedTag.isVisible(), true);
    await main.getByRole('button', { name: '关闭', exact: true }).click();
    await main.waitFor({ state: 'hidden' });
    await tab.locator('#st-api-manager-extension-button').click();
    await search.waitFor();
    assert.equal(await search.inputValue(), '');
    await waitOrder(originalOrder);
    assert.equal(await closed('标签乙'), true);
    await flush();
    assert.deepEqual(stores.get('one').values, snapshot);
    await assertConnection();
  }, { viewport: { width: 390, height: 844 }, hasTouch: true }));
