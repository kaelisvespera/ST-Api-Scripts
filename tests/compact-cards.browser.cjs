const assert = require('node:assert/strict');
const test = require('node:test');
const { withBrowser } = require('./browser-fixture.cjs');
for (const mode of ['st', 'tt']) test(mode + ': compact cards switch sorting without applying and restore focus', {timeout:60000}, () => withBrowser(mode, async ({tab,open,assertConnection,stores,origin}) => {
  const catalog = {
    format: 'st-api-manager-catalog', version: 2,
    groups: [{ id: 'a', name: '测试组', color: '#3578ab' }],
    keyNotes: [{ id: 'short', note: '薯条' }, { id: 'multiple', note: '第一行\n第二行' }],
    entries: [1, 2, 3].map(i => ({
      id: 'row' + i, name: 'model' + i, model: 'model' + i, site: '合成站点', modelNote: '0.06',
      source: 'custom', url: origin + '/provider/v1', key: 'fixture-key-' + i, groupIds: ['a'],
      ...(i === 1 ? { credentialId: 'short' } : i === 2 ? { credentialId: 'multiple' } : {}),
    })),
  };
  stores.set('one',{version:1,values:{st_api_manager_catalog_v2:JSON.stringify({catalog,sync:{revision:null,pending:false}})}});
  await open();
  const main=tab.getByRole('dialog',{name:'API 管理器',exact:true});
  const drawer=main.locator('details').first(), card=drawer.locator('.catalog-config-card').first();
  assert.equal(await card.locator('.catalog-sort-controls').count(),0);
  const note = card.locator('.catalog-card-notes dd').first();
  assert.equal(await note.textContent(), '薯条');
  assert.equal(await card.getByRole('button', { name: 'model1', exact: true }).count(), 0);
  await card.locator('.catalog-card-model').click();
  await assertConnection();
  await drawer.getByRole('button',{name:'排序',exact:true}).click();
  assert.equal(await card.locator('.catalog-card-actions').isVisible(),false);
  assert.equal(await card.locator('.catalog-sort-handle').isVisible(),true);
  await card.locator('.catalog-card-meta').click();
  await assertConnection();
  await drawer.getByRole('button',{name:'完成',exact:true}).focus();
  await tab.keyboard.press('Escape');
  assert.equal(await main.isVisible(),true);
  assert.equal(await drawer.getByRole('button',{name:'排序',exact:true}).evaluate(el=>el===document.activeElement),true);
  assert.equal(await card.locator('.catalog-sort-controls').count(),0);
  await assertConnection();
  await drawer.getByRole('button',{name:'排序',exact:true}).click();
  await drawer.locator('summary b').click();
  await tab.waitForFunction(()=>!document.querySelector('.catalog-card-sort-mode'));
  await drawer.locator('summary b').click();
  await drawer.getByRole('button',{name:'排序',exact:true}).click();
  await main.getByRole('button',{name:'关闭',exact:true}).click();
  await tab.locator('#st-api-manager-extension-button').click();
  assert.equal(await main.locator('.catalog-sort-controls').count(),0);
  await assertConnection();

  const multilineCard = drawer.locator('[data-entry-id="row2"]');
  await multilineCard.getByRole('button', { name: '应用', exact: true }).click();
  const badge = multilineCard.getByText('已应用', { exact: true });
  await badge.waitFor();
  const badgeRight = () => badge.evaluate(node =>
    node.closest('.catalog-config-card').getBoundingClientRect().right - node.getBoundingClientRect().right);
  const before = await badgeRight();
  const toggle = multilineCard.getByRole('button', { name: 'model2', exact: true });
  const keyNote = multilineCard.locator('.catalog-card-notes dd').first();
  const compactHeight = await keyNote.evaluate(node => node.clientHeight);
  await toggle.press('Enter');
  assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
  assert.equal(await keyNote.textContent(), '第一行\n第二行');
  assert.ok(await keyNote.evaluate(node => node.clientHeight) > compactHeight);
  assert.ok(Math.abs(await badgeRight() - before) < 1, 'the applied badge stays aligned at the right');
  await toggle.press('Space');
  assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
  assert.equal(await toggle.evaluate(button => button === document.activeElement), true);
}));

