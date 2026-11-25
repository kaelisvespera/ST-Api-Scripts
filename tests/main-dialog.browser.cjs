const assert = require('node:assert/strict');
const test = require('node:test');
const { withBrowser } = require('./browser-fixture.cjs');

const dialog = (tab, name) => tab.getByRole('dialog', { name, exact: true });
const button = (scope, name) => scope.getByRole('button', { name, exact: true });

for (const mode of ['st', 'tt']) {
  test(mode + ': the main dialog has no glow with a bright host shadow', { timeout: 30000 }, () =>
    withBrowser(mode, async ({ tab, open }) => {
      await open();
      await tab.addStyleTag({ content: ':root { --SmartThemeShadowColor: rgba(255, 255, 255, .75); }' });
      const main = dialog(tab, 'API 管理器');
      const style = await main.evaluate(element => ({
        shadow: getComputedStyle(element).boxShadow,
        backdrop: getComputedStyle(element, '::backdrop').backgroundColor,
        border: getComputedStyle(element).borderTopWidth,
      }));
      assert.equal(style.shadow, 'none');
      assert.equal(style.backdrop, 'rgba(15, 18, 28, 0.52)');
      assert.equal(style.border, '1px');

      await button(main, '标签设置').click();
      const tags = dialog(tab, '标签设置');
      assert.match(await tags.evaluate(element => getComputedStyle(element).boxShadow), /rgba\(255, 255, 255, 0.75\)/);
    }));

  test(mode + ': outside clicks dismiss the main dialog without reaching the host or closing its child', { timeout: 30000 }, () =>
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

      await button(main, '标签设置').click();
      const tags = dialog(tab, '标签设置');
      await tab.mouse.click(outside.x, outside.y);
      assert.equal(await tags.isVisible(), true, 'the child keeps its own close behavior');
      await button(tags, '取消').click();
      assert.equal(await main.isVisible(), true);

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
