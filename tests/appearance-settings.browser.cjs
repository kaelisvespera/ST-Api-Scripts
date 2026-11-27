
const assert = require('node:assert/strict');
const test = require('node:test');
const { withBrowser } = require('./browser-fixture.cjs');

const uiKey = 'st_api_manager_ui_v1';
const catalogKey = 'st_api_manager_catalog_v2';
const pane = (tab, name) => tab.getByRole('dialog', { name, exact: true });
const button = (dialog, name) => dialog.getByRole('button', { name, exact: true });

async function palette(dialog) {
  return dialog.evaluate(element => {
    const css = getComputedStyle(element);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d');
    const rgba = color => {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
      return [...context.getImageData(0, 0, 1, 1).data];
    };
    const control = element.querySelector('button');
    return {
      mode: element.dataset.catalogTheme,
      background: rgba(css.backgroundColor), text: rgba(css.color),
      wholeOpacity: css.opacity, buttonOpacity: getComputedStyle(control).opacity,
    };
  });
}

async function openThemes(tab, main) {
  await button(main, '设置').tap();
  const hub = pane(tab, '设置');
  await button(hub, '主题设置').tap();
  return { hub, theme: pane(tab, '主题设置') };
}

async function setHostTheme(tab, mode) {
  const dark = mode === 'dark';
  await tab.evaluate(([ink, tint]) => {
    document.documentElement.style.setProperty('--SmartThemeBodyColor', ink);
    document.documentElement.style.setProperty('--SmartThemeBlurTintColor', tint);
  }, dark ? ['#e4dfe2', 'rgba(47, 36, 52, 0.34)'] : ['#282625', 'rgba(240, 232, 217, 0.28)']);
}

async function waitMode(tab, name, mode) {
  await tab.waitForFunction(({ name, mode }) => [...document.querySelectorAll('dialog[open]')]
    .some(element => element.getAttribute('aria-label') === name && element.dataset.catalogTheme === mode), { name, mode });
}

