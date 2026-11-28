const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { withBrowser } = require('./browser-fixture.cjs');

const dialog = (page, name) => page.getByRole('dialog', { name, exact: true });
const button = (pane, name) => pane.getByRole('button', { name, exact: true });
const alignmentGroups = ['色点', 'Claude', 'Gemini', 'DeepSeek'].map((name, index) => ({
  id: 'align-' + index, name: '对齐夹具 ' + name, color: '#3b82f6',
  icon: index ? name.toLowerCase() : undefined,
}));

async function assertAlignedMarkers(pane, tab) {
  const headings = pane.locator('summary.catalog-group-heading').filter({ hasText: '对齐夹具' });
  for (const [mode, tint, ink] of [['light', '#f5f1ea', '#2f2a26'], ['dark', '#25262a', '#e9e6df']]) {
    await tab.evaluate(([surface, text]) => {
      document.documentElement.style.setProperty('--SmartThemeBlurTintColor', surface);
      document.documentElement.style.setProperty('--SmartThemeBodyColor', text);
    }, [tint, ink]);
    await pane.and(tab.locator('[data-catalog-theme="' + mode + '"]')).waitFor();
    const metrics = await headings.evaluateAll(elements => elements.map(heading => {
      const name = heading.querySelector('b').getBoundingClientRect();
      const rail = heading.querySelector('.catalog-group-rail').getBoundingClientRect();
      const marker = heading.querySelector('.catalog-tag-icon, .category-color-dot');
      const box = marker.getBoundingClientRect();
      const css = getComputedStyle(marker);
      return { label: name.left - rail.right, center: box.left + box.width / 2 - rail.right,
        railGap: box.left - rail.right, labelGap: name.left - box.right,
        width: box.width, height: box.height, fontSize: parseFloat(css.fontSize), mask: css.maskImage };
    }));
    assert.equal(metrics.length, alignmentGroups.length);
    const [dot, ...icons] = metrics;
    for (const marker of metrics) {
      assert.ok(Math.abs(marker.label - dot.label) < 0.25, 'group names start in the same column');
      assert.ok(Math.abs(marker.center - dot.center) < 0.25, 'dots and icons share a centerline');
      assert.ok(marker.railGap >= 3 && marker.labelGap >= 3, 'markers keep clear of the rail and text');
    }
    assert.equal(dot.width, 10);
    assert.equal(dot.height, 10);
    for (const icon of icons) {
      assert.ok(icon.mask !== 'none');
      assert.ok(Math.abs(icon.width - icon.fontSize) < 0.1 && Math.abs(icon.height - icon.fontSize) < 0.1);
    }
  }
}

