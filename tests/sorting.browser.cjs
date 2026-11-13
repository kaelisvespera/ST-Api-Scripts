const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { withBrowser } = require('./browser-fixture.cjs');
const pane = (tab, name) => tab.getByRole('dialog', { name, exact: true });
const button = (from, name) => from.getByRole('button', { name, exact: true });
function seed(stores, origin) {
  const catalog = { format: 'st-api-manager-catalog', version: 2,
    groups: ['A','B','C'].map(id => ({ id, name: '标签' + id, color: '#3b82f6' })),
    entries: ['one','two','three'].map((id,index) => ({ id, name: '', model: '企业' + (index + 1),
      site: index === 1 ? '隐藏站点' : '显示站点', source: 'custom', url: origin + '/provider/v1', key: 'fixture-sort-key', groupIds: ['A','B'] })) };
  stores.set('one', { version: 1, values: { st_api_manager_catalog_v2: JSON.stringify({ catalog, sync: { revision: null, pending: false } }) } });
  return catalog;
}
const group = (main,id) => main.locator('.secretKeyManagerList:has([data-group-id="' + id + '"])');
const enterSort = main => main.locator('.catalog-sort-toggle[data-group-id="A"]').click();
const order = list => list.locator('.catalog-config-card').evaluateAll(nodes => nodes.map(node => node.dataset.entryId));
async function drag(tab, handle, target, cancel) {
  await handle.scrollIntoViewIfNeeded();
  const from = await handle.boundingBox(), to = await target.boundingBox();
  await tab.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await tab.mouse.down(); await tab.mouse.move(to.x + to.width / 2, to.y + to.height - 2, { steps: 8 });
  if (cancel) await tab.keyboard.press('Escape');
  await tab.mouse.up();
}
for (const mode of ['st','tt']) test(mode + ': pointer and keyboard sorting persists, cancels safely and isolates filtered labels', { timeout: 60000 },
  () => withBrowser(mode, async ({tab, open, stores, origin, flush, assertConnection}) => {
    const original = seed(stores,origin); await tab.setViewportSize({width:1100,height:1100}); await open();
    const main = pane(tab,'API 管理器'); const a = group(main,'A'), b = group(main,'B'); await enterSort(main);
    await drag(tab,a.locator('.catalog-sort-handle').first(),a.locator('.catalog-config-card').last(),true);
    assert.deepEqual(await order(a),['one','two','three']); assert.equal(await main.isVisible(),true);
    await drag(tab,a.locator('.catalog-sort-handle').first(),a.locator('.catalog-config-card').last());
    await main.getByText('已保存此分组内的顺序。',{exact:true}).waitFor();
    assert.deepEqual(await order(a),['two','three','one']); assert.deepEqual(await order(b),['one','two','three']);
    await a.locator('.catalog-sort-handle').last().press('ArrowUp');
    await tab.waitForFunction(() => [...document.querySelectorAll('.catalog-config-card[data-group-id="A"]')].map(n=>n.dataset.entryId).join(',') === 'two,one,three' && document.activeElement?.closest('.catalog-config-card')?.dataset.entryId === 'one');
    assert.deepEqual(await order(a),['two','one','three']);
    await button(main,'标签设置').click(); const tags=pane(tab,'标签设置');
    await drag(tab,tags.locator('.catalog-sort-handle').first(),tags.locator('.catalog-sort-tags > .category-tag').last());
    await tags.getByText('已保存标签和主界面的分组顺序。',{exact:true}).waitFor();
    assert.deepEqual(await tags.locator('.catalog-sort-tags > .category-tag').evaluateAll(nodes=>nodes.map(n=>n.dataset.sortId)),['B','C','A']);
    await tab.setViewportSize({width:320,height:568}); await tab.addStyleTag({content:':root{--mainFontSize:20px}.fa-grip-vertical:before{content:"⠿"}.fa-arrow-up:before{content:"↑"}.fa-arrow-down:before{content:"↓"}'});
    assert.equal(await tags.evaluate(el=>el.scrollWidth>el.clientWidth),false);
    fs.mkdirSync(path.resolve('work','compact-cards-20261113','sorting-screenshots'),{recursive:true});
    for(const width of [320,390]) {
      await tab.setViewportSize({width,height:700});
      await tags.locator('.catalog-sort-tags > .category-tag').first().scrollIntoViewIfNeeded();
      await tab.screenshot({path:path.resolve('work','compact-cards-20261113','sorting-screenshots',mode+'-tags-first-'+width+'.png')});
      await tags.locator('.catalog-sort-tags > .category-tag').last().scrollIntoViewIfNeeded();
      await tab.screenshot({path:path.resolve('work','compact-cards-20261113','sorting-screenshots',mode+'-tags-last-'+width+'.png')});
    }
    await tab.setViewportSize({width:320,height:568});
    await button(tags,'取消').click(); await flush(); await open();
    await tab.addStyleTag({content:':root{--mainFontSize:20px}.fa-grip-vertical:before{content:"⠿"}.fa-arrow-up:before{content:"↑"}.fa-arrow-down:before{content:"↓"}'});
    assert.deepEqual(await order(group(pane(tab,'API 管理器'),'A')),['two','one','three']);
    assert.deepEqual(JSON.parse(stores.get('one').values.st_api_manager_catalog_v2).catalog.entries,original.entries);
    await button(main,'筛选').click(); const filters=pane(tab,'筛选');
    await filters.locator('label').filter({hasText:'显示站点'}).locator('input').check();
    await button(filters,'关闭').click();
    assert.deepEqual(await order(a),['one','three']); await enterSort(main);
    await a.locator('.catalog-sort-handle').first().press('ArrowDown');
    await main.getByText('已保存此分组内的顺序。',{exact:true}).waitFor();
    assert.deepEqual(await order(a),['three','one']); await flush();
    const saved=JSON.parse(stores.get('one').values.st_api_manager_catalog_v2).catalog;
    assert.deepEqual(saved.groupOrders.find(o=>o.groupId==='A').entryIds,['two','three','one']);
    await tab.screenshot({path:path.resolve('work','compact-cards-20261113','sorting-screenshots',mode+'-cards-320.png')});
    await assertConnection();
  }));

