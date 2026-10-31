// Full native bundle in a real browser with local host/API fixtures.
// jQuery fixture is the MIT-licensed version shipped by SillyTavern.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const prefix = '/scripts/extensions/third-party/ST-Api-Scripts/';
const fixtureConfig = {
  name: '保存的模型', source: 'custom', customUrl: 'https://fixture.invalid/v1',
  customModel: 'saved-model', groupName: '原有站点', groupKey: '原有站点::https://fixture.invalid/v1',
  apiKeys: [{ id: 'first', key: 'synthetic-first-key' }, { id: 'second', key: 'synthetic-second-key' }],
  currentKeyIndex: 0, enableKeyRotation: true, isActive: false, categoryIds: [],
};
const initialState = () => ({ version: 1, values: { api_configs_manager: JSON.stringify([fixtureConfig]) } });

function hostPage(mode) {
  return `<!doctype html><html><head><style id="host-sentinel">body{font:16px sans-serif}</style>
    <script src="/jquery.js"></script></head><body><div id="extensionsMenu"></div>
    <div id="native-controls" hidden>
    <select id="main_api"><option value="openai">openai</option></select>
    <select id="chat_completion_source"><option value="custom">custom</option></select>
    <input id="custom_api_url_text"><input id="api_key_custom"><input id="custom_model_id" value="old-model">
    <select id="model_custom_select"><option>old-model</option></select><button id="api_button_openai">connect</button></div>
    <script>
    window.toasts=[];
    window.toastr=Object.fromEntries(['success','info','warning','error'].map(type=>[type,(message)=>toasts.push({type,message})]));
    window.statuses=[];
    const listeners=new Map();
    window.context={
      mainApi:'openai', extensionSettings:${JSON.stringify({ 'st-api-manager': initialState() })},
      chatCompletionSettings:{chat_completion_source:'custom',custom_model:'old-model',custom_url:'',openai_max_tokens:4096,temp_openai:0.7},
      eventTypes:{CHAT_COMPLETION_SETTINGS_READY:'settings-ready'},
      eventSource:{
        makeFirst(event,listener){const all=listeners.get(event)||[];all.unshift(listener);listeners.set(event,all)},
        removeListener(event,listener){listeners.set(event,(listeners.get(event)||[]).filter(item=>item!==listener))},
        async emit(event,payload){for(const listener of listeners.get(event)||[])await listener(payload)},
      },
      saveSettingsDebounced(){window.settingsSaves=(window.settingsSaves||0)+1},
      getRequestHeaders:()=>({'Content-Type':'application/json'}),
      registerSlashCommand(){}, Popup:{show:{}},POPUP_RESULT:{AFFIRMATIVE:1},
    };
    window.SillyTavern={getContext:()=>context};
    if(${JSON.stringify(mode)}==='tt')window.__TAURITAVERN__={ready:Promise.resolve(),api:{extension:{store:{
      async tryGetJson(){const value=await(await fetch('/fixture-store')).json();return{found:true,value}},
      async setJson({value}){await fetch('/fixture-store',{method:'POST',body:JSON.stringify(value)})},
    }}}};
    $('#custom_model_id').on('input',function(){context.chatCompletionSettings.custom_model=this.value});
    $('#model_custom_select').on('change',async function(){
      const model=this.value;await Promise.resolve();context.chatCompletionSettings.custom_model=model;$('#custom_model_id').val(model);
    });
    $('#chat_completion_source').on('change',function(){
      context.chatCompletionSettings.chat_completion_source=this.value;$('#model_custom_select').trigger('change');$('#api_button_openai').trigger('click');
    });
    $('#api_button_openai').on('click',async function(){
      const secrets=await(await fetch('/api/secrets/read',{method:'POST'})).json();
      const current=secrets.api_key_custom.find(item=>item.active);
      statuses.push({model:context.chatCompletionSettings.custom_model,secret_id:current?.id,url:context.chatCompletionSettings.custom_url});
    });
    </script><script type="module">
    const base=${JSON.stringify(prefix)};
    const manifest=await(await fetch(base+'manifest.json')).json();
    try{window.apiManager=await import(base+manifest.js);window.moduleLoaded=true;}
    catch(error){window.moduleError=error.stack;throw error;}
    </script></body></html>`;
}

