const test = require('node:test');
const assert = require('node:assert/strict');
const { withBrowser } = require('./browser-fixture.cjs');

for (const mode of ['st', 'tt']) {
  test(mode + ': complete native extension keeps credentials separate and leaves chat untouched', { timeout: 45000 }, () => withBrowser(mode, async ({ tab, open, flush, assertConnection, stores, accounts, models, legacySnapshot, origin }) => {
    await open();
    await flush();
    const panel = tab.getByRole('dialog');
    const click = name => panel.getByRole('button', { name, exact: true }).click();
    const expectText = text => panel.getByText(text, { exact: true }).waitFor();
    const rows = panel.locator('article');
    const edit = async index => rows.nth(index).getByRole('button', { name: '编辑', exact: true }).click();
    await expectText('已保存密钥 · 第一组');
    await expectText('已保存密钥 · 第二组');
    const ids = await rows.evaluateAll(cards => cards.map(card => card.dataset.entryId));
    assert.equal(ids.length, 2);
    assert.notEqual(ids[0], ids[1]);
    assert.equal(await panel.getByText('same-model', { exact: true }).count(), 2);
    assert.equal(await tab.locator('iframe').count(), 0);
    assert.equal(await tab.locator('#host-style').count(), 1);
    assert.equal(await panel.getByRole('button', { name: /切换|应用|轮换|检测|测试消息/ }).count(), 0);
    assert.equal(await panel.getByText(/fixture-key-/).count(), 0);

    await edit(0);
    await click('拉取模型');
    await expectText('已拉取 1 个模型，选择后再保存。');
    assert.equal(await panel.getByRole('option', { name: 'available-for-a', exact: true }).count(), 1);
    assert.equal(await panel.getByRole('option', { name: 'available-for-b', exact: true }).count(), 0);
    await panel.getByLabel('条目备注（可选）').fill('第一个条目的备注');
    await click('保存配置');
    await expectText('已保存配置。');
    await edit(1);
    await click('拉取模型');
    await expectText('已拉取 1 个模型，选择后再保存。');
    assert.equal(await panel.getByRole('option', { name: 'available-for-b', exact: true }).count(), 1);
    await panel.getByLabel('API 密钥', { exact: true }).fill('fixture-rejected');
    await click('拉取模型');
    await expectText('模型列表请求失败（HTTP 401），原有配置已保留。');
    assert.equal(await panel.getByLabel('模型', { exact: true }).inputValue(), 'same-model');
    await click('返回');
    await edit(1);
    assert.equal(await panel.getByLabel('API 密钥', { exact: true }).inputValue(), 'fixture-key-b');
    await click('返回');
    assert.deepEqual(models, ['fixture-key-a', 'fixture-key-b', 'fixture-rejected'].map(key => ({
      method: 'GET', path: '/provider/v1/models', authorization: 'Bearer ' + key, cookie: undefined,
    })));

    await click('管理分组');
    await panel.getByLabel('新分组名称').fill('第三组');
    await click('创建分组');
    await expectText('已创建分组。');
    await click('返回');
    await click('新增配置');
    await panel.getByLabel('站点名称').fill('共用站点');
    await panel.getByLabel('站点 URL').fill(origin + '/provider/v1');
    await panel.getByLabel('API 密钥', { exact: true }).fill('fixture-key-c');
    await panel.getByLabel('模型（每行一个，可留空）').fill('same-model\nnew-model');
    await panel.getByRole('checkbox', { name: '第三组' }).check();
    await click('保存配置');
    await expectText('已保存配置。');
    await panel.getByLabel('按分组筛选').selectOption({ label: '第三组' });
    assert.equal(await rows.count(), 2);
    assert.equal(await panel.getByText('new-model', { exact: true }).count(), 1);
    await panel.getByLabel('按分组筛选').selectOption('');
    assert.equal(await rows.count(), 4);
    await assertConnection();
    await flush();

    await open();
    assert.equal(await rows.count(), 4);
    assert.deepEqual((await rows.evaluateAll(cards => cards.map(card => card.dataset.entryId))).slice(0, 2), ids);
    const [download] = await Promise.all([tab.waitForEvent('download'), click('导出')]);
    const stream = await download.createReadStream();
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    const payload = Buffer.concat(chunks);
    const exported = JSON.parse(payload.toString());
    assert.deepEqual(exported.entries.map(row => row.key), ['fixture-key-a', 'fixture-key-b', 'fixture-key-c', 'fixture-key-c']);
    assert.equal(exported.entries[0].id, ids[0]);
    await panel.locator('input[type="file"]').setInputFiles({ name: 'catalog.json', mimeType: 'application/json', buffer: payload });
    await expectText('已合并导入配置。');
    assert.equal(await rows.count(), 4);

    await click('同步到账户');
    await expectText('账户上有尚未读取的数据。请先点「从账户读取」，再上传合并后的配置。');
    await click('从账户读取');
    await expectText('已合并账户与本机配置；可将合并后的版本同步到账户。');
    await click('同步到账户');
    await expectText('已写入酒馆账户存储。');
    await flush();
    assert.equal(accounts.get('st_api_manager_sync_v1'), legacySnapshot);
    assert.deepEqual(JSON.parse(accounts.get('st_api_manager_sync_v2')).catalog.entries.map(row => row.id),
      exported.entries.map(row => row.id));
    assert.equal(JSON.parse(stores.get('one').values.api_configs_manager).length, 2);
    await assertConnection();

    await open('?device=two');
    assert.equal(await rows.count(), 0);
    await click('从账户读取');
    await expectText('已从账户读取配置。');
    assert.deepEqual(await rows.evaluateAll(cards => cards.map(card => card.dataset.entryId)), exported.entries.map(row => row.id));
    await assertConnection();
  }));
}