for (const mode of ['st', 'tt']) test(mode + ': tag icons can be created, changed and cleared independently of color', {
  timeout: 60000,
}, () => withBrowser(mode, async ({ tab, open, flush, stores, origin, assertConnection }) => {
  if (mode === 'tt') {
    const entries = alignmentGroups.map(group => ({ id: group.id, name: group.name, site: '示例站点', model: group.id,
      source: 'custom', url: origin + '/v1', key: 'fixture-' + group.id, groupIds: [group.id] }));
    const catalog = { format: 'st-api-manager-catalog', version: 2, groups: alignmentGroups, entries };
    stores.set('one', { version: 1, values: {
      st_api_manager_catalog_v2: JSON.stringify({ catalog, sync: { revision: null, pending: false } }),
      st_api_manager_ui_v1: JSON.stringify({ collapsedGroups: alignmentGroups.map(group => group.id) }),
    } });
  }
  await tab.setViewportSize({ width: 320, height: 700 });
  await open();
  await tab.addStyleTag({ content: ':root{--mainFontSize:20px}' });
  const main = dialog(tab, 'API 管理器');
  const settings = dialog(tab, '设置');
  const tags = dialog(tab, '标签设置');
  const editor = dialog(tab, '编辑标签');
  const name = '图标回归标签';
  const color = '#a23465';
  const tag = tags.locator('.category-tag').filter({ hasText: name });
  const savedTag = () => JSON.parse(stores.get('one').values.st_api_manager_catalog_v2).catalog.groups
    .find(group => group.name === name);
  await button(main, '设置').click();
  await button(settings, '标签设置').click();
  await tags.getByRole('textbox', { name: '新分组名称' }).fill(name);
  await tags.getByLabel('选择颜色').fill(color);
  await tags.getByRole('radio', { name: 'Claude', exact: true }).check();
  await button(tags, '新建分类').click();
  await tag.locator('.catalog-tag-icon--claude').waitFor();
  await flush();
  assert.equal(savedTag().icon, 'claude');
  assert.equal(savedTag().color, color);
  assert.equal(await tags.evaluate(el => el.scrollWidth > el.clientWidth), false);
  const preview = process.env.ST_API_TAG_PREVIEW;
  if (preview) {
    fs.mkdirSync(preview, { recursive: true });
    await tags.getByRole('group', { name: '标签图标' }).scrollIntoViewIfNeeded();
    await tab.screenshot({ path: path.join(preview, mode + '-tag-picker-320.png') });
  }

  await button(tag, '重命名或改色').click();
  assert.equal(await editor.getByRole('radio', { name: 'Claude' }).isChecked(), true);
  assert.equal(await editor.getByLabel('选择颜色').inputValue(), color);
  await editor.getByRole('radio', { name: 'Gemini' }).check();
  await button(editor, '保存').click();
  await tag.locator('.catalog-tag-icon--gemini').waitFor();
  await flush();
  assert.equal(savedTag().icon, 'gemini');
  await button(tag, '重命名或改色').click();
  await editor.getByRole('radio', { name: 'DeepSeek', exact: true }).check();
  await button(editor, '保存').click();
  const whale = tag.locator('.catalog-tag-icon--deepseek');
  await whale.waitFor();
  await flush();
  assert.equal(savedTag().icon, 'deepseek');
  assert.equal(savedTag().color, color);
  const appearance = await whale.evaluate(async el => {
    const { backgroundColor, maskImage } = getComputedStyle(el);
    const mask = new Image();
    mask.src = maskImage.slice(5, -2);
    await mask.decode();
    return { backgroundColor, width: mask.naturalWidth, height: mask.naturalHeight };
  });
  assert.equal(appearance.backgroundColor, 'rgb(77, 107, 254)');
  assert.ok(appearance.width > appearance.height && appearance.height > 0);
  await button(tags, '取消').click();
  await button(settings, '关闭').click();
  const group = main.locator('details.inline-drawer').filter({ hasText: name });
  await group.locator('summary .catalog-tag-icon--deepseek').waitFor();
  assert.equal(await group.locator('.catalog-group-rail').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(162, 52, 101)');

  await open();
  await group.locator('summary .catalog-tag-icon--deepseek').waitFor();
  await button(main, '设置').click();
  await button(settings, '标签设置').click();
  await button(tag, '重命名或改色').click();
  assert.equal(await editor.getByRole('radio', { name: 'DeepSeek' }).isChecked(), true);
  await editor.getByRole('radio', { name: '色点' }).check();
  await button(editor, '保存').click();
  await tag.locator('.category-color-dot').waitFor();
  await flush();
  assert.equal(savedTag().icon, undefined);
  assert.equal(savedTag().color, color);
  if (mode === 'tt') {
    await button(tags, '取消').click();
    await button(settings, '关闭').click();
    for (const width of [320, 1280]) {
      await tab.setViewportSize({ width, height: 800 });
      await assertAlignedMarkers(main, tab);
    }
    await button(main, '关闭').click();
    await tab.evaluate(() => {
      const form = document.createElement('form');
      form.id = 'fixture-icon-alignment-target';
      form.innerHTML = '<label>API 地址<input type="url" name="apiUrl"></label>' +
        '<label>API Key<input type="password" name="apiKey"></label>';
      document.body.append(form);
    });
    const target = tab.locator('#fixture-icon-alignment-target');
    await target.getByLabel('API 地址').click();
    await button(target, '填入 API').click();
    const picker = dialog(tab, '填入插件 API');
    for (const width of [1280, 320]) {
      await tab.setViewportSize({ width, height: 800 });
      await assertAlignedMarkers(picker, tab);
    }
  }
  await assertConnection();
}));
