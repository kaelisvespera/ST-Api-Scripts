const assert = require('node:assert/strict');
const test = require('node:test');
const { withBrowser } = require('./browser-fixture.cjs');

const labels = {
  includeBody: '包含主体参数',
  excludeBody: '排除主体参数',
  includeHeaders: '包含请求标头',
};

for (const [mode, width] of [['st', 320], ['tt', 390]]) {
  test(mode + ': models sharing a key edit and apply their own extra parameters', { timeout: 30000 }, () => withBrowser(mode,
    async ({ tab, open, stores, flush, origin, assertConnection }) => {
      const shared = {
        site: '合成站点', source: 'custom', url: origin + '/provider/v1', key: 'fixture-shared-key', groupIds: [],
      };
      const entries = [
        { ...shared, id: 'model-a', name: '模型 A', model: 'fixture-a',
          extra: { includeBody: '{"top_k":20}', excludeBody: '["frequency_penalty"]', includeHeaders: '{"X-Fixture":"A"}' } },
        { ...shared, id: 'model-b', name: '模型 B', model: 'fixture-b',
          extra: { includeBody: '{"temperature":0.7}', excludeBody: '["presence_penalty"]', includeHeaders: '{"X-Fixture":"B"}' } },
      ];
      const expected = [
        { ...entries[0].extra, includeBody: '{\n  "thinking": {"type": "enabled"},\n  "reasoning_effort": "low"\n}', includeHeaders: '' },
        { ...entries[1].extra, excludeBody: '["max_tokens"]', includeHeaders: '{"X-Fixture":"B edited"}' },
      ];
      const catalog = { format: 'st-api-manager-catalog', version: 2, groups: [], entries };
      stores.set('one', { version: 1, values: { st_api_manager_catalog_v2: JSON.stringify({
        catalog, sync: { revision: null, pending: false },
      }) } });
      // JSON documents are a YAML subset. Use the host parser seam from the other browser tests.
      await tab.route('**/lib.js', route => route.fulfill({
        contentType: 'text/javascript',
        body: 'export const yaml = {parse: JSON.parse};',
      }));
      await open();
      await tab.addStyleTag({ content: ':root { --SmartThemeBodyColor: #fff2d2; --SmartThemeBlurTintColor: #352040; }' });

      const dialog = name => tab.getByRole('dialog', { name, exact: true });
      const button = (pane, name) => pane.getByRole('button', { name, exact: true });
      const main = dialog('API 管理器');
      const manager = dialog('API 管理');
      const editor = dialog('编辑 API 配置');
      const modelCard = index => editor.locator('.selected-item').nth(index);
      const parameterBox = index => modelCard(index).locator('.st-api-manager-model-extra');
      const parameter = (index, field) => parameterBox(index).getByLabel(labels[field], { exact: true });
      const openGroupEditor = async () => {
        await button(main, 'API 管理').click();
        await button(manager, '编辑此组的端点、密钥和模型').click();
        assert.equal(await editor.getByLabel('API 密钥', { exact: true }).inputValue(), shared.key);
        assert.equal(await editor.getByText('附加参数', { exact: true }).count(), 2);
        for (const [index, entry] of entries.entries()) {
          assert.equal(await modelCard(index).getByLabel('已选模型 ID', { exact: true }).inputValue(), entry.model);
          assert.equal(await modelCard(index).getByLabel('模型备注', { exact: true }).count(), 1);
          if (!await parameterBox(index).evaluate(details => details.open)) {
            await parameterBox(index).locator('summary').click();
          }
          await parameter(index, 'includeBody').waitFor({ state: 'visible' });
        }
      };
      const assertExtras = async values => {
        for (const [index, extra] of values.entries()) {
          for (const [field, value] of Object.entries(extra)) {
            assert.equal(await parameter(index, field).inputValue(), value);
          }
        }
      };
      const readEntries = async () => {
        await flush();
        return JSON.parse(stores.get('one').values.st_api_manager_catalog_v2).catalog.entries;
      };

      await openGroupEditor();
      assert.equal(await editor.getAttribute('data-catalog-theme'), 'dark');
      const summary = parameterBox(0).locator('summary');
      assert.equal(await summary.evaluate(el => getComputedStyle(el).color),
        await editor.evaluate(el => getComputedStyle(el).color));
      await assertExtras(entries.map(entry => entry.extra));
      for (const [index, extra] of expected.entries()) {
        for (const [field, value] of Object.entries(extra)) {
          const input = parameter(index, field);
          assert.equal(await input.evaluate(element => {
            const card = element.closest('.selected-item').getBoundingClientRect();
            const bounds = element.getBoundingClientRect();
            return bounds.left >= card.left - 1 && bounds.right <= card.right + 1;
          }), true, 'the parameter editor fits inside its model card');
          await input.fill(value);
        }
      }
      const invalid = parameter(1, 'includeBody');
      await invalid.fill('["wrong shape"]');
      await button(editor, '保存').click();
      await editor.getByRole('status').getByText(/模型「fixture-b」.*包含主体参数需要使用 YAML 对象/).waitFor();
      assert.deepEqual(await readEntries(), entries);
      assert.equal(await parameter(0, 'includeBody').inputValue(), expected[0].includeBody);
      await invalid.fill(expected[1].includeBody);

      await button(editor, '保存').click();
      await editor.waitFor({ state: 'hidden' });
      const saved = await readEntries();
      assert.deepEqual(saved.map(({ id, model, url, key, extra }) => ({ id, model, url, key, extra })),
        entries.map(({ id, model, url, key }, index) => ({ id, model, url, key, extra: expected[index] })));
      await assertConnection();

      await open();
      await openGroupEditor();
      await assertExtras(expected);
      await button(editor, '取消').click();
      await button(manager, '关闭').click();
      if (mode === 'tt') await tab.evaluate(() => {
        SillyTavern.getContext().chatCompletionSettings.additional_parameters_by_source = {};
      });
      for (const [index, entry] of entries.entries()) {
        await button(main.locator('[data-entry-id="' + entry.id + '"]'), '应用').click();
        await tab.waitForFunction(({ mode, model, values }) => {
          const settings = SillyTavern.getContext().chatCompletionSettings;
          const keys = ['include_body', 'exclude_body', 'include_headers'];
          return hostConnection.model === model && keys.every((key, index) => values[index] === (
            mode === 'tt' ? settings.additional_parameters_by_source?.custom?.[key] : settings['custom_' + key]
          ));
        }, { mode, model: entry.model, values: Object.values(expected[index]) });
      }
    }, { viewport: { width, height: 844 } }));
}
