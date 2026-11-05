const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { withBrowser } = require('./browser-fixture.cjs');

const names = ['gemini', '公开模型', '奇奇怪怪的标签与一个很长的模型名称-Claudegemini'.repeat(2)];
const pane = (tab, name) => tab.getByRole('dialog', { name, exact: true });
const button = (from, name) => from.getByRole('button', { name, exact: true });
function seed(stores, origin) {
  const catalog = {
    format: 'st-api-manager-catalog', version: 2,
    groups: names.map((name, index) => ({ id: 'label-' + index, name, color: '#3b82f6' })),
    entries: [[], ['label-0'], ['label-1']].map((groupIds, index) => ({
      id: 'row-' + index, site: 'Fixture site', name: '', source: 'custom',
      url: origin + '/provider/v1', key: 'fixture-layout-key', model: 'fixture-model-' + index, groupIds,
    })),
  };
  for (const device of ['one', 'two']) stores.set(device, { version: 1, values: {
    st_api_manager_catalog_v2: JSON.stringify({ catalog, sync: { revision: 'fixture-revision', pending: false } }),
    fixture_old_value: 'keep',
  } });
  return catalog;
}
async function capture(tab, name) {
  if (!process.env.ST_API_UI_PREVIEW) return;
  fs.mkdirSync(process.env.ST_API_UI_PREVIEW, { recursive: true });
  await tab.screenshot({ path: path.join(process.env.ST_API_UI_PREVIEW, name + '.png'), animations: 'disabled' });
}

