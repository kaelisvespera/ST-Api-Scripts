// Host writes are reachable only from explicit Apply. The old generation
// hook remains opt-in and uses already-bound IDs from the applied pool.
function createCatalogConnection(host, context, storage) {
  const sources = {
    custom: { key: 'api_key_custom', field: 'custom_model', controls: ['#custom_model_id', '#model_custom_select'] },
    openai: { key: 'api_key_openai', field: 'openai_model', controls: ['#model_openai_select', '#openai_model'] },
    deepseek: { key: 'api_key_deepseek', field: 'deepseek_model', controls: ['#model_deepseek_select', '#deepseek_model'] },
    makersuite: { key: 'api_key_makersuite', field: 'google_model', controls: ['#model_google_select', '#google_model'] },
  };
  const saved = storage.connectionState;
  const bindings = Object.assign(Object.create(null), storage.legacyBindings, saved.bindings);
  const cursors = Object.assign(Object.create(null), saved.cursors);
  const ephemeral = new Map();
  let active = saved.active;
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
    return { rowId: row.id, id, digest };
  }
  function poolFor(row) {
    if (!row.rotationPoolId) return [row];
    const seen = new Set();
    const entries = storage.catalog.entries.filter(candidate => candidate.rotationPoolId === row.rotationPoolId &&
      candidate.source === row.source && candidate.url === row.url && candidate.model === row.model && candidate.site === row.site);
    const oldIndex = candidate => Number.isInteger(candidate.history?.index) ? candidate.history.index : Infinity;
    entries.sort((left, right) => oldIndex(left) - oldIndex(right));
    return entries.filter(candidate => {
      if (!candidate.key.trim() || seen.has(candidate.key)) return false;
      seen.add(candidate.key);
      return true;
    });
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
    const primary = await bind(provider, row);
    const pool = [];
    let incomplete = false;
    for (const candidate of poolFor(row)) {
      try { pool.push(candidate.key === row.key ? primary : await bind(provider, candidate)); }
      catch { incomplete = true; }
    }
    const known = await metadata(provider);
    if (!known.some(item => item.id === primary.id && item.active)) {
      await secret('rotate', { key: provider.key, id: primary.id });
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

    active = pool.length > 1 ? {
      rowId: row.id, poolId: row.rotationPoolId, site: row.site, source: row.source, url: row.url,
      model: row.model, keys: pool,
    } : null;
    appliedRowId = row.id;
    if (active && !Number.isInteger(cursors[active.poolId])) {
      cursors[active.poolId] = Number.isInteger(row.history?.currentKeyIndex) ? row.history.currentKeyIndex : 0;
    }
    let saved = true;
    try { await storage.setConnectionState({ bindings, active, appliedRowId, cursors }); }
    catch { saved = false; }
    const result = requested ? '已应用并发起原生连接。' : '配置已应用，可在酒馆连接页连接。';
    return result + (incomplete ? '部分轮换密钥尚未注册。' : '') + (saved ? '' : '本次轮换状态未能保存。');
  }

  function matchesRequest(row, payload) {
    return (payload.chat_completion_source ?? payload.chat_comletion_source) === row.source && payload.model === row.model &&
      (row.source !== 'custom' || (payload.custom_url ?? payload.customUrl)?.replace(/\/+$/, '') === row.url.replace(/\/+$/, ''));
  }
  async function recoverAppliedPool(payload) {
    // Before 2.2.1, the applied marker and cursor were part of the old catalog.
    // Recover only a uniquely identified pool whose exact keys are already
    // present in the host, and whose active secret agrees with this request.
    const matches = storage.catalog.entries.filter(row => row.rotationPoolId && row.history?.isActive &&
      row.history.enableKeyRotation && matchesRequest(row, payload));
    if (new Set(matches.map(row => row.rotationPoolId)).size !== 1) return;
    const row = matches[0];
    const provider = Object.hasOwn(sources, row.source) ? sources[row.source] : undefined;
    if (!provider) return;
    const candidates = poolFor(row);
    if (candidates.length < 2) return;
    const all = await metadata(provider);
    const keys = [];
    for (const candidate of candidates) {
      const digest = await fingerprint(provider, candidate.key);
      const stored = all.find(item => (digest && item.id === bindings[digest]) || item.value === candidate.key);
      if (!stored || !digest) return;
      keys.push({ rowId: candidate.id, id: stored.id, digest });
    }
    const primary = keys.find(key => all.some(secret => secret.id === key.id && secret.active));
    if (!primary) return;
    active = {
      rowId: primary.rowId, poolId: row.rotationPoolId, site: row.site, source: row.source, url: row.url,
      model: row.model, keys,
    };
    appliedRowId = primary.rowId;
    cursors[active.poolId] = row.history.currentKeyIndex;
  }
  async function rotate(payload) {
    if (!payload) return;
    if (!active && !appliedRowId) await recoverAppliedPool(payload);
    if (!active?.poolId || !Array.isArray(active.keys) || active.keys.length < 2 || !matchesRequest(active, payload)) return;
    const { source, url, model, site, poolId } = active;
    const provider = Object.hasOwn(sources, source) ? sources[source] : undefined;
    if (!provider) return;

    const currentRows = storage.catalog.entries.filter(row => row.rotationPoolId === poolId &&
      row.source === source && row.url === url && row.model === model && row.site === site);
    const keys = [];
    for (const item of active.keys) {
      const row = currentRows.find(candidate => candidate.id === item.rowId);
      if (!row) continue;
      const sameKey = item.digest ? await fingerprint(provider, row.key) === item.digest
        : ephemeral.get(localKey(provider, row.key)) === item.id;
      if (sameKey) keys.push(item);
    }
    if (keys.length < 2) return;
    const primary = keys.find(item => item.rowId === active.rowId);
    if (!primary) return;
    const all = await metadata(provider);
    if (!all.some(item => item.id === primary.id && item.active)) return;
    const valid = keys.filter(item => all.some(secret => secret.id === item.id));
    if (valid.length < 2) return;
    const cursor = cursors[poolId];
    const index = (Number.isInteger(cursor) && cursor >= 0 ? cursor : 0) % valid.length;
    payload.secret_id = valid[index].id;
    cursors[poolId] = (index + 1) % valid.length;
    try { await storage.setConnectionState({ bindings, active, appliedRowId, cursors }); }
    catch { /* Keep the in-memory cursor if host persistence is unavailable. */ }
  }
  const event = (context.eventTypes ?? context.event_types)?.CHAT_COMPLETION_SETTINGS_READY;
  if (event) {
    const events = context.eventSource;
    const register = events?.makeFirst ?? events?.on;
    register?.call(events, event, payload => serial(() => rotate(payload)).catch(() => {}));
  }
  return { apply: row => serial(() => apply(row)), activeRowId: () => appliedRowId };
}

