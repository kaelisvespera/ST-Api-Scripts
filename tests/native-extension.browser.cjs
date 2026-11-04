const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { withBrowser } = require('./browser-fixture.cjs');

const preview = process.env.ST_API_UI_PREVIEW;
const exactButton = (pane, name) => pane.getByRole('button', { name, exact: true });
const expectText = (pane, text) => pane.getByText(text, { exact: true }).waitFor();
const openPane = async (tab, from, button, title = button) => {
  await exactButton(from, button).click();
  const pane = tab.getByRole('dialog', { name: title, exact: true });
  await pane.waitFor();
  return pane;
};
const capture = async (tab, name) => {
  if (!preview) return;
  fs.mkdirSync(preview, { recursive: true });
  await tab.screenshot({ path: path.join(preview, name + '.png'), animations: 'disabled' });
};

for (const mode of ['st', 'tt']) {
  test(mode + ': old panel and complete credential management keep the native connection isolated', { timeout: 90000 }, () => withBrowser(mode, async ({
    tab, open, flush, assertConnection, stores, accounts, models, legacySnapshot, origin, secretCalls, secrets, testCalls,
    holdNextModels, failNextModels,
  }) => {
    await open();
    await flush();
    const panel = tab.getByRole('dialog', { name: 'API 管理器', exact: true });
    const rows = panel.locator('.secretKeyManagerItem');
    const initialIds = await rows.evaluateAll(cards => cards.map(card => card.dataset.entryId));
    assert.equal(initialIds.length, 2);
    assert.notEqual(initialIds[0], initialIds[1]);
    assert.equal(await tab.locator('iframe').count(), 0);
    assert.equal(await tab.locator('#host-style').count(), 1);
    assert.equal(await panel.getByRole('button', { name: '切换', exact: true }).count(), 0);
    assert.equal(await panel.getByRole('button', { name: '应用', exact: true }).count(), 2);
    assert.equal(await panel.getByText(/fixture-key-/).count(), 0);
    const layout = () => panel.evaluate(element => {
      const toolbar = element.querySelector('.api-manager-toolbar');
      const box = element.getBoundingClientRect();
      const row = element.querySelector('.secretKeyManagerItem');
      return { width: box.width, left: box.left, right: box.right, direction: getComputedStyle(toolbar).flexDirection,
        overflow: element.scrollWidth > element.clientWidth, rowRadius: getComputedStyle(row).borderRadius,
        rowDirection: getComputedStyle(row).flexDirection };
    });
    await tab.setViewportSize({ width: 1280, height: 900 });
    let desktop = await layout();
    assert.equal(desktop.direction, 'row');
    assert.ok(desktop.width >= 900 && desktop.left > 0 && desktop.right < 1280);
    assert.equal(desktop.rowRadius, '10px');
    assert.equal(desktop.rowDirection, 'row');
    assert.equal(desktop.overflow, false);
    await capture(tab, mode + '-desktop');
    await tab.setViewportSize({ width: 390, height: 844 });
    const mobile = await layout();
    assert.equal(mobile.direction, 'column');
    assert.ok(mobile.width <= 374 && mobile.left >= 8 && mobile.right <= 382);
    assert.equal(mobile.overflow, false);
    await capture(tab, mode + '-mobile');
    const firstDrawer = panel.locator('details.inline-drawer').first();
    await firstDrawer.locator('summary').click();
    assert.equal(await firstDrawer.locator('.secretKeyManagerItem').isVisible(), false);
    await firstDrawer.locator('summary').click();
    await firstDrawer.locator('.secretKeyManagerItem').waitFor();

    const editRow = async index => {
      await exactButton(rows.nth(index), '编辑').click();
      const editor = tab.getByRole('dialog', { name: '编辑 API 配置', exact: true });
      await editor.waitFor();
      return editor;
    };
    let editor = await editRow(0);
    await exactButton(editor, '拉取模型').click();
    await expectText(editor, '已拉取 1 个模型，选择后再保存。');
    assert.equal(await editor.getByRole('checkbox', { name: 'available-for-a', exact: true }).count(), 1);
    assert.equal(await editor.getByRole('checkbox', { name: 'available-for-b', exact: true }).count(), 0);
    await editor.getByLabel('条目备注（可选）').fill('第一个条目的备注');
    await exactButton(editor, '保存').click();
    await editor.waitFor({ state: 'hidden' });
    await expectText(panel, '第一个条目的备注');
    editor = await editRow(1);
    await exactButton(editor, '拉取模型').click();
    await expectText(editor, '已拉取 1 个模型，选择后再保存。');
    failNextModels('fixture-key-b');
    await exactButton(editor, '拉取模型').click();
    await expectText(editor, '模型列表请求失败（HTTP 401），原有配置已保留。');
    assert.equal(await editor.getByRole('checkbox', { name: 'available-for-b', exact: true }).count(), 1);
    assert.equal(await editor.getByLabel('模型', { exact: true }).inputValue(), 'same-model');
    await exactButton(editor, '取消').click();
    await editor.waitFor({ state: 'hidden' });

    const tags = await openPane(tab, panel, '标签设置');
    await tags.getByLabel('新分组名称').fill('第三组');
    await exactButton(tags, '新建分类').click();
    await expectText(tags, '已创建分组。');
    await tags.getByLabel('搜索配置名称或模型').fill('第一个条目的备注');
    await exactButton(tags, '选择当前列表').click();
    await tags.getByRole('checkbox', { name: '第三组', exact: true }).check();
    await exactButton(tags, '添加标签').click();
    await expectText(tags, '已更新所选配置的标签。');
    await exactButton(tags, '移除标签').click();
    await exactButton(tags, '取消').click();
    const manager = await openPane(tab, panel, 'API 管理');
    assert.equal(await manager.locator('.group-list-item').count(), 1);
    await expectText(manager, '2 个密钥');
    editor = await openPane(tab, manager, '添加配置', '添加 API 配置');
    if (mode === 'st') {
      await tab.setViewportSize({ width: 1280, height: 900 });
      await capture(tab, 'st-editor-desktop');
      await tab.setViewportSize({ width: 390, height: 844 });
    }
    await capture(tab, mode + '-editor-mobile');
    await editor.getByLabel('配置组名称').fill('示例站点');
    await editor.getByLabel('站点 URL').fill(origin + '/provider/v1');
    const beforeEmpty = models.length;
    await exactButton(editor, '拉取模型').click();
    await expectText(editor, '请先添加 API 密钥。');
    assert.equal(models.length, beforeEmpty);
    await exactButton(editor, '粘贴多行Key').click();
    await editor.getByLabel('每行一个 API Key').fill('fixture-new-a\nfixture-new-b');
    await exactButton(editor, '批量添加').click();

    const slow = holdNextModels('fixture-new-a');
    try {
      await exactButton(editor, '拉取模型').click();
      await slow.arrived;
      assert.equal(models.at(-1).authorization, 'Bearer fixture-new-a');
      await editor.getByLabel('拉取使用的密钥').selectOption({ label: '第 2 个密钥' });
      await exactButton(editor, '拉取模型').click();
      await expectText(editor, '已拉取 3 个模型，选择后再保存。');
      assert.equal(models.at(-1).authorization, 'Bearer fixture-new-b');
    } finally {
      const resultA = tab.waitForResponse(response => response.url().endsWith('/provider/v1/models') &&
        response.request().headers().authorization === 'Bearer fixture-new-a');
      slow.release();
      await resultA;
    }
    assert.equal(await editor.getByRole('checkbox', { name: 'only-a', exact: true }).count(), 0);
    assert.equal(await editor.getByRole('checkbox', { name: 'only-b', exact: true }).count(), 1);
    async function chooseModels(unique, group) {
      for (const model of ['shared-model', 'second-shared', unique]) {
        await editor.getByRole('checkbox', { name: model, exact: true }).check();
      }
      for (const [i, tag] of [group, group, '第三组'].entries()) {
        const item = editor.locator('.selected-item').nth(i);
        await item.locator('summary').click();
        await item.getByRole('checkbox', { name: tag, exact: true }).check();
      }
    }
    await chooseModels('only-b', '第二组');
    await capture(tab, mode + '-model-groups-mobile');
    await exactButton(editor, '发送测试消息').click();
    await expectText(editor, '连接成功');
    assert.equal(testCalls.length, 1);
    assert.equal(testCalls[0].authorization, 'Bearer fixture-new-b');
    assert.equal(testCalls[0].body.model, 'shared-model');
    assert.equal(testCalls[0].cookie, undefined);
    await exactButton(editor, '管理第 1 个密钥的模型').click();
    assert.equal(await editor.getByText('连接成功', { exact: true }).count(), 0);
    await editor.getByRole('checkbox', { name: 'only-a', exact: true }).waitFor();
    assert.equal(await editor.getByRole('checkbox', { name: 'only-b', exact: true }).count(), 0);
    await chooseModels('only-a', '第一组');
    await editor.getByRole('checkbox', { name: '开启 Key 轮换', exact: true }).check();
    await exactButton(editor, '保存').click();
    await editor.waitFor({ state: 'hidden' });
    await exactButton(manager, '关闭').click();
    await flush();

    let filter = await openPane(tab, panel, '筛选');
    await filter.getByRole('checkbox', { name: /第三组/ }).check();
    await exactButton(filter, '关闭').click();
    assert.equal(await rows.count(), 2);
    filter = await openPane(tab, panel, '筛选');
    await exactButton(filter, '清空').click();
    await exactButton(filter, '关闭').click();
    assert.equal(await rows.count(), 8);
    assert.ok(models.every(request => request.method === 'GET' && request.cookie === undefined));
    await assertConnection();

    await open();
    assert.equal(await rows.count(), 8);
    let data = await openPane(tab, panel, '数据');
    const [download] = await Promise.all([tab.waitForEvent('download'), exactButton(data, '导出').click()]);
    const stream = await download.createReadStream();
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    const payload = Buffer.concat(chunks);
    const exported = JSON.parse(payload.toString());
    const created = exported.entries.filter(row => row.site === '示例站点');
    assert.equal(created.length, 6);
    assert.equal(new Set(created.map(row => row.id)).size, 6);
    assert.equal(new Set(created.map(row => row.rotationPoolId)).size, 1);
    const expected = {
      'fixture-new-a': { 'shared-model': '第一组', 'second-shared': '第一组', 'only-a': '第三组' },
      'fixture-new-b': { 'shared-model': '第二组', 'second-shared': '第二组', 'only-b': '第三组' },
    };
    for (const row of created) {
      assert.equal(row.url, origin + '/provider/v1');
      assert.deepEqual(row.groupIds.map(id => exported.groups.find(group => group.id === id).name), [expected[row.key][row.model]]);
    }
    assert.deepEqual(exported.entries.slice(0, 2).map(row => row.id), initialIds);
    await data.locator('input[type=file]').setInputFiles({ name: 'catalog.json', mimeType: 'application/json', buffer: payload });
    const importMode = tab.getByRole('dialog', { name: '导入方式', exact: true });
    await importMode.getByRole('button', { name: /合并导入/ }).click();
    await expectText(data, '已合并导入配置。');
    assert.equal(await rows.count(), 8);
    await exactButton(data, '同步到账户').click();
    const conflict = tab.getByRole('dialog', { name: '账户同步冲突', exact: true });
    await exactButton(conflict, '取消').click();
    await exactButton(data, '从账户同步').click();
    await exactButton(conflict, '合并').click();
    await expectText(data, '已合并配置并同步到账户。');
    await flush();
    assert.equal(accounts.get('st_api_manager_sync_v1'), legacySnapshot);
    assert.deepEqual(JSON.parse(accounts.get('st_api_manager_sync_v2')).catalog, exported);
    assert.equal(JSON.parse(stores.get('one').values.api_configs_manager).length, 2);
    await assertConnection();
    await open('?device=two');
    data = await openPane(tab, panel, '数据');
    await exactButton(data, '从账户同步').click();
    await expectText(data, '已从账户读取配置。');
    await flush();
    assert.deepEqual(JSON.parse(stores.get('two').values.st_api_manager_catalog_v2).catalog, exported);
    await exactButton(data, '关闭').click();
    await assertConnection();

    const record = (key, model) => created.find(row => row.key === key && row.model === model);
    const apply = async (row, expectedCount) => {
      await exactButton(rows.locator('xpath=self::*[@data-entry-id="' + row.id + '"]'), '应用').click();
      await expectText(panel, '已应用并发起原生连接。');
      await tab.waitForFunction(count => window.nativeRequests.length === count, expectedCount);
      const request = await tab.evaluate(() => window.nativeRequests.at(-1));
      assert.equal(request.source, 'custom');
      assert.equal(request.url, row.url);
      assert.equal(request.model, row.model);
      assert.equal(secrets.get('api_key_custom').find(item => item.id === request.secret_id)?.key, row.key);
      assert.equal(await tab.locator('#custom_model_id').inputValue(), row.model);
      assert.equal(await tab.locator('#model_custom_select').inputValue(), row.model);
      return request.secret_id;
    };
    const firstSecret = await apply(exported.entries[0], 1);
    const secondSecret = await apply(exported.entries[1], 2);
    assert.notEqual(firstSecret, secondSecret);
    assert.equal((await tab.evaluate(() => window.fixtureEmit({ chat_completion_source: 'custom', model: 'same-model',
      custom_url: window.hostConnection.url, secret_id: 'unmodified' }))).secret_id, 'unmodified');
    const secondShared = record('fixture-new-b', 'shared-model');
    const selectedSecret = await apply(secondShared, 3);
    assert.equal(secrets.get('api_key_custom').find(item => item.active).id, selectedSecret);
    const emit = (model, endpoint = secondShared.url) => tab.evaluate(({ model, endpoint }) => window.fixtureEmit({
      chat_completion_source: 'custom', custom_url: endpoint, model, secret_id: 'unmodified',
    }), { model, endpoint });
    const beforeRotationWrites = secretCalls.filter(call => call.action !== 'read').length;
    assert.equal((await emit('only-a')).secret_id, 'unmodified');
    assert.equal((await emit('shared-model', 'https://other.invalid/v1')).secret_id, 'unmodified');
    const rotatedA = (await emit('shared-model')).secret_id;
    assert.equal(secrets.get('api_key_custom').find(item => item.id === rotatedA).key, 'fixture-new-a');
    assert.equal(secrets.get('api_key_custom').find(item => item.active).id, selectedSecret);
    assert.equal(secretCalls.filter(call => call.action !== 'read').length, beforeRotationWrites);
    await apply(record('fixture-new-a', 'second-shared'), 4);
    assert.equal((await emit('second-shared')).secret_id, selectedSecret, 'the next key follows the shared pool across models');
    assert.equal(secrets.get('api_key_custom').find(item => item.active).id, rotatedA, 'rotation only affects the request');
  }));

  test(mode + ': the account conflict dialog honors cancel, each choice, and a newer revision', { timeout: 45000 }, () => withBrowser(mode, async ({
    tab, open, flush, assertConnection, stores, accounts,
  }) => {
    const key = 'st_api_manager_sync_v2';
    await open();
    await flush();
    const readLocal = () => JSON.parse(stores.get('one').values.st_api_manager_catalog_v2).catalog;
    const local = readLocal();
    const account = structuredClone(local);
    account.entries[0].key = 'fixture-conflict-key';
    account.entries[0].rotationPoolId = 'fixture-account-pool';
    account.groups[0].color = '#d84315';
    const seed = (revision, catalog) => {
      const raw = JSON.stringify({ revision, catalog });
      accounts.set(key, raw);
      return raw;
    };
    const initial = seed('remote-1', account);
    const panel = tab.getByRole('dialog', { name: 'API 管理器', exact: true });
    const data = await openPane(tab, panel, '数据');
    const dialog = tab.getByRole('dialog', { name: '账户同步冲突', exact: true });
    const show = async action => {
      await exactButton(data, action).click();
      await dialog.waitFor();
    };
    await show('从账户同步');
    await dialog.getByRole('radio', { name: '账户颜色', exact: true }).check();
    await exactButton(dialog, '取消').click();
    await dialog.waitFor({ state: 'hidden' });
    assert.deepEqual(readLocal(), local);
    assert.equal(accounts.get(key), initial);

    await show('同步到账户');
    const newer = seed('remote-2', account);
    await exactButton(dialog, '使用本机数据').click();
    await expectText(dialog, '选择期间本机或账户数据已变化，请关闭弹窗并重新同步。');
    assert.deepEqual(readLocal(), local);
    assert.equal(accounts.get(key), newer);
    await exactButton(dialog, '取消').click();

    await show('从账户同步');
    await exactButton(dialog, '使用账户数据').click();
    await expectText(data, '已使用账户数据。');
    await flush();
    assert.deepEqual(readLocal(), account);
    assert.equal(accounts.get(key), newer);

    seed('remote-3', local);
    await show('同步到账户');
    await exactButton(dialog, '使用本机数据').click();
    await expectText(data, '已使用本机数据并同步到账户。');
    await flush();
    assert.deepEqual(readLocal(), account);
    assert.deepEqual(JSON.parse(accounts.get(key)).catalog, account);

    seed('remote-4', local);
    await show('从账户同步');
    await dialog.getByRole('radio', { name: '账户颜色', exact: true }).check();
    await capture(tab, mode + '-sync-conflict-mobile');
    await exactButton(dialog, '合并').click();
    await expectText(data, '已合并配置并同步到账户。');
    await flush();
    const merged = readLocal();
    assert.deepEqual(JSON.parse(accounts.get(key)).catalog, merged);
    assert.equal(merged.entries.length, 3);
    assert.equal(new Set(merged.entries.map(row => row.id)).size, 3);
    const duplicate = merged.entries.find(row => row.conflictSourceId === local.entries[0].id);
    assert.equal(duplicate.key, local.entries[0].key);
    assert.deepEqual(duplicate.groupIds, local.entries[0].groupIds);
    assert.equal(merged.entries.find(row => row.id === account.entries[0].id).rotationPoolId, 'fixture-account-pool');
    assert.deepEqual(merged.groups, local.groups);
    await exactButton(data, '从账户同步').click();
    await expectText(data, '已读取此账户版本。');
    assert.deepEqual(readLocal(), merged);
    await assertConnection();
  }));
}

