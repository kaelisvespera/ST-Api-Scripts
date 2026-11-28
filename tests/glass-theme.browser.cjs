const assert = require('node:assert/strict');
const test = require('node:test');
const { withBrowser } = require('./browser-fixture.cjs');

const dialog = (tab, name) => tab.getByRole('dialog', { name, exact: true });
const button = (scope, name) => scope.getByRole('button', { name, exact: true });
const groupFixtures = [
  { id: 'yellow', name: '黄色标签', color: '#ffff00', painted: 'rgb(255, 255, 0)' },
  { id: 'cyan', name: '青色标签', color: '#00ffff', painted: 'rgb(0, 255, 255)', icon: 'gemini' },
  { id: 'blue', name: '蓝色标签', color: '#0000ff', painted: 'rgb(0, 0, 255)', icon: 'claude' },
];
const tagName = groupFixtures[0].name;
const themes = {
  light: { tint: 'rgba(232, 224, 210, .32)', ink: 'rgba(30, 28, 25, .72)', wallpaper: '#16104d' },
  dark: { tint: 'rgba(26, 28, 42, .34)', ink: 'rgba(240, 243, 252, .72)', wallpaper: '#ffb531' },
};

async function textContrast(text) {
  return text.evaluate(element => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext('2d');
    const pane = element.closest('dialog');
    const layers = [];
    for (let node = element; node; node = node.parentElement) {
      layers.unshift(getComputedStyle(node).backgroundColor);
      if (node === pane) break;
    }
    for (const color of layers) {
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, 1, 1);
    }
    const before = ctx.getImageData(0, 0, 1, 1).data;
    ctx.fillStyle = getComputedStyle(element).color;
    ctx.fillRect(0, 0, 1, 1);
    const after = ctx.getImageData(0, 0, 1, 1).data;
    const luminance = rgb => [0.2126, 0.7152, 0.0722].reduce((total, factor, index) => {
      const channel = rgb[index] / 255;
      const linear = channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
      return total + factor * linear;
    }, 0);
    const lighter = Math.max(luminance(before), luminance(after));
    const darker = Math.min(luminance(before), luminance(after));
    return (lighter + 0.05) / (darker + 0.05);
  });
}

async function assertLegible(text, label) {
  const ratio = await textContrast(text);
  assert.ok(ratio >= 4.5, `${label} contrast was ${ratio.toFixed(2)}:1`);
}

async function assertSurface(pane, label) {
  const style = await pane.evaluate(element => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext('2d');
    const style = getComputedStyle(element);
    ctx.fillStyle = style.backgroundColor;
    ctx.fillRect(0, 0, 1, 1);
    return { alpha: ctx.getImageData(0, 0, 1, 1).data[3], opacity: style.opacity, shadow: style.boxShadow };
  });
  assert.deepEqual(style, { alpha: 255, opacity: '1', shadow: 'none' }, label);
}

async function assertGroupPaint(heading, group) {
  const paint = await heading.evaluate(element => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d');
    const readColor = color => {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
      return [...context.getImageData(0, 0, 1, 1).data];
    };
    const headingStyle = getComputedStyle(element);
    const dialogStyle = getComputedStyle(element.closest('dialog'));
    const stripe = getComputedStyle(element, '::before');
    return {
      surface: readColor(headingStyle.backgroundColor),
      panel: readColor(dialogStyle.backgroundColor),
      outline: readColor(headingStyle.borderTopColor),
      outlineWidth: headingStyle.borderTopWidth,
      outlineStyle: headingStyle.borderTopStyle,
      stripeColor: stripe.backgroundColor,
      stripeEdge: readColor(stripe.borderTopColor),
      stripeBoxSizing: stripe.boxSizing,
      stripeWidth: stripe.width,
      stripeEdgeWidth: stripe.borderTopWidth,
      stripeEdgeStyle: stripe.borderTopStyle,
      stripePointerEvents: stripe.pointerEvents,
    };
  });
  assert.equal(paint.surface[3], 255, group.name);
  assert.notDeepEqual(paint.surface, paint.panel, group.name);
  assert.notDeepEqual(paint.outline, paint.surface, group.name);
  assert.ok(paint.outline[3] > 0, group.name);
  assert.deepEqual([paint.outlineWidth, paint.outlineStyle], ['1px', 'solid'], group.name);
  assert.equal(paint.stripeColor, group.painted, group.name);
  assert.ok(paint.stripeEdge[3] > 0, group.name);
  assert.notDeepEqual(paint.stripeEdge, paint.surface, group.name);
  assert.deepEqual([paint.stripeBoxSizing, paint.stripeWidth, paint.stripeEdgeWidth,
    paint.stripeEdgeStyle, paint.stripePointerEvents], ['border-box', '7px', '1px', 'solid', 'none'], group.name);
}

async function assertGroupHeadings(pane, groupHeader) {
  const headings = pane.locator(groupHeader);
  for (const group of groupFixtures) {
    const heading = headings.filter({ hasText: group.name });
    assert.ok(await heading.evaluate(element => element.classList.contains('catalog-colored-group-heading')), group.name);
    await assertLegible(heading.getByText(group.name, { exact: true }), group.name);
    await assertLegible(heading.getByText('(1)', { exact: true }), group.name + ' count');
    await assertGroupPaint(heading, group);
    if (group.icon) {
      const marker = heading.locator('.catalog-tag-icon--' + group.icon);
      assert.ok(await marker.isVisible(), group.icon);
      assert.notEqual(await marker.evaluate(element => getComputedStyle(element).maskImage), 'none', group.icon);
    } else {
      const marker = await heading.locator('.category-color-dot').evaluate(element => {
        const style = getComputedStyle(element);
        return [style.backgroundColor, style.outlineWidth, style.outlineStyle, style.outlineColor];
      });
      assert.deepEqual(marker.slice(0, 3), [group.painted, '1px', 'solid'], group.name);
      assert.notEqual(marker[3], group.painted, group.name);
    }
  }
  const unassigned = headings.filter({ hasText: '未分类' });
  const rail = await unassigned.evaluate(element => getComputedStyle(element, '::before').content);
  assert.ok(rail === 'none' || rail === 'normal', '未分类 does not have a color rail');
}