for (const [mode, width] of [['st', 320], ['tt', 390]]) {
  test(mode + ': appearance and consolidated settings persist on a narrow touchscreen', { timeout: 40000 }, () =>
    withBrowser(mode, async ({ tab, open, stores, flush, origin, assertConnection }) => {
      const groups = [
        { id: 'amber', name: '琥珀标签', color: '#ca8c3e' },
        { id: 'violet', name: '紫藤标签', color: '#7a65a3', icon: 'gemini' },
      ];
      const entries = [
        { id: 'first', name: '合成模型一', model: 'fixture-one', site: '合成站点', source: 'custom',
          url: origin + '/v1', key: 'fixture-one-key', groupIds: ['amber'] },
        { id: 'second', name: '合成模型二', model: 'fixture-two', site: '合成站点', source: 'custom',
          url: origin + '/v1', key: 'fixture-two-key', groupIds: ['violet'] },
      ];
      const catalog = { format: 'st-api-manager-catalog', version: 2, groups, entries };
      const values = { [catalogKey]: JSON.stringify({ catalog, sync: { revision: null, pending: false } }) };
      if (mode === 'tt') values[uiKey] = JSON.stringify({
        collapsedGroups: ['amber'],
        categoryFilter: ['violet'],
        siteFilter: ['removed-site'],
      });
      stores.set('one', { version: 1, values });

      await open();
      const main = pane(tab, 'API 管理器');
      const toolbar = main.locator('.api-manager-toolbar');
      await tab.addStyleTag({ content: ':root{--mainFontSize:20px}' });
      const controls = await toolbar.getByRole('button').evaluateAll(buttons => buttons.map(item => {
        const box = item.getBoundingClientRect();
        return { label: item.textContent.trim(), top: box.top, width: box.width, bottom: box.bottom };
      }));
      assert.deepEqual(controls.map(item => item.label), ['API 管理', '检测', '设置']);
      assert(controls.every(item => item.top === controls[0].top && item.bottom - item.top >= 34 && item.width > 40));
      for (const label of groups.map(group => group.name)) assert(await main.getByText(label, { exact: true }).isVisible());
      if (mode === 'tt') assert.equal(await main.locator('details.inline-drawer').filter({ hasText: '琥珀标签' }).evaluate(el => el.open), false);

      await tab.evaluate(() => {
        const outside = document.createElement('div');
        outside.id = 'outside-appearance-probe';
        outside.style.cssText = 'background-color:var(--SmartThemeBlurTintColor);color:var(--SmartThemeBodyColor)';
        document.body.append(outside);
      });
      const hostProbe = tab.locator('#outside-appearance-probe');
      const hostColors = () => hostProbe.evaluate(element => {
        const style = getComputedStyle(element);
        return [style.color, style.backgroundColor];
      });

      await setHostTheme(tab, 'light');
      await waitMode(tab, 'API 管理器', 'light');
      const day = await palette(main);
      assert.equal(day.background[3], 255);
      await setHostTheme(tab, 'dark');
      await waitMode(tab, 'API 管理器', 'dark');
      const host = await hostColors();
      const night = await palette(main);
      assert.equal(night.background[3], 255);
      assert(day.background[0] > 180 && night.background[0] < 80);
      assert(day.text[0] < 100 && night.text[0] > 180);

      const { hub, theme } = await openThemes(tab, main);
      const follow = theme.getByLabel('跟随 ST/TT 主题', { exact: true });
      const slider = theme.getByRole('slider', { name: '面板透明度' });
      assert(await follow.isChecked());
      assert.equal(await slider.inputValue(), '0');
      assert.equal((await palette(theme)).mode, 'dark');
      await slider.press('End');
      assert.equal(await slider.inputValue(), '30');
      await theme.getByText('30%', { exact: true }).waitFor();
      const translucent = await palette(theme);
      assert(translucent.background[3] >= 175 && translucent.background[3] <= 182);
      assert.equal(translucent.wholeOpacity, '1');
      assert.equal(translucent.buttonOpacity, '1');
      assert.deepEqual(translucent.text, night.text);
      assert.equal(translucent.text[3], 255);
      assert.deepEqual(await hostColors(), host);
      await slider.press('ArrowLeft');
      await theme.getByText('29%', { exact: true }).waitFor();
      await follow.press('Space');
      await waitMode(tab, '主题设置', 'light');
      assert.equal(await follow.isChecked(), false);
      assert.equal(await slider.count(), 0);
      assert.equal((await palette(theme)).background[3], 255);
      const darkRadio = theme.getByRole('radio', { name: '夜间', exact: true });
      await theme.getByText('夜间', { exact: true }).tap();
      assert(await darkRadio.isChecked());
      await waitMode(tab, '主题设置', 'dark');
      assert.equal((await palette(theme)).background[3], 255);
      await follow.press('Space');
      assert.equal(await slider.inputValue(), '29');
      assert((await palette(theme)).background[3] < 255);
      await follow.press('Space');
      assert.equal((await palette(theme)).background[3], 255);
      await flush();
      const ui = JSON.parse(stores.get('one').values[uiKey]);
      assert.deepEqual(ui.theme, { followHost: false, manual: 'dark', transparency: 29 });

      await open();
      await waitMode(tab, 'API 管理器', 'dark');
      const reloaded = await palette(main);
      assert.equal(reloaded.background[3], 255);
      const reopened = await openThemes(tab, main);
      assert.equal(await reopened.theme.getByLabel('跟随 ST/TT 主题', { exact: true }).isChecked(), false);
      const restoredFollow = reopened.theme.getByLabel('跟随 ST/TT 主题', { exact: true });
      assert.equal(await reopened.theme.getByRole('slider').count(), 0);
      await restoredFollow.press('Space');
      assert.equal(await reopened.theme.getByRole('slider', { name: '面板透明度' }).inputValue(), '29');
      await restoredFollow.press('Space');
      await tab.keyboard.press('Escape');
      assert(await reopened.hub.isVisible());
      assert(await button(reopened.hub, '主题设置').evaluate(el => document.activeElement === el));
      await button(hub, '标签设置').tap();
      const tags = pane(tab, '标签设置');
      assert(await tags.getByText('紫藤标签', { exact: true }).isVisible());
      await button(tags, '取消').tap();
      await button(hub, '数据').tap();
      const data = pane(tab, '数据');
      await button(data, '导出').waitFor();
      await button(data, '导入').waitFor();
      assert.equal((await palette(data)).mode, 'dark');
      await button(data, '关闭').tap();
      await tab.keyboard.press('Escape');
      assert(await button(main, '设置').evaluate(el => document.activeElement === el));
      assert.deepEqual(JSON.parse(stores.get('one').values[catalogKey]).catalog.groups, groups);
      await assertConnection();
    }, { viewport: { width, height: 820 }, hasTouch: true }));
}