test('native extension opens, applies once, preserves TT data and runs without Tavern Helper', async () => {
  let state = initialState();
  const secrets = [{ id: 'existing', value: 'synthetic-existing-key', active: true }];
  const generated = [], loadedModules = [];
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, 'http://localhost');
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined;
    response.setHeader('content-type', 'application/json');
    if (url.pathname === '/fixture-store') {
      if (body) state = body;
      return response.end(JSON.stringify(state));
    }
    if (url.pathname === '/api/secrets/read') return response.end(JSON.stringify({ api_key_custom: secrets.map(({ value, ...meta }) => meta) }));
    if (url.pathname === '/api/secrets/write') {
      for (const item of secrets) item.active = false;
      const id = 'fixture-' + secrets.length;
      secrets.push({ id, value: body.value, active: true });
      return response.end(JSON.stringify({ id }));
    }
    if (url.pathname === '/api/secrets/rotate') {
      for (const item of secrets) item.active = item.id === body.id;
      return response.end('{}');
    }
    if (url.pathname === '/api/backends/chat-completions/generate') {
      generated.push({ ...body, selectedKey: secrets.find(item => item.id === body.secret_id)?.value });
      return response.end(JSON.stringify({ choices: [{ message: { content: '连接成功' } }] }));
    }
    let content;
    if (url.pathname === '/') {
      response.setHeader('content-type', 'text/html; charset=utf-8');
      content = hostPage(url.searchParams.get('host') || 'tt');
    } else if (url.pathname === '/jquery.js') {
      response.setHeader('content-type', 'text/javascript');
      content = fs.readFileSync(path.join(__dirname, 'fixtures/jquery-3.5.1.min.js'));
    } else if (url.pathname === prefix + 'manifest.json') {
      content = fs.readFileSync(path.join(root, 'manifest.json'));
    } else if (url.pathname === prefix + 'index.js') {
      loadedModules.push(url.pathname);
      response.setHeader('content-type', 'text/javascript');
      content = fs.readFileSync(path.join(root, 'index.js'));
    } else if (url.pathname === prefix + 'vendor/vue-3.5.22.runtime.esm-browser.prod.js') {
      response.setHeader('content-type', 'text/javascript');
      content = fs.readFileSync(path.join(root, 'vendor/vue-3.5.22.runtime.esm-browser.prod.js'));
    } else if (url.pathname === prefix + 'vendor/zod-3.23.8.mjs') {
      response.setHeader('content-type', 'text/javascript');
      content = fs.readFileSync(path.join(root, 'vendor/zod-3.23.8.mjs'));
    } else if (url.pathname === '/scripts/secrets.js') {
      response.setHeader('content-type', 'text/javascript');
      content = "export async function readSecretState(){context.nativeSecretState=await(await window.fetch('/api/secrets/read',{method:'POST'})).json()}";
    } else {
      response.statusCode = 404;
      content = '{}';
    }
    response.end(content);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const url = `http://127.0.0.1:${server.address().port}/`;
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.moduleLoaded || window.moduleError);
    assert.equal(await page.evaluate(() => window.moduleError), undefined);
    await page.locator('#st-api-manager-extension-button').click();
    await page.getByText('保存的模型', { exact: true }).waitFor();
    assert.equal(await page.locator('iframe').count(), 0);
    assert.equal(await page.evaluate(() => typeof window.TavernHelper), 'undefined');
    assert.equal(await page.locator('#host-sentinel').count(), 1, 'native UI must not clone host styles');
    await page.locator('button[title="应用"]').first().click();
    await page.waitForFunction(() => window.statuses.length === 1 && context.chatCompletionSettings.custom_model === 'saved-model');
    assert.deepEqual(await page.evaluate(() => ({ model: context.chatCompletionSettings.custom_model, input: $('#custom_model_id').val(), dropdown: $('#model_custom_select').val() })),
      { model: 'saved-model', input: 'saved-model', dropdown: 'saved-model' });
    assert.equal(secrets.find(item => item.active).value, 'synthetic-first-key');

    const result = await page.evaluate(async () => {
      const value = await apiManager.sendTestMessage({ url: 'https://test.invalid/v1', key: 'synthetic-test-key', source: 'custom', model: 'test-model' });
      const payload = { chat_completion_source: 'custom', custom_url: 'https://fixture.invalid/v1' };
      await context.eventSource.emit('settings-ready', payload);
      await apiManager.flushTauriTavernStorage();
      return { value, payload };
    });
    assert.equal(result.value, '连接成功');
    assert.equal(generated.length, 1);
    assert.equal(generated[0].model, 'test-model');
    assert.equal(generated[0].custom_url, 'https://test.invalid/v1');
    assert.equal(generated[0].selectedKey, 'synthetic-test-key');
    assert.equal(generated[0].max_tokens, 4096);
    assert.equal(secrets.find(item => item.active).value, 'synthetic-first-key', 'test and rotation registration preserve the active key');
    assert.equal(secrets.find(item => item.id === result.payload.secret_id).value, 'synthetic-first-key');
    const savedConfigs = JSON.parse(state.values.api_configs_manager);
    assert.equal(savedConfigs.groups.length, 1);
    assert.equal(savedConfigs.groups[0].models[0].currentKeyIndex, 1, 'generation hook advances the next key');

    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.moduleLoaded);
    await page.locator('#st-api-manager-extension-button').click();
    await page.getByText('保存的模型', { exact: true }).waitFor();
    await page.goto(url + '?host=st', { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.moduleLoaded);
    await page.locator('#st-api-manager-extension-button').click();
    await page.getByText('保存的模型', { exact: true }).waitFor();
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.locator('.st-api-manager').count() > 0, true);
    assert.deepEqual(errors, []);
    assert.equal(loadedModules.length, 3);
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
});