test('touch handle reorder and pointer cancellation never trigger row actions', {timeout:60000}, () => withBrowser('tt',async ({tab,open,stores,origin,assertConnection})=>{
  seed(stores,origin);await tab.setViewportSize({width:390,height:1100});await open();
  const main=pane(tab,'API 管理器'),a=group(main,'A');
  await enterSort(main); const client=await tab.context().newCDPSession(tab);
  async function touch(cancel) {
    const handle=a.locator('.catalog-sort-handle').first();await handle.scrollIntoViewIfNeeded();
    const from=await handle.boundingBox(),to=await a.locator('.catalog-config-card').last().boundingBox();
    await client.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:from.x+from.width/2,y:from.y+from.height/2}]});
    await client.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:to.x+to.width/2,y:to.y+to.height-3}]});
    await client.send('Input.dispatchTouchEvent',{type:cancel?'touchCancel':'touchEnd',touchPoints:[]});
  }
  await touch(true);assert.deepEqual(await order(a),['one','two','three']);
  await touch(false);await main.getByText('已保存此分组内的顺序。',{exact:true}).waitFor();
  assert.deepEqual(await order(a),['two','three','one']);await assertConnection();
},{hasTouch:true}));


test('touch edge autoscroll reaches offscreen cards and stops after cancellation', {timeout:60000}, () => withBrowser('tt',async ({tab,open,stores,origin,assertConnection})=>{
  const catalog=seed(stores,origin); catalog.groups=[catalog.groups[0]];
  catalog.entries=Array.from({length:12},(_,index)=>({...catalog.entries[0],id:'long-'+index,model:'模型'+index,groupIds:['A']}));
  stores.set('one',{version:1,values:{st_api_manager_catalog_v2:JSON.stringify({catalog,sync:{revision:null,pending:false}})}});
  await tab.setViewportSize({width:390,height:700});await open();
  const main=pane(tab,'API 管理器'),a=group(main,'A'),scroll=main.locator('.popup-scroll-content');
  await enterSort(main); const client=await tab.context().newCDPSession(tab);
  const handle=a.locator('.catalog-sort-handle').first();await handle.scrollIntoViewIfNeeded();
  const from=await handle.boundingBox(),view=await scroll.boundingBox();
  await client.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:from.x+16,y:from.y+16}]});
  await client.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:from.x+16,y:view.y+view.height-8}]});
  await tab.waitForFunction(()=>document.querySelector('dialog[open] .popup-scroll-content').scrollTop>650);
  await client.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await main.getByText('已保存此分组内的顺序。',{exact:true}).waitFor();
  const moved=await order(a);assert.ok(moved.indexOf('long-0')>=4);
  await scroll.evaluate(el=>{el.scrollTop=0});
  const next=a.locator('.catalog-sort-handle').first();await next.scrollIntoViewIfNeeded();
  const pos=await next.boundingBox(),view2=await scroll.boundingBox();
  await client.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:pos.x+16,y:pos.y+16}]});
  await client.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:pos.x+16,y:view2.y+view2.height-8}]});
  await tab.waitForFunction(()=>document.querySelector('dialog[open] .popup-scroll-content').scrollTop>250);
  await client.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});
  const stopped=await scroll.evaluate(el=>el.scrollTop);
  await tab.waitForTimeout(150);
  assert.equal(await scroll.evaluate(el=>el.scrollTop),stopped);assert.deepEqual(await order(a),moved);await assertConnection();
},{hasTouch:true}));

for(const mode of ['st','tt'])test(mode+': failed reorder retains cards and permits retry',{timeout:60000},()=>withBrowser(mode,async({tab,open,stores,origin,flush})=>{
  seed(stores,origin);await open();const main=pane(tab,'API 管理器'),a=group(main,'A');
  await enterSort(main);
  await tab.evaluate(mode=>{
    const target=mode==='st'?SillyTavern.getContext():__TAURITAVERN__.api.extension.store;
    const key=mode==='st'?'saveSettingsDebounced':'setJson';
    const original=target[key];target[key]=()=>{throw Error('Fixture blocked write')};window.restoreWrite=()=>{target[key]=original};
  },mode);
  await a.locator('.catalog-sort-handle').first().press('ArrowDown');
  await main.getByText(/配置保存失败/).waitFor();assert.deepEqual(await order(a),['one','two','three']);
  await tab.evaluate(()=>restoreWrite());await a.locator('.catalog-sort-handle').first().press('ArrowDown');
  await main.getByText('已保存此分组内的顺序。',{exact:true}).waitFor();assert.deepEqual(await order(a),['two','one','three']);await flush();
}));
