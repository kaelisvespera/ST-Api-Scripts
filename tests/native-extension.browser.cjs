const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { withBrowser } = require('./browser-fixture.cjs');
const { config, legacyValues } = require('./catalog-fixture.cjs');

const preview = process.env.ST_API_UI_PREVIEW;
const exactButton = (pane, name) => pane.getByRole('button', { name, exact: true });
const expectText = (pane, text) => pane.getByText(text, { exact: true }).waitFor();
const rowAction = async (tab, row, name) => {
  await exactButton(row, '更多操作').click();
  await exactButton(tab.getByRole('dialog', { name: '更多操作', exact: true }), name).click();
};
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
const assertOneRow = async (locator, count) => {
  const boxes = await locator.evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().toJSON()));
  assert.equal(boxes.length, count);
  const centerY = box => box.top + box.height / 2;
  assert.ok(boxes.every(box => Math.abs(centerY(box) - centerY(boxes[0])) < 1));
  return boxes;
};

for (const mode of ['st', 'tt']) {
  test(mode + ': old panel and complete credential management keep the native connection isolated', { timeout: 90000 }, () => withBrowser(mode, async ({
    tab, open, flush, assertConnection, stores, accounts, models, legacySnapshot, origin, secretCalls, secrets, testCalls,
    holdNextModels, failNextModels,
  }) => {
    await open();
    await flush();
    const panel = tab.getByRole('dialog', { name: 'API 管理器', exact: true });
    const entry = tab.locator('#extensionsMenu > .extension_container > .list-group-item');
    assert.equal(await entry.locator('.fa-plug').count(), 1);
    await exactButton(panel, '关闭').click();
    await entry.press('Enter');
    await panel.waitFor();
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
      const box = element.getBoundingClientRect();
      const row = element.querySelector('.secretKeyManagerItem');
      return { width: box.width, left: box.left, right: box.right,
        overflow: element.scrollWidth > element.clientWidth, rowRadius: getComputedStyle(row).borderRadius,
        rowDisplay: getComputedStyle(row).display };
    });
    await tab.setViewportSize({ width: 1280, height: 900 });
    const desktop = await layout();
    assert.equal(desktop.width, 800);
    assert.ok(desktop.left > 0 && desktop.right < 1280);
    assert.equal(desktop.rowRadius, '10px');
    assert.equal(desktop.rowDisplay, 'grid');
    assert.equal(desktop.overflow, false);
    await capture(tab, mode + '-desktop');
    await tab.setViewportSize({ width: 375, height: 812 });
    await assertOneRow(panel.locator('.api-manager-toolbar > button'), 5);
    await tab.setViewportSize({ width: 390, height: 844 });
    const mobile = await layout();
    assert.ok(mobile.width <= 358 && mobile.left >= 16 && mobile.right <= 374);
    assert.equal(mobile.overflow, false);
    await assertOneRow(panel.locator('.api-manager-toolbar > button'), 5);
    await capture(tab, mode + '-mobile');
    const firstDrawer = panel.locator('details.inline-drawer').first();
    await firstDrawer.locator('summary').click();
    assert.equal(await firstDrawer.locator('.secretKeyManagerItem').isVisible(), false);
    await firstDrawer.locator('summary').click();
    await firstDrawer.locator('.secretKeyManagerItem').waitFor();

    const editRow = async index => {
      await rowAction(tab, rows.nth(index), '编辑');
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
    await assertOneRow(tags.locator('.selection-toolbar > button'), 3);
    await assertOneRow(tags.locator('.catalog-tag-actions > button'), 4);
    await capture(tab, mode + '-tag-settings-mobile');
    await tags.getByLabel('新分组名称').fill('第三组');
    await exactButton(tags, '新建分类').click();
    await expectText(tags, '已创建分组。');
    await tags.getByLabel('搜索组名、模型、标题或备注').fill('第一个条目的备注');
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
    await assertOneRow(editor.locator('.key-batch-actions-row > button'), 2);
    const buttons = await assertOneRow(editor.locator('.api-config-edit-modal__key-actions').first().locator('button'), 4);
    assert.ok(buttons.every((box, i) => box.width >= 34 && box.height >= 34 &&
      (i === 0 || box.left - buttons[i - 1].right >= 6)));
    assert.equal(await editor.getByText(/Key 轮换/).count(), 0);
    await editor.locator('.key-batch-actions-row').scrollIntoViewIfNeeded();
    await capture(tab, mode + '-key-actions-mobile');

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
    assert.ok(created.every(row => !Object.hasOwn(row, 'rotationPoolId')));
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
    const beforeGeneration = secretCalls.length;
    for (let i = 0; i < 2; i++) assert.equal((await emit('shared-model')).secret_id, 'unmodified');
    assert.equal(secrets.get('api_key_custom').find(item => item.active).id, selectedSecret);
    assert.equal(secretCalls.length, beforeGeneration);
    const manuallySelected = await apply(record('fixture-new-a', 'second-shared'), 4);
    assert.equal((await emit('second-shared')).secret_id, 'unmodified');
    assert.equal(secrets.get('api_key_custom').find(item => item.active).id, manuallySelected);
  }));

  test(mode + ': key and model notes survive edits and imports across screen sizes', { timeout: 90000 }, () => withBrowser(mode, async ({
    tab, open, flush, assertConnection, stores,
  }) => {
    const panel = tab.getByRole('dialog', { name: 'API 管理器', exact: true });
    const editor = tab.getByRole('dialog', { name: '编辑 API 配置', exact: true });
    const readCatalog = async () => {
      await flush();
      return JSON.parse(stores.get('one').values.st_api_manager_catalog_v2).catalog;
    };
    const readNote = (catalog, row) => catalog.keyNotes.find(note => note.id === row.credentialId)?.note;
    const card = row => panel.locator('[data-entry-id="' + row.id + '"]');
    const selectKey = index => exactButton(editor, '管理第 ' + index + ' 个密钥的模型').click();
    const saveEditor = async () => {
      await exactButton(editor, '保存').click();
      await editor.waitFor({ state: 'hidden' });
    };
    await open();
    const older = await readCatalog();
    const [first, second] = older.entries;
    await rowAction(tab, card(first), '编辑');
    await editor.getByLabel('密钥备注', { exact: true }).fill('CCMAX');
    await editor.getByLabel('模型备注', { exact: true }).fill('0.5/次');
    await saveEditor();
    await expectText(card(first), 'CCMAX');
    await expectText(card(first), '0.5/次');
    assert.equal(await card(second).getByText('CCMAX').count(), 0);
    const manager = await openPane(tab, panel, 'API 管理');
    await exactButton(manager, '编辑此组的端点、密钥和模型').click();
    const keyNotes = editor.getByLabel('密钥备注', { exact: true });
    const modelNotes = editor.getByLabel('模型备注', { exact: true });
    assert.equal(await keyNotes.first().inputValue(), 'CCMAX');
    assert.equal(await modelNotes.first().inputValue(), '0.5/次');
    await editor.getByLabel('手动输入模型 ID').fill('additional-model');
    await exactButton(editor, '添加模型').click();
    await modelNotes.nth(1).fill('额外模型的独立备注');
    const longNote = '备用账号\n' + 'LongTextWithoutSpaces'.repeat(30);
    await keyNotes.nth(1).fill(longNote);
    await selectKey(2);
    await modelNotes.first().fill('0.2/次');
    await selectKey(1);
    assert.equal(await modelNotes.first().inputValue(), '0.5/次');

    await tab.addStyleTag({ content: mode === 'tt'
      ? ':root{--mainFontSize:18px;--SmartThemeBodyColor:#182631;--SmartThemeBlurTintColor:#d7e1e8;--SmartThemeBorderColor:#6b8394;--SmartThemeQuoteColor:#245e92}.menu_button,.text_pole,select{background:#f6fafc}'
      : ':root{--mainFontSize:18px}' });
    const sizes = [[320, 568], [375, 812], [390, 844], [430, 932], [667, 375], [844, 390],
      [768, 1024], [1024, 768], [1280, 900]];
    for (const [width, height] of sizes) {
      await tab.setViewportSize({ width, height });
      for (const dialog of [panel, editor]) {
        const fit = await dialog.evaluate(element => {
          const { left, right, top, bottom } = element.getBoundingClientRect();
          const scroll = element.querySelector('.popup-scroll-content');
          const footer = element.querySelector('.popup-controls');
          return { left, right, top, bottom, overflow: scroll.scrollWidth - scroll.clientWidth,
            footerBottom: footer.getBoundingClientRect().bottom,
            buttonsFit: [...footer.querySelectorAll('button')].every(button => {
              const rect = button.getBoundingClientRect();
              return rect.left >= left && rect.right <= right && rect.bottom <= bottom;
            }) };
        });
        const device = mode + ' ' + width + '×' + height + ' ' + await dialog.getAttribute('aria-label');
        assert.ok(fit.left >= 15 && fit.right <= width - 15 && fit.top >= 15 && fit.bottom <= height - 15, device + ' margins');
        assert.ok(fit.overflow <= 1 && fit.footerBottom <= fit.bottom && fit.buttonsFit, device + ' overflow ' + JSON.stringify(fit));
      }
      if (width <= 430) {
        const input = await editor.getByLabel('输入 API Key', { exact: true }).boundingBox();
        assert.ok(input.width >= 200, mode + ' ' + width + ' credential entry field');
      }
      if ([390, 768, 844, 1280].includes(width)) {
        await keyNotes.first().scrollIntoViewIfNeeded();
        await capture(tab, mode + '-key-notes-' + width);
        await modelNotes.first().scrollIntoViewIfNeeded();
        await capture(tab, mode + '-model-notes-' + width);
      }
    }
    await tab.setViewportSize({ width: 390, height: 844 });
    await saveEditor();
    await exactButton(manager, '关闭').click();
    let saved = await readCatalog();
    let [a, b, extra] = saved.entries;
    assert.equal(a.id, first.id);
    assert.equal(b.id, second.id);
    assert.equal(a.name, first.name);
    assert.equal(a.credentialId, extra.credentialId);
    assert.notEqual(a.credentialId, b.credentialId);
    assert.deepEqual(saved.entries.map(row => row.modelNote), ['0.5/次', '0.2/次', '额外模型的独立备注']);
    assert.equal(readNote(saved, b), longNote);

    await open();
    await expectText(card(extra), 'CCMAX');
    await expectText(card(b), '0.2/次');
    await capture(tab, mode + '-notes-main-390');
    await rowAction(tab, card(extra), '编辑');
    await keyNotes.first().fill('CCMAX 更新');
    await modelNotes.first().fill('');
    await saveEditor();
    await expectText(card(a), 'CCMAX 更新');
    assert.equal(await card(extra).getByText('额外模型的独立备注').count(), 0);
    assert.equal(await card(a).getByText('0.5/次').count(), 1);

    const data = await openPane(tab, panel, '数据');
    const [download] = await Promise.all([tab.waitForEvent('download'), exactButton(data, '导出').click()]);
    const chunks = [];
    for await (const chunk of await download.createReadStream()) chunks.push(chunk);
    const exported = Buffer.concat(chunks);
    saved = await readCatalog();
    assert.deepEqual(JSON.parse(exported), saved);
    async function importFile(content, replace) {
      await data.locator('input[type=file]').setInputFiles({ name: 'notes.json', mimeType: 'application/json', buffer: content });
      const importPane = tab.getByRole('dialog', { name: '导入方式', exact: true });
      if (replace) tab.once('dialog', dialog => dialog.accept());
      await importPane.getByRole('button', { name: replace ? /替换导入/ : /合并导入/ }).click();
      await expectText(data, replace ? '已替换导入配置。' : '已合并导入配置。');
    }
    await importFile(Buffer.from(JSON.stringify(older)), false);
    assert.deepEqual(await readCatalog(), saved);
    await exactButton(data, '关闭').click();
    await rowAction(tab, card(extra), '编辑');
    await exactButton(editor, '移除模型').click();
    await saveEditor();
    const removed = await readCatalog();
    assert.equal(removed.entries.find(row => row.id === extra.id), undefined);
    assert.equal(removed.entries.find(row => row.key === extra.key && !row.model).modelNote, undefined);
    assert.equal(readNote(removed, removed.entries.find(row => row.id === a.id)), 'CCMAX 更新');
    assert.equal(removed.entries.find(row => row.id === a.id).modelNote, '0.5/次');
    const replacePane = await openPane(tab, panel, '数据');
    assert.equal(await replacePane.isVisible(), true);
    await importFile(exported, true);
    assert.deepEqual(await readCatalog(), saved);
    await exactButton(replacePane, '关闭').click();
    await rowAction(tab, card(a), '编辑');
    await keyNotes.first().fill('');
    await saveEditor();
    const cleared = await readCatalog();
    assert.equal(readNote(cleared, a), '');
    assert.equal(await card(extra).getByText('CCMAX 更新').count(), 0);
    const groupPane = await openPane(tab, panel, 'API 管理');
    await exactButton(groupPane, '编辑此组的端点、密钥和模型').click();
    await exactButton(editor, '移除密钥').first().click();
    await saveEditor();
    const remaining = await readCatalog();
    assert.deepEqual(remaining.entries, [b]);
    assert.deepEqual(remaining.keyNotes, [{ id: b.credentialId, note: longNote }]);
    await assertConnection();
  }));

  test(mode + ': compact cards preserve legacy names and support touch, keyboard and row actions', { timeout: 90000 }, () => withBrowser(mode, async ({
    tab, open, flush, assertConnection, stores, origin,
  }) => {
    const model = 'anthropic:claude-opus-4-6-' + 'very-long-model-name-'.repeat(6) + 'suffix';
    const originalNames = ['[星港 新号] 【按次】 ' + model, '[星港 新号] ' + model, '手写的条目标题', '[收藏] ' + model];
    const keys = ['fixture-key-a', 'fixture-key-b', 'fixture-key-c', 'fixture-key-d'];
    const legacy = keys.map((key, index) => ({
      ...config(key), groupName: '星港 新号', name: originalNames[index],
      customModel: model, customUrl: origin + '/provider/v1',
    }));
    stores.set('one', { version: 1, values: { ...legacyValues, api_configs_manager: JSON.stringify(legacy) } });
    await open();
    const catalog = async () => {
      await flush();
      return JSON.parse(stores.get('one').values.st_api_manager_catalog_v2).catalog;
    };
    const original = await catalog();
    const [a, b, c, d] = original.entries;
    const dialog = name => tab.getByRole('dialog', { name, exact: true });
    const panel = dialog('API 管理器');
    const card = row => panel.locator('[data-entry-id="' + row.id + '"]').first();
    const manager = await openPane(tab, panel, 'API 管理');
    await exactButton(manager, '编辑此组的端点、密钥和模型').click();
    const editor = dialog('编辑 API 配置');
    await editor.getByLabel('配置组名称').fill('星港');
    const keyNotes = editor.getByLabel('密钥备注', { exact: true });
    await keyNotes.nth(0).fill('官key');
    await keyNotes.nth(1).fill('官key');
    await editor.getByLabel('模型备注', { exact: true }).fill('0.126');
    await exactButton(editor, '管理第 2 个密钥的模型').click();
    await editor.getByLabel('模型备注', { exact: true }).fill('0.25');
    await exactButton(editor, '保存').click();
    await editor.waitFor({ state: 'hidden' });
    await exactButton(manager, '关闭').click();
    const renamed = await catalog();
    assert.deepEqual(renamed.entries.map(row => row.id), original.entries.map(row => row.id));
    assert.deepEqual(renamed.entries.map(row => row.site), keys.map(() => '星港'));
    assert.deepEqual(renamed.entries.map(row => row.name), originalNames);
    assert.deepEqual(renamed.entries.map(row => [row.model, row.key, row.history]), original.entries.map(row => [row.model, row.key, row.history]));
    assert.deepEqual(renamed.keyNotes.map(note => note.note), ['官key', '官key']);
    await expectText(card(a), '【按次】');
    await expectText(card(c), '手写的条目标题');
    await expectText(card(d), '[收藏]');
    assert.equal(await panel.getByText('星港 新号', { exact: false }).count(), 0);
    for (const [index, row] of [a, b, c, d].entries()) await expectText(card(row), 'Key ' + (index + 1));
    assert.equal(await panel.getByText(/fixture-key-[a-d]/).count(), 0);

    await tab.addStyleTag({ content: mode === 'tt'
      ? ':root{--mainFontSize:18px;--SmartThemeBodyColor:#182631;--SmartThemeBlurTintColor:#d7e1e8;--SmartThemeBorderColor:#6b8394;--SmartThemeQuoteColor:#245e92}.menu_button{background:#f6fafc}'
      : ':root{--mainFontSize:18px}' });
    for (const [width, height] of [[320, 568], [375, 812], [390, 844], [430, 932], [667, 375], [844, 390],
      [768, 1024], [1024, 768], [1280, 900]]) {
      await tab.setViewportSize({ width, height });
      const fit = await card(a).evaluate(row => {
        const cardBox = row.getBoundingClientRect();
        const title = row.querySelector('.catalog-card-title');
        const text = title.querySelector('.catalog-card-model');
        const actions = row.querySelector('.catalog-card-actions');
        const dialog = row.closest('dialog');
        const content = dialog.querySelector('.popup-scroll-content');
        return {
          titleFull: title.getBoundingClientRect().width >= cardBox.width - 26,
          twoLines: text.getBoundingClientRect().height <= 2 * Number.parseFloat(getComputedStyle(text).lineHeight) + 1,
          actionsFit: actions.getBoundingClientRect().right <= cardBox.right && [...actions.children].every(button => button.offsetHeight >= 40),
          overflow: Math.max(row.scrollWidth - row.clientWidth, content.scrollWidth - content.clientWidth),
          margin: dialog.getBoundingClientRect().left,
        };
      });
      const label = mode + ' ' + width + '×' + height + ' ' + JSON.stringify(fit);
      assert.ok(fit.titleFull && fit.twoLines && fit.actionsFit && fit.overflow <= 1 && fit.margin >= 15, label);
      if ([390, 768, 844, 1280].includes(width)) await capture(tab, mode + '-compact-' + width);
    }
    await tab.setViewportSize({ width: 390, height: 844 });
    const title = exactButton(card(a), model);
    await title.tap();
    const details = dialog('配置详情');
    await expectText(details, originalNames[0]);
    await expectText(details, model);
    await expectText(details, '0.126');
    await capture(tab, mode + '-compact-details-390');
    await exactButton(details, '关闭').click();
    assert.equal(await title.evaluate(button => button === document.activeElement), true);

    const more = exactButton(card(a), '更多操作');
    await more.press('Enter');
    const actions = dialog('更多操作');
    await actions.waitFor();
    assert.equal(await exactButton(actions, '编辑').evaluate(button => button === document.activeElement), true);
    await tab.keyboard.press('Escape');
    await actions.waitFor({ state: 'hidden' });
    assert.equal(await more.evaluate(button => button === document.activeElement), true);
    await more.tap();
    await capture(tab, mode + '-compact-actions-390');
    await tab.touchscreen.tap(1, 1);
    await actions.waitFor({ state: 'hidden' });
    assert.equal(await more.evaluate(button => button === document.activeElement), true);

    const tags = await openPane(tab, panel, '标签设置');
    const search = tags.getByLabel('搜索组名、模型、标题或备注');
    await search.fill('星港 官key 0.126');
    assert.equal(await tags.locator('.config-item').count(), 1);
    await expectText(tags, 'Key 1');
    await search.fill('星港 新号');
    assert.equal(await tags.locator('.config-item').count(), 2);
    await search.fill(model);
    assert.equal(await tags.locator('.config-item').count(), 4);
    await expectText(tags, 'Key 3');
    await search.fill('[收藏]');
    assert.equal(await tags.locator('.config-item').count(), 1);
    await expectText(tags, '[收藏]');
    await search.fill('手写的条目标题');
    assert.equal(await tags.locator('.config-item').count(), 1);
    await exactButton(tags, '取消').click();

    await rowAction(tab, card(a), '管理分组');
    const groups = dialog('管理分组');
    await groups.getByRole('checkbox', { name: '第二组', exact: true }).check();
    await exactButton(groups, '保存').click();
    await groups.waitFor({ state: 'hidden' });
    assert.equal(await more.evaluate(button => button === document.activeElement), true);
    await rowAction(tab, card(a), '移出标签分组');
    await expectText(panel, '已移出标签分组。');
    assert.deepEqual((await catalog()).entries.find(row => row.id === a.id).groupIds, ['group-b']);
    assert.equal(await more.evaluate(button => button === document.activeElement), true);

    await rowAction(tab, card(c), '编辑');
    await editor.getByLabel('配置组名称').fill('独立组');
    await exactButton(editor, '保存').click();
    await editor.waitFor({ state: 'hidden' });
    assert.equal(await exactButton(card(c), '更多操作').evaluate(button => button === document.activeElement), true);
    await open();
    await expectText(card(c), '独立组');
    await expectText(card(a), '星港');
    await expectText(card(a), '【按次】');
    await expectText(card(b), '0.25');
    assert.equal((await catalog()).entries.find(row => row.id === c.id).name, originalNames[2]);

    await rowAction(tab, card(c), '编辑');
    await editor.getByLabel('条目备注（可选）').fill('[新标记] ' + model);
    await exactButton(editor, '保存').click();
    await editor.waitFor({ state: 'hidden' });
    await expectText(card(c), '[新标记]');
    tab.once('dialog', prompt => prompt.dismiss());
    await rowAction(tab, card(c), '删除');
    assert.equal((await catalog()).entries.length, 4);
    tab.once('dialog', prompt => prompt.accept());
    await rowAction(tab, card(c), '删除');
    await expectText(panel, '已删除配置。');
    assert.deepEqual((await catalog()).entries.map(row => row.id), [a.id, b.id, d.id]);
    await assertConnection();
  }, { hasTouch: true }));

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

