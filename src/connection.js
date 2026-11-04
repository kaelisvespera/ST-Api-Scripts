// Host writes are reachable only from explicit Apply.
function createCatalogConnection(host, context, storage) {
  const sources = {
    custom: { key: 'api_key_custom', field: 'custom_model', controls: ['#custom_model_id', '#model_custom_select'] },
    openai: { key: 'api_key_openai', field: 'openai_model', controls: ['#model_openai_select', '#openai_model'] },
    deepseek: { key: 'api_key_deepseek', field: 'deepseek_model', controls: ['#model_deepseek_select', '#deepseek_model'] },
    makersuite: { key: 'api_key_makersuite', field: 'google_model', controls: ['#model_google_select', '#google_model'] },
  };
  const saved = storage.connectionState;
  const bindings = Object.assign(Object.create(null), storage.legacyBindings, saved.bindings);
  const ephemeral = new Map();
  let appliedRowId = saved.appliedRowId;
  let queue = Promise.resolve();
  const serial = action => {
    queue = queue.catch(() => {}).then(action);
    return queue;
  };
  const doc = host.document;
  const $ = selector => doc.querySelector(selector);
  function change(element) {
    if (typeof host.$ === 'function') host.$(element).trigger('change');
    else element.dispatchEvent(new host.Event('change', { bubbles: true }));
  }
  function setModel(element, value) {
    if (!element) return;
    if (element.tagName === 'SELECT' && ![...element.options].some(option => option.value === value)) {
      const option = doc.createElement('option');
      option.value = value;
      option.textContent = value;
      element.append(option);
    }
    element.value = value;
    change(element);
  }
  async function secret(action, body) {
    const response = await host.fetch('/api/secrets/' + action, {
      method: 'POST', headers: context.getRequestHeaders?.() ?? { 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok) throw new Error('宿主密钥操作失败（HTTP ' + response.status + '）');
    return action === 'rotate' ? undefined : response.json();
  }
  async function fingerprint(provider, key) {
    if (!host.crypto?.subtle) return null;
    const digest = await host.crypto.subtle.digest('SHA-256', new TextEncoder().encode(provider.key + '\0' + key));
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  }
  const localKey = (provider, key) => provider.key + '\0' + key;
  async function metadata(provider) {
    const state = await secret('read');
    return Array.isArray(state[provider.key]) ? state[provider.key] : [];
  }
  async function bind(provider, row) {
    const digest = await fingerprint(provider, row.key);
    const cached = digest ? bindings[digest] : ephemeral.get(localKey(provider, row.key));
    const all = await metadata(provider);
    const match = all.find(item => cached && item.id === cached) || all.find(item => item.value === row.key);
    const id = match?.id ?? (await secret('write', { key: provider.key, value: row.key, label: 'ST-ApiManager: ' + row.site })).id;
    if (!id) throw new Error('宿主未返回已保存的密钥 ID。');
    if (digest) bindings[digest] = id;
    else ephemeral.set(localKey(provider, row.key), id);
    return id;
  }
  async function apply(row) {
    const provider = Object.hasOwn(sources, row.source) ? sources[row.source] : undefined;
    if (!provider) throw new Error('当前酒馆适配暂不支持应用此来源，请在酒馆原生连接页配置。');
    if (!row.key.trim()) throw new Error('这条配置没有密钥，请先填写，以免误用酒馆里已有的密钥。');
    if (!row.model.trim()) throw new Error('这条配置没有模型，请先选择或填写模型。');
    if (row.source === 'custom') endpointUrl(row.url);
    const settings = context.chatCompletionSettings;
    const api = $('#main_api');
    const source = $('#chat_completion_source');
    const connect = $('#api_button_openai');
    if (!settings || typeof context.saveSettingsDebounced !== 'function' ||
        (!source && !connect) || (!api && context.mainApi !== 'openai')) {
      throw new Error('未找到酒馆的聊天补全设置或连接入口。');
    }
    if (source?.tagName === 'SELECT' && ![...source.options].some(option => option.value === row.source)) {
      throw new Error('此宿主的连接页没有所选聊天补全来源。');
    }
    const id = await bind(provider, row);
    const known = await metadata(provider);
    if (!known.some(item => item.id === id && item.active)) {
      await secret('rotate', { key: provider.key, id });
    }
    if (!host.__TAURITAVERN__) {
      const { readSecretState } = await import('/scripts/secrets.js');
      await readSecretState();
    }

    const sync = () => {
      settings.chat_completion_source = row.source;
      settings[provider.field] = row.model;
      if (row.source === 'custom') {
        settings.custom_url = row.url;
        settings.custom_api_format = 'openai_compat';
        const endpoint = $('#custom_api_url_text');
        if (endpoint) endpoint.value = row.url;
      }
      for (const selector of provider.controls) setModel($(selector), row.model);
      const keyInput = $('#' + provider.key);
      if (keyInput) keyInput.value = '';
    };
    if (source) source.value = row.source;
    sync();
    if (api && api.value !== 'openai') {
      api.value = 'openai';
      change(api);
    }
    let requested = false;
    if (!connect?.disabled) {
      if (source) {
        change(source);
        if (source.value !== row.source) throw new Error('宿主没有接受该聊天补全来源。');
        sync();
        requested = true;
      } else if (connect) {
        connect.click();
        requested = true;
      }
    }
    context.saveSettingsDebounced();

    appliedRowId = row.id;
    let saved = true;
    try { await storage.setConnectionState({ bindings, appliedRowId }); }
    catch { saved = false; }
    const result = requested ? '已应用并发起原生连接。' : '配置已应用，可在酒馆连接页连接。';
    return result + (saved ? '' : '本次应用状态未能保存。');
  }
  return { apply: row => serial(() => apply(row)), activeRowId: () => appliedRowId };
}

