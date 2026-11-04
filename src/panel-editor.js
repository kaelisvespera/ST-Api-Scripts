// The old editor groups a site's credentials and models in one dialog. The
// draft tracks model rows per credential so saving cannot combine their IDs.
function openCatalogEditor(ui, rows, afterSave) {
  const { host, storage, popup, make, button, fieldInput, closeButton, save, run, refresh, groupColor } = ui;
  const original = rows[0];
  const pane = popup(original ? '编辑 API 配置' : '添加 API 配置', 'large');
  const form = make('form', 'st-native-api-form');
  form.id = 'st-api-manager-edit-form';
  const field = (label, control, hint) => {
    const wrap = make('div', 'st-native-form-group');
    const title = make('div', 'st-native-form-label', label);
    if (control.required) title.append(make('span', 'required-mark', ' *'));
    wrap.append(title, control);
    if (hint) wrap.append(make('div', 'st-native-hint', hint));
    form.append(wrap);
    return wrap;
  };
  const site = fieldInput(original?.site ?? '', '配置组名称', {
    required: true, placeholder: '输入配置组名称（用于标识此 URL 和密钥）',
  });
  field('配置组名称', site, '新配置名称默认为 [配置组名称] [模型名]。');
  const source = make('select', 'st-orb-select');
  source.setAttribute('aria-label', '聊天补全来源');
  const sources = [
    ['openai', 'OpenAI'], ['custom', '自定义（兼容 OpenAI）'], ['ai21', 'AI21'], ['aimlapi', 'AI/ML API'],
    ['azure', 'Azure OpenAI'], ['claude', 'Claude'], ['cohere', 'Cohere'], ['deepseek', 'DeepSeek'],
    ['electronhub', 'Electron Hub'], ['fireworks', 'Fireworks AI'], ['groq', 'Groq'], ['makersuite', 'Google AI Studio'],
    ['vertexai', 'Google Vertex AI'], ['mistralai', 'MistralAI'], ['moonshot', 'Moonshot AI'], ['nanogpt', 'NanoGPT'],
    ['openrouter', 'OpenRouter'], ['perplexity', 'Perplexity'], ['pollinations', 'Pollinations'], ['submodel', 'SubModel'],
    ['xai', 'xAI (Grok)'],
  ];
  if (original && !sources.some(([id]) => id === original.source)) sources.push([original.source, original.source]);
  for (const [value, name] of sources) {
    const option = make('option', '', name);
    option.value = value;
    source.append(option);
  }
  source.value = original?.source ?? 'custom';
  field('聊天补全来源', source);
  const url = fieldInput(original?.url ?? '', '站点 URL', {
    placeholder: '例如：http://localhost:1234/v1', inputMode: 'url', spellcheck: false,
  });
  field('自定义端点（基础 URL）', url, '可填写基础 URL，拉取模型时会自动处理 /v1 和 /chat/completions 后缀。');
  const note = rows.length === 1 ? fieldInput(original.name, '条目备注（可选）') : null;
  if (note) field('条目备注（可选）', note);

  const drafts = [];
  const draftByKey = new Map();
  const savedKeyNotes = new Map((storage.catalog.keyNotes ?? []).map(note => [note.id, note.note]));
  for (const row of rows) {
    const ref = credentialRef(row);
    if (!draftByKey.has(ref)) {
      const draft = { original: row, key: row.key, note: savedKeyNotes.get(row.credentialId) ?? '', models: [], available: [], result: '' };
      draftByKey.set(ref, draft);
      drafts.push(draft);
    }
    draftByKey.get(ref).models.push({ row, model: row.model, note: row.modelNote ?? '', groupIds: [...row.groupIds] });
  }
  let selected;
  const current = () => selected ?? drafts[0];
  const modelDraft = model => ({ model, note: '', groupIds: [] });
  function noteField(label, value, hint, setValue) {
    const field = make('label', 'catalog-note-field');
    const input = make('textarea', 'text_pole');
    input.rows = 2;
    input.value = value;
    input.placeholder = hint;
    input.addEventListener('input', () => setValue(input.value));
    field.append(make('span', '', label), input);
    return field;
  }
  const keys = make('div', 'st-native-keys-section');
  const addRow = make('div', 'key-add-row api-config-edit-modal__key-add-row');
  const addInput = fieldInput('', '输入 API Key', { type: 'password', placeholder: '输入 API Key', spellcheck: false });
  addInput.classList.add('key-add-input');
  const pasteBox = make('div', 'key-paste-modal');
  pasteBox.hidden = true;
  const paste = make('textarea', 'text_pole key-paste-modal__textarea');
  paste.setAttribute('aria-label', '每行一个 API Key');
  paste.placeholder = '每行一个 API Key';
  const keyList = make('div', 'api-config-edit-modal__keys-list');
  const keyActions = make('div', 'api-config-edit-modal__batch-actions');
  const keyActionRow = make('div', 'key-batch-actions-row st-native-actions');
  const diagnostic = button('检测', () => checkKeys(), 'vials');
  const removeAll = button('一键移除', () => {
    if (host.confirm('移除表单中的全部密钥和对应模型？保存后才会生效。')) {
      drafts.length = 0;
      selected = undefined;
      render();
    }
  }, 'trash');
  keyActionRow.append(diagnostic, removeAll);
  keyActions.append(keyActionRow);
  const addDraft = key => {
    let draft = drafts.find(item => item.key === key);
    if (!draft) {
      draft = { key, note: '', models: [], available: [], result: '' };
      drafts.push(draft);
    }
    return draft;
  };
  function incorporateKey() {
    if (addInput.value) {
      const draft = addDraft(addInput.value);
      addInput.value = '';
      return draft;
    }
    return current();
  }
  const addKey = button('添加Key', () => {
    if (!addInput.value) return;
    incorporateKey();
    render();
  }, 'plus');
  addKey.classList.add('api-config-edit-modal__add-key-button');
  addInput.addEventListener('keydown', event => {
    if (event.key === 'Enter') { event.preventDefault(); addKey.click(); }
  });
  const pasteButton = button('粘贴多行Key', () => { pasteBox.hidden = !pasteBox.hidden; if (!pasteBox.hidden) paste.focus(); }, 'paste');
  pasteButton.classList.add('api-config-edit-modal__paste-toggle');
  pasteBox.append(paste, button('批量添加', () => {
    for (const key of labels(paste.value.split(/\r?\n/).map(value => value.trim()))) addDraft(key);
    paste.value = '';
    pasteBox.hidden = true;
    render();
  }, 'plus'));
  addRow.append(addInput, addKey, pasteButton);
  keys.append(addRow, pasteBox, keyList, keyActions);
  field('API 密钥列表', keys);

  const endpoint = key => ({
    source: source.value, url: original && url.value === original.url ? original.url : url.value.trim(), key,
  });
  async function checkKeys() {
    if (!drafts.length) {
      pane.status.textContent = '请先添加 API 密钥。';
      return;
    }
    await run(pane, async () => {
      for (const draft of drafts) await checkKey(draft);
      return '已检测表单中的密钥。';
    }, undefined, render);
  }
  async function checkKey(draft) {
    if (!draft.key.trim()) {
      draft.result = '请填写密钥。';
      return;
    }
    try {
      const models = await discoverModels(endpoint(draft.key), host.fetch.bind(host));
      draft.result = '可读取 ' + models.length + ' 个模型';
    } catch (error) {
      draft.result = error.message;
    }
  }
  const discovery = make('div', 'st-native-actions');
  const pullKey = make('select', 'st-orb-select st-orb-select-auto');
  pullKey.setAttribute('aria-label', '拉取使用的密钥');
  pullKey.addEventListener('change', () => {
    selected = pullKey.value === '' ? undefined : drafts[Number(pullKey.value)];
    modelSearch.value = '';
    render();
  });
  const pull = button('拉取模型', async () => {
    const draft = current();
    if (!draft?.key.trim()) {
      pane.status.textContent = draft ? '当前选中的密钥为空，请填写密钥。' : '请先添加 API 密钥。';
      return;
    }
    if (draft.request) return;
    const parameters = endpoint(draft.key);
    const request = {};
    draft.request = request;
    draft.discoveryStatus = '正在拉取模型…';
    renderModels();
    try {
      const models = await discoverModels(parameters, host.fetch.bind(host));
      if (draft.request !== request || !drafts.includes(draft)) return;
      draft.available = models;
      draft.discoveryStatus = models.length ? '已拉取 ' + models.length + ' 个模型，选择后再保存。'
        : '站点没有返回模型，可以手动填写。';
    } catch (error) {
      if (draft.request !== request || !drafts.includes(draft)) return;
      draft.discoveryStatus = error.message;
    } finally {
      if (draft.request === request) draft.request = null;
      if (pane.dialog.open && current() === draft) renderModels();
    }
  }, 'download');
  const testResult = make('div', 'st-native-test-result');
  testResult.hidden = true;
  const testModel = draft => draft?.models.find(item => item.model.trim())?.model;
  function renderTestResult() {
    const draft = current();
    const result = draft?.testResult;
    const text = result?.model === testModel(draft) ? result?.text : '';
    testResult.textContent = text ?? '';
    testResult.hidden = !text;
  }
  const testMessage = button('发送测试消息', () => {
    const draft = current();
    const model = testModel(draft);
    if (!draft?.key.trim() || !model) {
      pane.status.textContent = '请先选定密钥和模型。';
      return;
    }
    const config = { ...endpoint(draft.key), model };
    draft.testResult = null;
    renderTestResult();
    run(pane, async () => {
      draft.testResult = { model, text: await sendCatalogTest(config, host.fetch.bind(host)) };
      renderTestResult();
      return '已收到测试消息回复。';
    });
  }, 'paper-plane');
  discovery.append(pullKey, pull, testMessage);
  form.append(discovery, testResult);

  const modelSection = make('div', 'st-native-models-section');
  const modelTarget = make('div', 'st-native-hint');
  const manualRow = make('div', 'manual-model-row');
  const manual = fieldInput('', '手动输入模型 ID', { placeholder: '手动输入模型 ID' });
  function addManual() {
    const value = manual.value.trim();
    if (!value) return;
    const draft = current();
    if (!draft) {
      pane.status.textContent = '请先添加 API 密钥。';
      return;
    }
    if (!draft.models.some(item => item.model === value)) draft.models.push(modelDraft(value));
    manual.value = '';
    render();
  }
  manualRow.append(manual, button('添加模型', addManual, 'plus'));
  manual.addEventListener('keydown', event => {
    if (event.key === 'Enter') { event.preventDefault(); addManual(); }
  });
  const available = make('div', 'st-native-models-list');
  const modelSearch = fieldInput('', '搜索模型', { type: 'search', placeholder: '搜索模型 ID' });
  const searchWrap = make('div', 'st-native-model-search');
  searchWrap.append(modelSearch);
  const selectedBox = make('div', 'st-native-selected-models');
  const selectVisible = button('全选当前模型', () => {
    const draft = current();
    if (!draft) return;
    for (const model of availableModels()) {
      if (!draft.models.some(item => item.model === model)) draft.models.push(modelDraft(model));
    }
    renderModels();
  });
  searchWrap.append(selectVisible);
  modelSection.append(modelTarget, searchWrap, available, selectedBox, manualRow);
  field('模型列表', modelSection);
  modelSearch.addEventListener('input', renderAvailable);
  function availableModels() {
    const query = modelSearch.value.trim().toLowerCase();
    return (current()?.available ?? []).filter(model => model.toLowerCase().includes(query));
  }
  function renderAvailable() {
    const draft = current();
    available.replaceChildren();
    searchWrap.hidden = !draft?.available.length;
    available.hidden = searchWrap.hidden;
    for (const model of availableModels()) {
      const row = make('label', 'st-native-model-item checkbox_label');
      const input = make('input');
      input.type = 'checkbox';
      input.checked = draft.models.some(item => item.model === model);
      input.addEventListener('change', () => {
        if (input.checked) draft.models.push(modelDraft(model));
        else draft.models = draft.models.filter(item => item.model !== model);
        renderModels();
      });
      row.append(input, make('span', '', model));
      available.append(row);
    }
  }
  function renderModels() {
    const draft = current();
    pull.disabled = !!draft?.request;
    if (draft) pane.status.textContent = draft.discoveryStatus ?? '';
    modelTarget.textContent = draft
      ? '正在管理第 ' + (drafts.indexOf(draft) + 1) + ' 个密钥的模型'
      : '输入密钥后可拉取模型，也可手动输入模型 ID。';
    selectedBox.replaceChildren();
    const items = draft?.models ?? [];
    const header = make('div', 'selected-header', '已选择 ' + items.length + ' 个模型');
    const list = make('div', 'selected-list');
    for (const item of items) {
      const chip = make('div', 'selected-item');
      const model = fieldInput(item.model, items.length === 1 ? '模型' : '已选模型 ID', { placeholder: '未指定模型' });
      model.className = 'text_pole model-name';
      model.addEventListener('input', () => { item.model = model.value; renderAvailable(); renderTestResult(); });
      model.addEventListener('keydown', event => { if (event.key === 'Enter') event.preventDefault(); });
      const remove = button('移除模型', () => {
        draft.models = draft.models.filter(value => value !== item);
        renderModels();
      }, 'xmark', true);
      remove.classList.add('remove-btn');
      chip.append(model, remove, noteField('模型备注', item.note, '例如 0.5/次', value => { item.note = value; }));
      if (storage.catalog.groups.length) {
        const tags = make('details', 'catalog-model-tags');
        tags.open = !!item.showTags;
        tags.addEventListener('toggle', () => { item.showTags = tags.open; });
        const summary = make('summary', '', '分组' + (item.groupIds.length ? ' (' + item.groupIds.length + ')' : ''));
        const grid = make('div', 'category-tag-grid');
        for (const group of storage.catalog.groups) {
          const label = make('label', 'category-tag menu_button menu_button_icon');
          const control = make('input');
          control.type = 'checkbox';
          control.checked = item.groupIds.includes(group.id);
          control.addEventListener('change', () => {
            item.groupIds = control.checked ? labels([...item.groupIds, group.id]) : item.groupIds.filter(id => id !== group.id);
            summary.textContent = '分组' + (item.groupIds.length ? ' (' + item.groupIds.length + ')' : '');
          });
          const dot = make('span', 'category-color-dot');
          dot.style.backgroundColor = groupColor(group);
          label.append(control, dot, make('span', 'category-tag-name', group.name));
          grid.append(label);
        }
        tags.append(summary, grid);
        chip.append(tags);
      }
      list.append(chip);
    }
    selectedBox.hidden = !items.length;
    selectedBox.append(header, list);
    renderAvailable();
    renderTestResult();
  }
  function render() {
    keyList.replaceChildren();
    const defaultChoice = make('option', '', '默认使用第一把 Key');
    defaultChoice.value = '';
    pullKey.replaceChildren(defaultChoice);
    pullKey.hidden = drafts.length < 2;
    drafts.forEach((draft, index) => {
      const option = make('option', '', '第 ' + (index + 1) + ' 个密钥');
      option.value = String(index);
      pullKey.append(option);
      const row = make('div', 'st-native-key-item');
      const details = make('div', 'key-info');
      const label = '第 ' + (index + 1) + ' 个密钥';
      const input = fieldInput(draft.key, drafts.length === 1 ? 'API 密钥' : label, { type: 'password', spellcheck: false });
      input.addEventListener('input', () => {
        draft.key = input.value;
        resetDiscovery(draft);
        draft.result = '';
        if (current() === draft) renderModels();
      });
      input.addEventListener('keydown', event => { if (event.key === 'Enter') event.preventDefault(); });
      const choose = button('管理' + label + '的模型', () => {
        selected = draft;
        modelSearch.value = '';
        render();
      }, 'list', true);
      choose.setAttribute('aria-pressed', String(current() === draft));
      choose.classList.toggle('catalog-key-selected', current() === draft);
      const reveal = button('显示或隐藏密钥', () => { input.type = input.type === 'password' ? 'text' : 'password'; }, 'eye', true);
      const testKey = button('检测此密钥', () => run(pane, () => checkKey(draft), undefined, render), 'heart-pulse', true);
      const remove = button('移除密钥', () => {
        drafts.splice(index, 1);
        if (selected === draft) selected = undefined;
        render();
      }, 'trash', true);
      details.append(input);
      if (draft.result) details.append(make('small', 'key-test-result', draft.result));
      const actions = make('div', 'api-config-edit-modal__key-actions');
      actions.append(choose, testKey, reveal, remove);
      row.append(details, actions, noteField('密钥备注', draft.note, '例如 CCMAX', value => { draft.note = value; }));
      keyList.append(row);
    });
    pullKey.value = selected ? String(drafts.indexOf(selected)) : '';
    removeAll.disabled = !drafts.length;
    renderModels();
  }
  function resetDiscovery(draft) {
    draft.request = null;
    draft.available = [];
    draft.discoveryStatus = '';
    draft.testResult = null;
  }
  function clearDiscovery() {
    for (const draft of drafts) resetDiscovery(draft);
    renderModels();
  }
  source.addEventListener('change', clearDiscovery);
  url.addEventListener('input', clearDiscovery);

  if (rows.length === 1 && original.history) {
    const history = make('details', 'st-native-hint');
    history.append(make('summary', '', '旧密钥池记录'), make('p', '',
      '原密钥位置 ' + (original.history.index + 1) + ' / ' + original.history.poolSize +
      '，历史成功 ' + (original.history.keyHistory?.successCount ?? '—') +
      '，历史失败 ' + (original.history.keyHistory?.failureCount ?? '—')));
    form.append(history);
  }
  form.addEventListener('submit', event => {
    event.preventDefault();
    const existingIds = new Set(rows.map(row => row.id));
    save(pane, catalog => {
      if (!site.value.trim()) throw new Error('请填写配置组名称。');
      if (addInput.value) incorporateKey();
      if (!drafts.length && !original) addDraft('');
      if (!drafts.length) throw new Error('请至少保留一个密钥栏，或从配置组列表删除该组。');
      const changed = new Map();
      const added = [];
      const keyNotes = new Map((catalog.keyNotes ?? []).map(note => [note.id, note]));
      const linkedScopes = new Map();
      for (const draft of drafts) {
        const fields = { ...endpoint(draft.key), site: site.value.trim() };
        if ((!original || fields.url !== original.url || fields.source !== original.source) &&
            (fields.url || fields.source === 'custom')) endpointUrl(fields.url);
        const scope = credentialScope(fields);
        const unchangedScope = draft.original && scope === credentialScope(draft.original);
        const oldId = draft.original?.credentialId;
        const keyNote = draft.note.trim();
        const credentialId = unchangedScope && oldId ? oldId : oldId || keyNote ? makeId() : undefined;
        if (credentialId) {
          keyNotes.set(credentialId, { ...keyNotes.get(credentialId), id: credentialId, note: keyNote });
          if (unchangedScope && !oldId) linkedScopes.set(scope, credentialId);
        }
        const models = draft.models.length ? draft.models : [modelDraft('')];
        for (const item of models) {
          const model = item.row && item.model === item.row.model ? item.model : item.model.trim();
          const row = {
            ...item.row, ...fields, id: item.row?.id ?? makeId(), model,
            name: note && item.row ? note.value.trim() : item.row?.name ?? '',
            groupIds: item.groupIds,
          };
          if (credentialId) row.credentialId = credentialId;
          const modelNote = item.note.trim();
          if (modelNote || Object.hasOwn(row, 'modelNote')) row.modelNote = modelNote;
          if (item.row) changed.set(row.id, row);
          else added.push(row);
        }
      }
      return {
        ...catalog,
        keyNotes: [...keyNotes.values()],
        entries: catalog.entries.flatMap(row => {
          if (existingIds.has(row.id)) return changed.has(row.id) ? [changed.get(row.id)] : [];
          const credentialId = !row.credentialId && linkedScopes.get(credentialScope(row));
          return [credentialId ? { ...row, credentialId } : row];
        }).concat(added),
      };
    }, '已保存配置。', () => {
      refresh();
      pane.dialog.close();
      afterSave?.();
    });
  });
  pane.scroll.append(form);
  const submit = button('保存', undefined, 'floppy-disk');
  submit.type = 'submit';
  submit.setAttribute('form', form.id);
  pane.footer.append(closeButton(pane, '取消'), submit);
  render();
  pane.open();
}

