const assert = require('node:assert/strict');
const test = require('node:test');
const { withBrowser } = require('./browser-fixture.cjs');
for (const mode of ['st', 'tt']) test(mode + ': compact cards switch sorting without applying and restore focus', {timeout:60000}, () => withBrowser(mode, async ({tab,open,assertConnection,stores,origin}) => {
  const catalog={format:'st-api-manager-catalog',version:2,groups:[{id:'a',name:'测试组',color:'#3578ab'}],entries:[1,2,3].map(i=>({id:'row'+i,name:'标题'+i,model:'model'+i,site:'合成站点',source:'custom',url:origin+'/provider/v1',key:'fixture-key',groupIds:['a']}))};
  stores.set('one',{version:1,values:{st_api_manager_catalog_v2:JSON.stringify({catalog,sync:{revision:null,pending:false}})}});
  await open();
  const main=tab.getByRole('dialog',{name:'API 管理器',exact:true});
  const drawer=main.locator('details').first(), card=drawer.locator('.catalog-config-card').first();
  assert.equal(await card.locator('.catalog-sort-controls').count(),0);
  await card.locator('.catalog-card-title').click();
  assert.equal(await card.locator('.catalog-card-title').getAttribute('aria-expanded'),'true');
  await card.locator('.catalog-card-title').click();
  assert.equal(await card.locator('.catalog-card-title').getAttribute('aria-expanded'),'false');
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
}));

for (const mode of ['st','tt']) test(mode+': five actions, expandable text and host themes fit narrow screens', {timeout:60000},()=>withBrowser(mode,async({tab,open,stores,origin,assertConnection,flush})=>{
  const long='完整长名称与备注'.repeat(14);
  const catalog={format:'st-api-manager-catalog',version:2,groups:[{id:'a',name:'测试组',color:'#3578ab'}],entries:[1,2].map(i=>({id:'row'+i,name:'原条目'+i,model:'model-'+i+'-'+long,site:long,modelNote:long,source:'custom',url:origin+'/provider/v1',key:'fixture-key-'+i,groupIds:['a']}))};
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
    await card.locator('.catalog-card-title').click();
    assert.equal(await card.locator('.catalog-card-notes dd').evaluate(el=>el.scrollWidth<=el.clientWidth+1),true);
    await card.locator('.catalog-card-title').click();
  }
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
