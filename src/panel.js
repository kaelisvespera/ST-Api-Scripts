function mountCatalogPanel(host, storage) {
  const doc = host.document;
  function node(tag, text, attributes = {}) {
    const element = doc.createElement(tag);
    if (text !== undefined) element.textContent = text;
    for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
    return element;
  }
  const button = (text, click) => {
    const element = node('button', text, { type: 'button', class: 'menu_button' });
    element.addEventListener('click', click);
    return element;
  };
  const dialog = node('dialog', undefined, { class: 'st-api-manager', 'aria-label': 'API 管理器' });
  const heading = node('header');
  const body = node('section');
  const status = node('p', '', { role: 'status' });
  dialog.append(heading, status, body);
  const style = node('style', `
.st-api-manager{width:min(48rem,calc(100% - 1.5rem));max-height:calc(100% - 1.5rem);box-sizing:border-box;
 color:var(--SmartThemeBodyColor,#f1f1f1);background:var(--SmartThemeBlurTintColor,#26272a);
 border:1px solid var(--SmartThemeBorderColor,#999);border-radius:.65rem;padding:1rem;overflow:auto}
.st-api-manager::backdrop{background:#0009}
.st-api-manager header,.st-api-manager .actions{display:flex;align-items:center;gap:.5rem;flex-wrap:wrap}
.st-api-manager header h2{margin:.25rem auto .25rem 0}
.st-api-manager input,.st-api-manager select,.st-api-manager textarea{font:inherit;max-width:100%;box-sizing:border-box}
.st-api-manager label.field{display:grid;gap:.3rem;margin:.55rem 0}
.st-api-manager article{border-top:1px solid var(--SmartThemeBorderColor,#999);padding:.65rem 0;overflow-wrap:anywhere}
.st-api-manager article p,.st-api-manager [role=status]{margin:.35rem 0}
.st-api-manager fieldset{margin:.65rem 0;border:1px solid var(--SmartThemeBorderColor,#999)}
.st-api-manager fieldset label{display:block;overflow-wrap:anywhere}
.st-api-manager details{margin:.75rem 0}
.st-api-manager .menu_button{min-height:2rem;white-space:normal}
`);
  doc.head.append(style);
  doc.body.append(dialog);
  let filter = '';
  let search = '';
  let busy = false;

  function message(text) { status.textContent = text; }
  function title(text, back) {
    heading.replaceChildren(node('h2', text), button(back ? '返回' : '关闭', () => {
      if (busy) return;
      if (back) { message(''); list(); }
      else dialog.close();
    }));
  }
  function actions(...children) {
    const element = node('div', undefined, { class: 'actions' });
    element.append(...children);
    return element;
  }
  function field(form, label, control) {
    const wrapper = node('label', label, { class: 'field' });
    wrapper.append(control);
    form.append(wrapper);
    return control;
  }
  function input(value = '', attributes = {}) {
    const element = node('input', undefined, { class: 'text_pole', autocomplete: 'off', ...attributes });
    element.value = value;
    return element;
  }
  function select(options, value) {
    const element = node('select');
    for (const [id, name] of options) element.append(node('option', name, { value: id }));
    element.value = value;
    return element;
  }
  async function run(action, success, done = list) {
    if (busy) return;
    busy = true;
    const controls = [...dialog.querySelectorAll('button,input,select,textarea')].filter(item => !item.disabled);
    for (const item of controls) item.disabled = true;
    try {
      const result = await action();
      message(success ?? result);
      done();
    } catch (error) {
      message(error.message || '操作失败，原有配置已保留。');
    } finally {
      busy = false;
      for (const item of controls) item.disabled = false;
    }
  }
  const update = change => storage.update(change);

  function list() {
    const { groups, entries } = storage.catalog;
    if (!['', ':unassigned'].includes(filter) && !groups.some(group => group.id === filter)) filter = '';
    title('API 管理器');
    const file = node('input', undefined, { type: 'file', accept: '.json,application/json', hidden: '' });
    file.addEventListener('change', () => {
      const selected = file.files[0];
      file.value = '';
      if (!selected) return;
      run(async () => {
        let decoded;
        try { decoded = readCatalog(JSON.parse(await selected.text())); } catch { throw formatError(); }
        await update(local => mergeCatalogs(local, decoded.catalog, decoded.legacy));
      }, '已合并导入配置。');
    });
    const pull = button('从账户读取', () => run(() => storage.pull()));
    const push = button('同步到账户', () => run(() => storage.push()));
    pull.disabled = push.disabled = !storage.canSync;
    const toolbar = actions(
      button('新增配置', () => editor()), button('管理分组', groupsPanel),
      button('导入', () => file.click()), button('导出', download), pull, push,
    );
    body.replaceChildren(toolbar, file);
    if (!storage.canSync) body.append(node('p', '当前酒馆未提供账户存储，可通过文件导入和导出。'));
    const groupOptions = [['', '全部分组'], [':unassigned', '未分组'], ...groups.map(group => [group.id, group.name])];
    const groupFilter = select(groupOptions, filter);
    groupFilter.setAttribute('aria-label', '按分组筛选');
    const query = input(search, { type: 'search', placeholder: '搜索站点、模型或分组', 'aria-label': '搜索配置' });
    const cards = node('div', undefined, { class: 'entries' });
    groupFilter.addEventListener('change', () => { filter = groupFilter.value; renderRows(); });
    query.addEventListener('input', () => { search = query.value; renderRows(); });
    body.append(actions(groupFilter, query), cards);
    function renderRows() {
      cards.replaceChildren();
      for (const row of entries) {
        const names = groups.filter(group => row.groupIds.includes(group.id)).map(group => group.name);
        if (filter === ':unassigned' ? row.groupIds.length > 0 : filter && !row.groupIds.includes(filter)) continue;
        if (![row.site, row.name, row.source, row.model, ...names].join(' ').toLowerCase().includes(search.trim().toLowerCase())) continue;
        const card = node('article', undefined, { 'data-entry-id': row.id });
        card.append(
          node('strong', row.model || '未指定模型'),
          node('p', [row.site, row.name, row.source].filter(Boolean).join(' · ')),
          node('p', (row.key ? '已保存密钥' : '未填写密钥') + ' · ' + (names.join('、') || '未分组')),
          actions(button('编辑', () => editor(row)), button('删除', () => {
            if (host.confirm('删除这一条配置？')) run(() => update(catalog => ({
              ...catalog, entries: catalog.entries.filter(entry => entry.id !== row.id),
            })), '已删除配置。');
          })),
        );
        cards.append(card);
      }
      if (!cards.childElementCount) cards.append(node('p', '没有匹配的配置。'));
    }
    renderRows();
  }

  function editor(existing) {
    const row = existing ?? { site: '', name: '', source: 'custom', url: '', key: '', model: '', groupIds: [] };
    title(existing ? '编辑配置' : '新增配置', true);
    message('');
    const form = node('form');
    const site = field(form, '站点名称', input(row.site, { required: '' }));
    const name = field(form, '条目备注（可选）', input(row.name));
    const sources = [['custom', '自定义（OpenAI 兼容）'], ['openai', 'OpenAI'], ['deepseek', 'DeepSeek'], ['makersuite', 'Google AI Studio']];
    if (!sources.some(([id]) => id === row.source)) sources.push([row.source, row.source]);
    const source = field(form, '来源', select(sources, row.source));
    const url = field(form, '站点 URL', input(row.url, { spellcheck: 'false', inputmode: 'url' }));
    const key = field(form, 'API 密钥', input(row.key, { type: 'password', spellcheck: 'false' }));
    const reveal = button('显示密钥', () => {
      const hidden = key.type === 'password';
      key.type = hidden ? 'text' : 'password';
      reveal.textContent = hidden ? '隐藏密钥' : '显示密钥';
    });
    const modelInput = existing ? input(row.model) : node('textarea', undefined, { class: 'text_pole', rows: '3' });
    const model = field(form, existing ? '模型' : '模型（每行一个，可留空）', modelInput);
    const draft = () => ({
      source: source.value, url: existing && url.value === row.url ? row.url : url.value.trim(),
      key: key.value,
    });
    const suggestions = select([['', '可选择拉取到的模型']], '');
    suggestions.setAttribute('aria-label', '拉取到的模型');
    suggestions.hidden = true;
    for (const control of [source, url, key]) control.addEventListener('input', () => { suggestions.hidden = true; });
    suggestions.addEventListener('change', () => {
      if (!suggestions.value) return;
      model.value = existing ? suggestions.value : labels([...model.value.split(/\r?\n/).map(value => value.trim()), suggestions.value]).join('\n');
      suggestions.value = '';
    });
    const pull = button('拉取模型', () => run(async () => {
      suggestions.hidden = true;
      const models = await discoverModels(draft(), host.fetch.bind(host));
      suggestions.replaceChildren(node('option', '可选择拉取到的模型', { value: '' }),
        ...models.map(value => node('option', value, { value })));
      suggestions.hidden = models.length === 0;
      return models.length ? '已拉取 ' + models.length + ' 个模型，选择后再保存。' : '站点没有返回模型，可以手动填写。';
    }, undefined, () => {}));
    form.append(actions(reveal, pull, suggestions));
    const groupBox = node('fieldset');
    groupBox.append(node('legend', '分组（可多选）'));
    const checkboxes = storage.catalog.groups.map(group => {
      const label = node('label');
      const control = input(group.id, { type: 'checkbox' });
      control.checked = row.groupIds.includes(group.id);
      label.append(control, doc.createTextNode(' ' + group.name));
      groupBox.append(label);
      return control;
    });
    if (!checkboxes.length) groupBox.append(node('span', '可先在「管理分组」中创建分组。'));
    if (row.history) {
      const history = node('details');
      history.append(node('summary', '旧密钥池记录'), node('p',
        '原密钥位置：' + (row.history.index + 1) + ' / ' + row.history.poolSize +
        '；历史成功：' + (row.history.keyHistory?.successCount ?? '—') +
        '；历史失败：' + (row.history.keyHistory?.failureCount ?? '—')));
      form.append(history);
    }
    form.append(groupBox, node('button', '保存配置', { type: 'submit', class: 'menu_button' }));
    form.addEventListener('submit', event => {
      event.preventDefault();
      run(() => {
        const fields = draft();
        if ((!existing || fields.url !== row.url || fields.source !== row.source) &&
            (fields.url || fields.source === 'custom')) endpointUrl(fields.url);
        if (!site.value.trim()) throw new Error('请填写站点名称。');
        const models = existing ? [model.value === row.model ? row.model : model.value.trim()]
          : labels(model.value.split(/\r?\n/).map(value => value.trim()));
        const groupIds = checkboxes.filter(control => control.checked).map(control => control.value);
        const rows = (models.length ? models : ['']).map(value => ({
          ...row, ...fields, id: existing?.id ?? makeId(), site: site.value.trim(),
          name: name.value.trim(), model: value, groupIds,
        }));
        return update(catalog => ({
          ...catalog,
          entries: existing ? catalog.entries.map(entry => entry.id === existing.id ? rows[0] : entry) : [...catalog.entries, ...rows],
        }));
      }, '已保存配置。');
    });
    body.replaceChildren(form);
    site.focus();
  }

  function groupsPanel() {
    title('管理分组', true);
    const form = node('form');
    const name = field(form, '新分组名称', input('', { required: '' }));
    form.append(node('button', '创建分组', { type: 'submit', class: 'menu_button' }));
    form.addEventListener('submit', event => {
      event.preventDefault();
      run(() => {
        if (!name.value.trim()) throw new Error('请填写分组名称。');
        return update(catalog => ({
          ...catalog, groups: [...catalog.groups, { id: makeId(), name: name.value.trim() }],
        }));
      }, '已创建分组。', groupsPanel);
    });
    body.replaceChildren(form);
    for (const group of storage.catalog.groups) {
      const label = input(group.name, { 'aria-label': '分组名称：' + group.name });
      body.append(actions(label, button('保存名称', () => run(() => {
        if (!label.value.trim()) throw new Error('请填写分组名称。');
        return update(catalog => ({
          ...catalog, groups: catalog.groups.map(item => item.id === group.id ? { ...item, name: label.value.trim() } : item),
        }));
      }, '已保存分组。', groupsPanel)), button('删除分组', () => {
        if (host.confirm('删除这个分组？其中的配置会保留。')) run(() => update(catalog => ({
          ...catalog, groups: catalog.groups.filter(item => item.id !== group.id),
          entries: catalog.entries.map(row => ({ ...row, groupIds: row.groupIds.filter(id => id !== group.id) })),
        })), '已删除分组。', groupsPanel);
      })));
    }
  }

  function download() {
    const blob = new Blob([JSON.stringify(storage.catalog, null, 2)], { type: 'application/json' });
    const href = URL.createObjectURL(blob);
    const link = node('a', undefined, { href, download: 'st-api-manager-configs.json' });
    dialog.append(link);
    link.click();
    link.remove();
    host.setTimeout(() => URL.revokeObjectURL(href), 1000);
    message('已导出配置，文件包含密钥。');
  }
  dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
  dialog.addEventListener('close', () => { if (!dialog.open) body.replaceChildren(); });
  return () => {
    if (dialog.open) return;
    message('');
    list();
    dialog.showModal();
  };
}
