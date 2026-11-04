const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { withBrowser } = require('./browser-fixture.cjs');
const { config, legacyValues } = require('./catalog-fixture.cjs');

async function installHostDrawer(tab, mode) {
  // The native hosts delegate clicks from this selector on document.
  // ST animates the content with jQuery. TT 2.4.0 reads the icon's "up"
  // class and writes inline display, reproduced here with motion disabled.
  // TT source: fff9af0333be/src/script.js:13858 and src/scripts/drawers.js:177.
  await tab.evaluate(hostMode => {
    const $ = window.$;
    window.fixtureDrawerWrites = 0;
    $(document).on('click', '.inline-drawer-toggle', function () {
      const drawer = $(this).closest('.inline-drawer');
      const content = drawer.find('>.inline-drawer-content');
      const icon = $(this).find('.inline-drawer-icon');
      if (!content.length || !icon.length) return;
      window.fixtureDrawerWrites++;
      if (hostMode === 'tt') {
        const open = !icon.hasClass('up');
        icon.toggleClass('up fa-circle-chevron-up', open).toggleClass('down fa-circle-chevron-down', !open);
        content[0].style.display = open ? 'block' : 'none';
      } else {
        icon.toggleClass('down up fa-circle-chevron-down fa-circle-chevron-up');
        content.stop().slideToggle(0);
      }
    });
    const probe = document.createElement('div');
    probe.className = 'inline-drawer';
    probe.innerHTML = '<button class="inline-drawer-toggle"><i class="inline-drawer-icon down"></i></button>' +
      '<div class="inline-drawer-content" style="display:none"></div>';
    document.body.append(probe);
    probe.firstElementChild.click();
    probe.remove();
  }, mode);
  assert.equal(await tab.evaluate(() => window.fixtureDrawerWrites), 1, 'host delegation is active');
}

for (const [label, mode, query] of [['ST', 'st', ''], ['TT', 'tt', ''], ['TT iframe', 'tt', '?iframe=1']]) {
  test(label + ': the last group opens after saving or cancelling in API management', { timeout: 45000 },
    () => withBrowser(mode, async ({ tab, open, flush, stores, origin, assertConnection }) => {
      const categories = Array.from({ length: 6 }, (_, order) => ({
        id: 'fixture-g' + order, name: order === 5 ? '4argon' : 'Fixture ' + order, order,
      }));
      const configs = categories.flatMap(({ id, order }) => [0, 1].map(index => ({
        ...config('fixture-drawer-key', id), name: '', groupName: 'Fixture site',
        customUrl: origin + '/provider/v1', customModel: order === 5 ? 'argon-fixture-' + index : 'model-' + order + '-' + index,
      })));
      stores.set('one', { version: 1, values: {
        ...legacyValues, api_configs_categories: JSON.stringify(categories), api_configs_manager: JSON.stringify(configs),
      } });
      await open(query);
      await installHostDrawer(tab, mode);
      const pane = name => tab.getByRole('dialog', { name, exact: true });
      const button = (from, name) => from.getByRole('button', { name, exact: true });
      const main = pane('API 管理器');
      const manager = pane('API 管理');
      const editor = pane('编辑 API 配置');
      const last = main.locator('details').filter({ has: tab.locator('summary').getByText('4argon', { exact: true }) });
      const heading = last.locator('summary');
      const readCatalog = async () => {
        await flush();
        return JSON.parse(stores.get('one').values.st_api_manager_catalog_v2).catalog;
      };
      const state = async () => last.evaluate(drawer => {
        const body = drawer.children[1];
        const scroll = drawer.closest('.popup-scroll-content');
        return {
          open: drawer.open, display: getComputedStyle(body).display, inlineDisplay: body.style.display,
          cards: body.querySelectorAll('[data-entry-id]').length, height: body.getBoundingClientRect().height,
          scrollTop: scroll.scrollTop, scrollable: scroll.scrollHeight > scroll.clientHeight,
        };
      });
      const assertDrawer = async (expected, step) => {
        const ui = await state();
        const saved = (await readCatalog()).entries.filter(row => row.groupIds.includes('fixture-g5'));
        const context = label + ' ' + step + ' ' + JSON.stringify(ui);
        assert.deepEqual(saved.map(row => row.model), ['argon-fixture-0', 'argon-fixture-1'], context);
        assert.equal(ui.cards, 2, context);
        assert.equal(ui.open, expected, context);
        assert.equal(ui.display, expected ? 'block' : 'none', context);
        assert.equal(ui.height > 0, expected, context);
        assert.equal(ui.inlineDisplay, '', context);
        assert.equal(ui.scrollable, true, context);
      };
      const edit = async (save, note) => {
        await button(main, 'API 管理').press('Enter');
        await button(manager, '编辑此组的端点、密钥和模型').click();
        await editor.getByLabel('模型备注', { exact: true }).first().fill(note);
        await button(editor, save ? '保存' : '取消').click();
        await editor.waitFor({ state: 'hidden' });
        await button(manager, '关闭').click();
        await manager.waitFor({ state: 'hidden' });
        assert.equal(await tab.locator('dialog[open]').count(), 1);
        assert.equal(await button(main, 'API 管理').evaluate(node => node === document.activeElement), true);
      };
      await assertDrawer(true, 'initial');
      for (const [width, height, save] of [[390, 844, true], [844, 390, false], [390, 844, true]]) {
        await tab.setViewportSize({ width, height });
        if (!save) {
          await heading.click();
          await assertDrawer(false, 'collapsed before editing');
        }
        const before = (await readCatalog()).entries[0].modelNote;
        const note = 'fixture-note-' + width + '-' + (before ?? '');
        await edit(save, note);
        assert.equal((await readCatalog()).entries[0].modelNote, save ? note : before);
        await assertDrawer(save, 'returned from ' + (save ? 'save' : 'cancel'));

        if (save) await heading.click();
        await heading.click();
        await assertDrawer(true, 'opened after returning');
        assert.ok((await state()).scrollTop > 0, 'the last group can be reached by scrolling');
        await heading.evaluate(node => { node.click(); node.click(); });
        await assertDrawer(true, 'after two rapid clicks');
        await heading.press('Space');
        await assertDrawer(false, 'closed with keyboard');
        await heading.press('Space');
        await assertDrawer(true, 'reopened with keyboard');
      }
      assert.equal(await tab.evaluate(() => window.fixtureDrawerWrites), 1, 'host drawer handler ignores plugin groups');
      await button(last, 'argon-fixture-0').click();
      await pane('配置详情').getByText('argon-fixture-0', { exact: true }).waitFor();
      await button(pane('配置详情'), '关闭').click();
      const preview = process.env.ST_API_UI_PREVIEW;
      if (preview) {
        fs.mkdirSync(preview, { recursive: true });
        await tab.screenshot({ path: path.join(preview, label.toLowerCase().replace(' ', '-') + '-last-group.png') });
      }
      await button(main, '关闭').click();
      await tab.locator('#st-api-manager-extension-button').click();
      await assertDrawer(true, 'after closing and reopening the manager');
      await assertConnection();
    }));
}