for (const mode of ['st', 'tt']) {
  test(mode + ': import choices and complete label names fit large text and narrow screens', { timeout: 60000 },
    () => withBrowser(mode, async ({ tab, open, flush, stores, origin, assertConnection }) => {
      const catalog = seed(stores, origin);
      await open();
      // Native menu rules in ST and TT, plus a large-font light theme like the reports.
      await tab.addStyleTag({ content: `
        :root{--mainFontSize:20px;--SmartThemeBodyColor:#182631;--SmartThemeBlurTintColor:#f8f5ef;
          --SmartThemeBorderColor:#b7aaa0;--SmartThemeQuoteColor:#245e92}
        .menu_button{display:flex;align-items:center;justify-content:center;width:${mode === 'tt' ? 'fit-content' : 'min-content'};
          padding:3px 5px;margin:5px 0;white-space:nowrap}
        .menu_button_icon{display:flex;align-items:center;width:fit-content;gap:5px}
      ` });
      const main = pane(tab, 'API 管理器');
      await button(main, '数据').click();
      const data = pane(tab, '数据');
      const [download] = await Promise.all([tab.waitForEvent('download'), button(data, '导出').click()]);
      const chunks = [];
      for await (const chunk of await download.createReadStream()) chunks.push(chunk);
      assert.deepEqual(JSON.parse(Buffer.concat(chunks)), catalog);
      const incoming = { ...catalog, entries: [{ ...catalog.entries[0], id: 'imported-row', model: 'imported-model' }] };
      const upload = () => data.locator('input[type=file]').setInputFiles({
        name: 'fixture.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(incoming)),
      });
      await upload();
      const importer = pane(tab, '导入方式');
      await importer.waitFor();
      const viewports = [[320, 568], [390, 844], [844, 390], [768, 1024], [1280, 900]];
      for (const [width, height] of viewports) {
        await tab.setViewportSize({ width, height });
        const layout = await importer.evaluate(dialog => {
          const options = [...dialog.querySelectorAll('.import-mode-option')];
          const boxes = options.map(option => option.getBoundingClientRect().toJSON());
          const p = dialog.querySelector('.import-mode-modal > p').getBoundingClientRect();
          const textFits = options.every(option => {
            const box = option.getBoundingClientRect();
            return [...option.childNodes].every(node => {
              const range = document.createRange(); range.selectNodeContents(node);
              return [...range.getClientRects()].every(rect => rect.left >= box.left && rect.right <= box.right &&
                rect.top >= box.top && rect.bottom <= box.bottom);
            });
          });
          return { ordered: p.bottom <= boxes[0].top && boxes[0].bottom <= boxes[1].top,
            textFits, overflow: dialog.scrollWidth > dialog.clientWidth };
        });
        assert.deepEqual(layout, { ordered: true, textFits: true, overflow: false }, mode + ' import ' + width);
        if (width === 390 || width === 1280) await capture(tab, mode + '-import-' + width);
      }
      await button(importer, '取消').click();
      assert.deepEqual(JSON.parse(stores.get('one').values.st_api_manager_catalog_v2).catalog, catalog);
      await upload();
      await importer.getByRole('button', { name: /合并导入/ }).click();
      await data.getByText('已合并导入配置。', { exact: true }).waitFor();
      await flush();
      assert.equal(JSON.parse(stores.get('one').values.st_api_manager_catalog_v2).catalog.entries.length, 4);
      await upload();
      tab.once('dialog', dialog => dialog.dismiss());
      await importer.getByRole('button', { name: /替换导入/ }).click();
      assert.equal(await importer.isVisible(), true);
      tab.once('dialog', dialog => dialog.accept());
      await importer.getByRole('button', { name: /替换导入/ }).click();
      await data.getByText('已替换导入配置。', { exact: true }).waitFor();
      await flush();
      assert.deepEqual(JSON.parse(stores.get('one').values.st_api_manager_catalog_v2).catalog, incoming);
      await button(data, '关闭').click();
      await button(main, '标签设置').click();
      const tags = pane(tab, '标签设置');
      const chips = tags.locator('.category-tag');
      for (const [width, height] of viewports) {
        await tab.setViewportSize({ width, height });
        await chips.last().scrollIntoViewIfNeeded();
        const fits = await chips.evaluateAll(nodes => nodes.map(chip => {
          const label = chip.querySelector('.category-tag-name');
          const range = document.createRange(); range.selectNodeContents(label);
          const box = chip.getBoundingClientRect();
          const actions = [...chip.querySelectorAll('button')].map(node => node.getBoundingClientRect());
          const text = [...range.getClientRects()];
          const overlap = (a, b) => a.left < b.right - .5 && a.right > b.left + .5 &&
            a.top < b.bottom - .5 && a.bottom > b.top + .5;
          return text.every(rect => rect.left >= box.left && rect.right <= box.right &&
            rect.top >= box.top && rect.bottom <= box.bottom && actions.every(action => !overlap(rect, action))) &&
            !overlap(actions[0], actions[1]) && chip.scrollWidth <= chip.clientWidth &&
            label.scrollWidth <= label.clientWidth + 1;
        }));
        assert.deepEqual(fits, names.map(() => true), mode + ' tags ' + width);
        if (width === 390 || width === 1280) await capture(tab, mode + '-tags-' + width);
      }
      // Both separate actions remain reachable, and selecting a label still works.
      await chips.first().locator('input').check();
      await button(chips.first(), '重命名或改色').click();
      const edit = pane(tab, '编辑标签');
      await edit.getByLabel('标签名称', { exact: true }).fill('gemini 完整标签');
      await button(edit, '保存').click();
      await tags.getByText('gemini 完整标签', { exact: true }).waitFor();
      tab.once('dialog', dialog => dialog.accept());
      await button(chips.first(), '删除标签').click();
      await flush();
      assert.equal(JSON.parse(stores.get('one').values.st_api_manager_catalog_v2).catalog.entries.length, 1);
      assert.equal(await tab.locator('#openai_settings #st-api-manager-connection-button').count(), 0);
      assert.equal(await tab.locator('#st-api-manager-extension-button').count(), 1);
      await assertConnection();
    }, { hasTouch: true }));

  test(mode + ': group folding survives reload per device without changing catalog or account sync', { timeout: 45000 },
    () => withBrowser(mode, async ({ tab, open, flush, stores, accounts, origin, assertConnection }) => {
      const catalog = seed(stores, origin);
      const initialAccount = [...accounts];
      const initialState = stores.get('one').values.st_api_manager_catalog_v2;
      await open();
      const main = pane(tab, 'API 管理器');
      const drawer = name => main.locator('details').filter({ has: tab.locator('summary b').getByText(name, { exact: true }) });
      const toggle = async name => {
        await drawer(name).evaluate(node => new Promise(resolve => {
          node.addEventListener('toggle', () => resolve(), { once: true });
          node.querySelector('summary').click();
        }));
        await flush();
      };
      const read = () => main.locator('details').evaluateAll(nodes => nodes.map(node => ({
        name: node.querySelector('b').textContent, open: node.open,
        display: getComputedStyle(node.querySelector('.inline-drawer-content')).display,
      })));
      const expected = names => ['未分类', ...catalog.groups.map(group => group.name)].map(name => ({
        name, open: !names.includes(name), display: names.includes(name) ? 'none' : 'block',
      }));
      await toggle('gemini');
      await toggle('未分类');
      assert.deepEqual(await read(), expected(['gemini', '未分类']));
      assert.equal(stores.get('one').values.st_api_manager_catalog_v2, initialState);
      assert.equal(stores.get('one').values.fixture_old_value, 'keep');
      await button(main, '关闭').click();
      await tab.locator('#st-api-manager-extension-button').click();
      assert.deepEqual(await read(), expected(['gemini', '未分类']));
      await open(); // A fresh module and panel instance read only persisted host state.
      assert.deepEqual(await read(), expected(['gemini', '未分类']));
      await toggle('gemini');
      await open();
      assert.deepEqual(await read(), expected(['未分类']));
      await open('?device=two');
      assert.deepEqual(await read(), expected([]));
      await open();
      assert.deepEqual(await read(), expected(['未分类']));
      assert.deepEqual([...accounts], initialAccount);
      assert.equal(stores.get('one').values.st_api_manager_catalog_v2, initialState);
      assert.equal(await tab.locator('#st-api-manager-connection-button').count(), 0);
      await assertConnection();
    }));
}
