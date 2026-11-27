const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { withBrowser } = require('./browser-fixture.cjs');

const dialog = (page, name) => page.getByRole('dialog', { name, exact: true });
const button = (pane, name) => pane.getByRole('button', { name, exact: true });

for (const mode of ['st', 'tt']) test(mode + ': tag icons can be created, changed and cleared independently of color', {
  timeout: 60000,
}, () => withBrowser(mode, async ({ tab, open, flush, stores, assertConnection }) => {
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
  await button(tags, '取消').click();
  await button(settings, '关闭').click();
  const group = main.locator('details.inline-drawer').filter({ hasText: name });
  await group.locator('summary .catalog-tag-icon--gemini').waitFor();

  await open();
  await group.locator('summary .catalog-tag-icon--gemini').waitFor();
  await button(main, '设置').click();
  await button(settings, '标签设置').click();
  await button(tag, '重命名或改色').click();
  assert.equal(await editor.getByRole('radio', { name: 'Gemini' }).isChecked(), true);
  await editor.getByRole('radio', { name: '色点' }).check();
  await button(editor, '保存').click();
  await tag.locator('.category-color-dot').waitFor();
  await flush();
  assert.equal(savedTag().icon, undefined);
  assert.equal(savedTag().color, color);
  await assertConnection();
}));
