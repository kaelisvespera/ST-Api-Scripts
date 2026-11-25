const assert = require('node:assert/strict');
const test = require('node:test');
const { withBrowser } = require('./browser-fixture.cjs');

const dialog = (tab, name) => tab.getByRole('dialog', { name, exact: true });
const button = (scope, name) => scope.getByRole('button', { name, exact: true });

for (const mode of ['st', 'tt']) {
  test(mode + ': API manager dialogs suppress a bright host shadow at every depth', { timeout: 30000 }, () =>
    withBrowser(mode, async ({ tab, open }) => {
      await open();
      await tab.addStyleTag({ content: ':root { --SmartThemeShadowColor: rgba(255, 255, 255, .75); }' });
      await tab.evaluate(() => {
        const hostPopup = document.createElement('dialog');
        hostPopup.className = 'popup';
        document.body.append(hostPopup);
      });
      assert.match(await tab.locator('dialog.popup:not(.st-api-manager)').evaluate(element =>
        getComputedStyle(element).boxShadow), /rgba\(255, 255, 255, 0.75\)/);

      async function check(name, backdrop = 'rgba(0, 0, 0, 0)') {
        const pane = dialog(tab, name);
        const style = await pane.evaluate(element => ({
          shadow: getComputedStyle(element).boxShadow,
          backdrop: getComputedStyle(element, '::backdrop').backgroundColor,
          border: getComputedStyle(element).borderTopWidth,
        }));
        assert.deepEqual(style, { shadow: 'none', backdrop, border: '1px' }, name);
        return pane;
      }
      const main = await check('API 管理器', 'rgba(15, 18, 28, 0.52)');

      await button(main, 'API 管理').click();
      const manage = await check('API 管理');
      await button(manage, '编辑此组的端点、密钥和模型').first().click();
      await button(await check('编辑 API 配置'), '取消').click();
      await button(manage, '关闭').click();

      await button(main, '标签设置').click();
      const tags = await check('标签设置');
      await button(tags, '重命名或改色').first().click();
      await button(await check('编辑标签'), '取消').click();
      await button(tags, '取消').click();

      for (const name of ['筛选', '数据']) {
        await button(main, name).click();
        await button(await check(name), '关闭').click();
      }
    }));

  test(mode + ': outside taps return one dialog at a time without reaching the host', { timeout: 30000 }, () =>
    withBrowser(mode, async ({ tab, open, assertConnection }) => {
      await open();
      const main = dialog(tab, 'API 管理器');
      const entry = tab.locator('#st-api-manager-extension-button');
      const box = await main.boundingBox();
      const inside = { x: box.x + 5, y: box.y + box.height / 2 };
      const outside = { x: 4, y: 4 };

      await tab.evaluate(() => {
        const hostButton = document.createElement('button');
        hostButton.id = 'fixture-under-backdrop';
        hostButton.style.cssText = 'position:fixed;inset:0 auto auto 0;width:12px;height:12px;';
        hostButton.dataset.clicks = '0';
        hostButton.onclick = () => { hostButton.dataset.clicks = String(Number(hostButton.dataset.clicks) + 1); };
        document.body.append(hostButton);
      });
      const hostButton = tab.locator('#fixture-under-backdrop');

      await tab.mouse.click(inside.x, inside.y);
      assert.equal(await main.isVisible(), true, 'inside padding is part of the dialog');
      for (const [start, end] of [[inside, outside], [outside, inside]]) {
        await tab.mouse.move(start.x, start.y);
        await tab.mouse.down();
        await tab.mouse.move(end.x, end.y, { steps: 5 });
        await tab.mouse.up();
        assert.equal(await main.isVisible(), true, 'dragging across the boundary does not dismiss');
      }

      const openTags = button(main, '标签设置');
      await openTags.click();
      const tags = dialog(tab, '标签设置');
      const editTag = button(tags, '重命名或改色').first();
      await editTag.click();
      const editor = dialog(tab, '编辑标签');
      await editor.waitFor();
      await tab.touchscreen.tap(outside.x, outside.y);
      await editor.waitFor({ state: 'hidden' });
      assert.equal(await tags.isVisible(), true, 'the first tap returns to tag settings');
      assert.equal(await editTag.evaluate(element => element === document.activeElement), true);
      await tab.mouse.click(outside.x, outside.y);
      await tags.waitFor({ state: 'hidden' });
      assert.equal(await main.isVisible(), true, 'the next click returns to the main dialog');
      assert.equal(await main.evaluate(element => element.contains(document.activeElement)), true);

      await tab.mouse.click(outside.x, outside.y, { button: 'right' });
      assert.equal(await main.isVisible(), true, 'right click does not dismiss');
      await tab.mouse.click(outside.x, outside.y);
      await main.waitFor({ state: 'hidden' });
      assert.equal(await entry.evaluate(element => element === document.activeElement), true);
      assert.equal(await hostButton.getAttribute('data-clicks'), '0');

      await entry.click();
      await tab.touchscreen.tap(outside.x, outside.y);
      await main.waitFor({ state: 'hidden' });
      assert.equal(await hostButton.getAttribute('data-clicks'), '0');
      await assertConnection();
    }, { hasTouch: true }));
}