for (const mode of ['st','tt']) test(mode+': five actions, expandable text and host themes fit narrow screens', {timeout:60000},()=>withBrowser(mode,async({tab,open,stores,origin,assertConnection,flush})=>{
  const long='完整长名称与备注'.repeat(14);
  const responsiveModel = 'fixture-model-' + 'm'.repeat(18);
  const catalog={format:'st-api-manager-catalog',version:2,groups:[{id:'a',name:'测试组',color:'#3578ab'}],entries:[1,2].map(i=>({id:'row'+i,name:'原条目'+i,model:'model-'+i+'-'+long,site:long,modelNote:long,source:'custom',url:origin+'/provider/v1',key:'fixture-key-'+i,groupIds:['a']}))};
  catalog.entries.push({
    ...catalog.entries[0], id: 'responsive', model: responsiveModel, name: responsiveModel,
    site: '合成站点', modelNote: '',
  });
  stores.set('one',{version:1,values:{st_api_manager_catalog_v2:JSON.stringify({catalog,sync:{revision:null,pending:false}})}});
  await open();const main=tab.getByRole('dialog',{name:'API 管理器',exact:true}),card=main.locator('.catalog-config-card').first();
  const themes={light:['#182631','#edf1f4','#536b7a','#245e92'],dark:['#f0e9df','#252931','#abb4c3','#edc284'],custom:['#fff2d2','#352040','#cda2d4','#e9c277']};
  for(const [theme,colors] of Object.entries(themes)) for(const width of [320,390]) {
    await tab.setViewportSize({width,height:800});
    await tab.evaluate(colors=>{['--SmartThemeBodyColor','--SmartThemeBlurTintColor','--SmartThemeBorderColor','--SmartThemeQuoteColor'].forEach((key,i)=>document.documentElement.style.setProperty(key,colors[i]));document.documentElement.style.setProperty('--mainFontSize','20px');},colors);
    await tab.addStyleTag({content:'.menu_button{background:var(--SmartThemeBlurTintColor);color:var(--SmartThemeBodyColor)}'});
    await tab.waitForFunction(expected => document.querySelector('dialog.st-api-manager[open]')?.dataset.catalogTheme === expected,
      theme === 'light' ? 'light' : 'dark');
    const fit=await card.evaluate(el=>{const box=el.getBoundingClientRect(),buttons=[...el.querySelectorAll('.catalog-card-actions button')].map(b=>b.getBoundingClientRect());return {names:[...el.querySelectorAll('.catalog-card-actions button')].map(b=>b.getAttribute('aria-label')),sameRow:buttons.every(b=>Math.abs(b.top-buttons[0].top)<1),fits:buttons.every(b=>b.left>=box.left&&b.right<=box.right&&b.width>=28),overflow:el.scrollWidth>el.clientWidth,truncated:el.querySelector('.catalog-card-notes dd').scrollWidth>el.querySelector('.catalog-card-notes dd').clientWidth,color:getComputedStyle(el).color,dialogColor:getComputedStyle(el.closest('dialog')).color};});
    assert.deepEqual(fit.names,['应用','编辑','管理分组','移出当前分组','删除']);assert.ok(fit.sameRow&&fit.fits&&!fit.overflow&&fit.truncated,JSON.stringify(fit));assert.equal(fit.color,fit.dialogColor);
    const contrast=await card.evaluate(el=>{
      const ctx=document.createElement('canvas').getContext('2d');
      const lum=color=>{ctx.clearRect(0,0,1,1);ctx.fillStyle=color;ctx.fillRect(0,0,1,1);const rgb=[...ctx.getImageData(0,0,1,1).data].slice(0,3).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;});return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;};
      const style=getComputedStyle(el),a=lum(style.color),b=lum(style.backgroundColor);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);
    });assert.ok(contrast>=4.5,theme+' text contrast '+contrast);
    const folder=require('node:path').resolve('work/compact-cards-20261113/screenshots');require('node:fs').mkdirSync(folder,{recursive:true});
    await tab.screenshot({path:require('node:path').join(folder,mode+'-'+theme+'-'+width+'.png')});
    const disclosure = card.locator('.catalog-card-disclosure');
    await disclosure.waitFor();
    await card.locator('.catalog-card-model').click();
    assert.equal(await disclosure.getAttribute('aria-expanded'), 'true');
    assert.equal(await card.locator('.catalog-card-notes dd').evaluate(el=>el.scrollWidth<=el.clientWidth+1),true);
    await disclosure.click();
  }

  const responsive = main.locator('[data-entry-id="responsive"]');
  await tab.addStyleTag({ content: '[data-entry-id="responsive"] .catalog-card-model { font: 20px monospace }' });
  const disclosure = responsive.getByRole('button', { name: responsiveModel, exact: true });
  await tab.setViewportSize({ width: 320, height: 800 });
  await disclosure.waitFor();
  assert.equal(await responsive.locator('.catalog-card-original').count(), 0);
  await disclosure.click();
  assert.equal(await disclosure.getAttribute('aria-expanded'), 'true');
  const title = responsive.locator('.catalog-card-model');
  assert.equal(await title.textContent(), responsiveModel);
  assert.ok(await title.evaluate(node => node.clientHeight > parseFloat(getComputedStyle(node).fontSize) * 1.5));
  await disclosure.click();
  await disclosure.focus();
  await tab.setViewportSize({ width: 1024, height: 800 });
  await disclosure.waitFor({ state: 'hidden' });
  const titleArea = responsive.locator('.catalog-card-title');
  assert.equal(await titleArea.evaluate(node => node === document.activeElement && node.tabIndex === -1), true);
  await title.click();
  await tab.setViewportSize({ width: 390, height: 800 });
  await disclosure.waitFor();
  assert.equal(await disclosure.getAttribute('aria-expanded'), 'false');
  await assertConnection();
  await card.getByRole('button',{name:'编辑',exact:true}).click();
  await tab.getByRole('dialog',{name:'编辑 API 配置',exact:true}).getByRole('button',{name:'取消',exact:true}).click();
  await card.getByRole('button',{name:'管理分组',exact:true}).click();
  await tab.getByRole('dialog',{name:'管理分组',exact:true}).getByRole('button',{name:'取消',exact:true}).click();
  await assertConnection();
  await card.locator('.catalog-card-site').click();
  await main.getByText('已应用',{exact:true}).waitFor();
  assert.equal(await tab.evaluate(()=>hostConnection.model),catalog.entries[0].model);
  await flush();assert.deepEqual(JSON.parse(stores.get('one').values.st_api_manager_catalog_v2).catalog.entries,catalog.entries);
}));