for (const mode of ['st', 'tt']) for (const [theme, values] of Object.entries(themes)) {
  test(`${mode}: ${theme} glass separates group headings and keeps original tag colors`, { timeout: 30000 }, () =>
    withBrowser(mode, async ({ tab, open, stores, origin, assertConnection }) => {
      const catalog = {
        format: 'st-api-manager-catalog', version: 2,
        groups: groupFixtures.map(({ id, name, color, icon }) => ({ id, name, color, icon })),
        entries: [...groupFixtures.map(group => [group.id, [group.id]]), ['unassigned', []]]
          .map(([id, groupIds]) => ({ id, name: '合成条目-' + id, model: 'fixture-model-' + id,
            site: '合成站点', source: 'custom', url: origin + '/provider/v1', key: 'fixture-key', groupIds })),
      };
      stores.set('one', { version: 1, values: { st_api_manager_catalog_v2: JSON.stringify({
        catalog, sync: { revision: null, pending: false },
      }) } });
      await tab.setViewportSize({ width: mode === 'st' ? 320 : 390, height: 800 });
      await open();
      const main = dialog(tab, 'API 管理器');
      await button(main, '关闭').click();

      await tab.addStyleTag({ content: `
        :root { --SmartThemeBodyColor: ${values.ink}; --SmartThemeBlurTintColor: ${values.tint};
          --SmartThemeShadowColor: rgba(255, 255, 255, .75); }
        body { background: ${values.wallpaper}; }
        .popup { backdrop-filter: blur(9px); }
        html body :is(dialog.popup:not(#loader), #other-popup) { background: var(--SmartThemeBlurTintColor) !important; }
        html body .inline-drawer-header:not(.world_entry *):not(:empty) { border-left: 3px solid #294b71 !important; }
        .menu_button, .text_pole { background: var(--SmartThemeBlurTintColor); }
      ` });
      await tab.evaluate(() => {
        const hostPopup = document.createElement('dialog');
        hostPopup.id = 'fixture-host-glass';
        hostPopup.className = 'popup';
        document.body.append(hostPopup);
      });
      await tab.locator('#st-api-manager-extension-button').click();
      await assertSurface(main, 'main dialog');
      await assertGroupHeadings(main, 'summary.inline-drawer-header');
      await assertLegible(main.locator('.catalog-card-alias').filter({ hasText: '合成条目-yellow' }), 'entry alias');
      const foldedGroup = main.locator('summary.inline-drawer-header').filter({ hasText: tagName });
      await foldedGroup.getByText(tagName, { exact: true }).click();
      assert.equal(await foldedGroup.evaluate(element => element.parentElement.open), false);
      await assertGroupPaint(foldedGroup, groupFixtures[0]);

      assert.equal(await main.getAttribute('data-catalog-theme'), theme);

      await button(main, '设置').click();
      const settings = dialog(tab, '设置');
      await assertSurface(settings, 'settings hub');
      await button(settings, '标签设置').click();
      const tags = dialog(tab, '标签设置');
      await assertSurface(tags, 'tag dialog');
      await assertLegible(tags.locator('.category-tag-name').filter({ hasText: tagName }), 'tag settings name');
      await button(tags.locator('.category-tag').filter({ hasText: tagName }), '重命名或改色').click();
      const editTag = dialog(tab, '编辑标签');
      await assertSurface(editTag, 'tag edit dialog');
      await button(editTag, '取消').click();
      await button(tags, '取消').click();
      await button(settings, '关闭').click();

      await button(main, 'API 管理').click();
      const manager = dialog(tab, 'API 管理');
      await button(manager, '编辑此组的端点、密钥和模型').click();
      const editApi = dialog(tab, '编辑 API 配置');
      await assertSurface(editApi, 'API edit dialog');
      await assertLegible(editApi.locator('.popup-header'), 'API edit heading');
      await button(editApi, '取消').click();
      await button(manager, '关闭').click();
      await button(main, '关闭').click();

      await tab.evaluate(() => {
        const form = document.createElement('form');
        form.setAttribute('aria-label', '合成插件 API 表单');
        form.innerHTML = '<label>API 地址<input type="url" name="apiUrl"></label>' +
          '<label>API Key<input type="password" name="apiKey"></label>';
        document.body.append(form);
      });
      const form = tab.getByRole('form', { name: '合成插件 API 表单' });
      await form.getByLabel('API 地址').click();
      await button(form, '填入 API').click();
      const picker = dialog(tab, '填入插件 API');
      await assertSurface(picker, 'form fill picker');
      await assertGroupHeadings(picker, 'summary.catalog-fill-group-header');
      assert.equal(await tab.locator('#fixture-host-glass').evaluate(element => getComputedStyle(element).backgroundColor), values.tint.replace(' .', ' 0.'));
      await assertConnection();
    }));
}
