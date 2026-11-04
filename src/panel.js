function mountCatalogPanel(host, storage, connection) {
  const doc = host.document;
  const make = (tag, className = '', text) => {
    const element = doc.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  };
  const icon = name => {
    const element = make('i', 'fa-solid fa-' + name);
    element.setAttribute('aria-hidden', 'true');
    return element;
  };
  function button(text, click, glyph, iconOnly = false) {
    const element = make('button', 'menu_button interactable' + (glyph ? ' menu_button_icon' : ''));
    element.type = 'button';
    if (glyph) element.append(icon(glyph));
    if (iconOnly) {
      element.title = text;
      element.setAttribute('aria-label', text);
    } else element.append(make('span', '', text));
    if (click) element.addEventListener('click', click);
    return element;
  }
  const fieldInput = (value, label, options = {}) => {
    const element = make('input', 'text_pole wide100p');
    Object.assign(element, { value, autocomplete: 'off', ...options });
    element.setAttribute('aria-label', label);
    return element;
  };
  const closeButton = (popup, label = '关闭') => button(label, () => popup.dialog.close(), 'times');
  const style = make('style', '', catalogPanelCss);
  doc.head.append(style);
  let busy = false;
  function popup(title, size = 'medium', main = false) {
    const dialog = make('dialog', 'st-api-manager popup popup_type textAlignJustify st-orb-popup st-api-manager-native-dialog st-api-manager-native-dialog--' + size);
    dialog.setAttribute('aria-label', title);
    if (!main) dialog.dataset.nested = '';
    const frame = make('div', 'popup-body');
    const content = make('div', 'popup-content');
    const heading = main ? make('div', 'api-manager-modal-toolbar-target') : make('h3', 'popup-header', title);
    const scroll = make('div', 'popup-scroll-content');
    const footer = make('div', 'popup-controls');
    const status = make('div');
    status.setAttribute('role', 'status');
    content.append(heading, scroll);
    frame.append(content, status, footer);
    dialog.append(frame);
    dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
    dialog.addEventListener('close', () => {
      if (!main) dialog.remove();
    });
    doc.body.append(dialog);
    return {
      dialog, heading, scroll, footer, status,
      open() { dialog.showModal(); },
    };
  }
  async function run(pane, action, success, done) {
    if (busy) return;
    busy = true;
    const controls = [...pane.dialog.querySelectorAll('button,input,select,textarea')].filter(item => !item.disabled);
    for (const control of controls) control.disabled = true;
    try {
      const result = await action();
      pane.status.textContent = success ?? result ?? '';
      done?.();
    } catch (error) {
      pane.status.textContent = error.message || '操作失败，原有配置已保留。';
    } finally {
      for (const control of controls) control.disabled = false;
      busy = false;
    }
  }
  const main = popup('API 管理器', 'large', true);
  const version = make('span', 'toolbar-version', catalogPanelVersion);
  version.setAttribute('aria-label', '当前版本');
  main.footer.classList.add('catalog-main-footer');
  main.footer.append(version, closeButton(main));
  const categoryFilter = new Set();
  const siteFilter = new Set();
  const collapsed = new Set();
  const unassigned = Symbol('uncategorized');
  const siteId = row => JSON.stringify([row.site, row.source, row.url]);
  const rowTitle = row => row.model ? '[' + row.site + '] ' + row.model : row.site;
  function displayAlias(row) {
    const model = row.model || '未选择模型';
    if (row.name === model) return '';
    // Collapse the old generated title in the list only. Keep its original
    // text in the record and keep custom text between the group and model.
    const legacy = /^\[([^\]\r\n]+)\]\s+(.+)$/u.exec(row.name);
    if (!legacy) return row.name;
    const [, prefix, suffix] = legacy;
    if (suffix !== model && !suffix.endsWith(' ' + model)) return row.name;
    const knownGroup = prefix === row.site || prefix === storage.legacyTitleSite(row);
    return (knownGroup ? suffix : row.name).slice(0, -model.length).trim();
  }
  const groupColor = group => /^#[0-9a-f]{6}$/i.test(group.color) ? group.color : '#3b82f6';
  function sites() {
    const result = new Map();
    for (const row of storage.catalog.entries) {
      const id = siteId(row);
      if (!result.has(id)) result.set(id, []);
      result.get(id).push(row);
    }
    return result;
  }
  function save(pane, change, message, done = refresh) {
    return run(pane, () => storage.update(change), message, done);
  }
  function deleteRows(pane, rows, message, done = refresh) {
    if (!host.confirm(message)) return;
    const ids = new Set(rows.map(row => row.id));
    return save(pane, catalog => ({ ...catalog, entries: catalog.entries.filter(row => !ids.has(row.id)) }),
      '已删除配置。', done);
  }
  function rowMetadata(row, { keyLabel, keyNote, alias }) {
    const meta = make('span', 'catalog-card-meta');
    meta.append(make('span', 'catalog-card-site', row.site));
    if (keyLabel) meta.append(make('span', 'catalog-key-label', keyLabel));
    for (const [value, glyph] of [[keyNote, 'key'], [row.modelNote, 'comment']]) {
      if (!value) continue;
      const note = make('span', 'catalog-meta-note');
      note.append(icon(glyph), make('span', '', value));
      meta.append(note);
    }
    if (alias) meta.append(make('span', 'catalog-card-alias', alias));
    return meta;
  }
  function showRowDetails(row, { keyLabel, keyNote }) {
    const pane = popup('配置详情', 'small');
    const fields = make('dl', 'catalog-details');
    for (const [label, value] of [
      ['模型 ID', row.model || '未选择模型'], ['配置组', row.site], ['密钥编号', keyLabel],
      ['密钥备注', keyNote], ['模型备注', row.modelNote], ['原条目标题', row.name],
    ]) {
      if (value) fields.append(make('dt', '', label), make('dd', '', value));
    }
    pane.scroll.append(fields);
    pane.footer.append(closeButton(pane));
    pane.open();
  }
  function focusRowAction(row, group, selector = '.catalog-card-more') {
    const cards = [...main.scroll.querySelectorAll('.catalog-config-card')].filter(card =>
      card.dataset.entryId === row.id && card.getClientRects().length);
    const card = cards.find(card => card.dataset.groupId === (group?.id ?? '')) ?? cards[0];
    (card?.querySelector(selector) ?? main.heading.querySelector('button'))?.focus();
  }
  function showRowActions(row, group) {
    const pane = popup('更多操作', 'small');
    const actions = make('div', 'catalog-more-actions');
    function action(label, invoke, glyph) {
      const control = button(label, () => { pane.dialog.close(); invoke(); }, glyph);
      actions.append(control);
      return control;
    }
    const restore = () => focusRowAction(row, group);
    action('编辑', () => edit([row], restore), 'pen-to-square');
    action('管理分组', () => rowGroups(row, restore), 'tag');
    if (group) action('移出标签分组', () => {
      save(main, catalog => ({
        ...catalog, entries: catalog.entries.map(entry => entry.id === row.id
          ? { ...entry, groupIds: entry.groupIds.filter(id => id !== group.id) } : entry),
      }), '已移出标签分组。', () => { refresh(); restore(); });
    }, 'xmark');
    action('删除', () => deleteRows(main, [row], '删除这一条配置？', () => { refresh(); restore(); }), 'trash')
      .classList.add('catalog-delete-action');
    pane.scroll.append(make('p', 'catalog-action-target', rowTitle(row)), actions);
    pane.footer.append(closeButton(pane));
    pane.dialog.addEventListener('click', event => {
      if (event.target !== pane.dialog) return;
      const { left, right, top, bottom } = pane.dialog.getBoundingClientRect();
      if (event.clientX < left || event.clientX >= right || event.clientY < top || event.clientY >= bottom) {
        pane.dialog.close();
      }
    });
    pane.open();
  }
  function rowNode(row, group, presentation) {
    const card = make('div', 'secretKeyManagerItem catalog-config-card');
    card.dataset.entryId = row.id;
    card.dataset.groupId = group?.id ?? '';
    const title = make('button', 'catalog-card-title');
    title.type = 'button';
    title.setAttribute('aria-haspopup', 'dialog');
    title.append(make('span', 'catalog-card-model', row.model || '未选择模型'), icon('angle-right'));
    title.addEventListener('click', () => {
      title.focus({ preventScroll: true });
      showRowDetails(row, presentation);
    });
    const meta = rowMetadata(row, presentation);
    if (connection.activeRowId() === row.id) {
      card.classList.add('secretKeyManagerItem--applied');
      meta.append(make('span', 'active-badge-sm', '已应用'));
    }
    const actions = make('div', 'catalog-card-actions');
    const more = button('⋯', () => {
      more.focus({ preventScroll: true });
      showRowActions(row, group);
    });
    more.classList.add('catalog-card-more');
    more.setAttribute('aria-label', '更多操作');
    more.setAttribute('aria-haspopup', 'dialog');
    const apply = button('应用', () => run(main, () => connection.apply(row), undefined, () => {
      refresh();
      focusRowAction(row, group, '.catalog-card-apply');
    }));
    apply.classList.add('catalog-card-apply');
    actions.append(apply, more);
    card.append(title, meta, actions);
    return card;
  }
  function rowPresentations(availableSites) {
    const notesById = new Map((storage.catalog.keyNotes ?? []).map(note => [note.id, note.note]));
    const presentations = new Map();
    // Groups sharing a visible name can still have different endpoints.
    const byName = new Map();
    for (const rows of availableSites.values()) {
      const name = rows[0].site;
      if (!byName.has(name)) byName.set(name, []);
      byName.get(name).push(...rows);
    }
    const visibleCredential = row => JSON.stringify([row.source, row.url, credentialRef(row)]);
    for (const rows of byName.values()) {
      const keys = [...new Set(rows.map(visibleCredential))];
      const models = new Map();
      for (const row of rows) {
        if (!models.has(row.model)) models.set(row.model, new Set());
        models.get(row.model).add(visibleCredential(row));
      }
      for (const row of rows) {
        presentations.set(row.id, {
          keyLabel: models.get(row.model).size > 1 ? 'Key ' + (keys.indexOf(visibleCredential(row)) + 1) : '',
          keyNote: notesById.get(row.credentialId),
          alias: displayAlias(row),
        });
      }
    }
    return presentations;
  }
  function refresh() {
    const { groups, entries } = storage.catalog;
    const availableSites = sites();
    const presentations = rowPresentations(availableSites);
    for (const id of siteFilter) if (!availableSites.has(id)) siteFilter.delete(id);
    for (const id of categoryFilter) if (id !== unassigned && !groups.some(group => group.id === id)) categoryFilter.delete(id);
    const toolbar = make('div', 'api-manager-toolbar');
    const filter = button('筛选', filters, 'filter');
    filter.setAttribute('aria-label', '筛选');
    const count = categoryFilter.size + siteFilter.size;
    if (count) filter.append(make('span', 'filter-badge', String(count)));
    toolbar.append(button('API 管理', manager, 'layer-group'), button('标签设置', tagSettings, 'tags'),
      filter, button('检测', detection, 'bolt'), button('数据', dataPanel, 'database'));
    main.heading.replaceChildren(toolbar);
    const panel = make('div', 'api-manager-panel');
    const list = make('div', 'api-config-list');
    panel.append(list);
    const matches = entries.filter(row => !siteFilter.size || siteFilter.has(siteId(row)));
    const sections = [{ id: unassigned, name: '未分类' }, ...groups];
    for (const section of sections) {
      const isUnassigned = section.id === unassigned;
      if (categoryFilter.size && !categoryFilter.has(section.id)) continue;
      const rows = matches.filter(row => isUnassigned ? !row.groupIds.length : row.groupIds.includes(section.id));
      if (!rows.length && isUnassigned) continue;
      const drawer = make('details', 'inline-drawer');
      drawer.open = !collapsed.has(section.id);
      const header = make('summary', 'inline-drawer-toggle inline-drawer-header');
      const label = make('span', 'flex-container alignItemsCenter');
      const name = make('b', '', section.name);
      if (!isUnassigned) name.style.color = groupColor(section);
      label.append(name, make('small', 'category-count', '(' + rows.length + ')'));
      const arrow = icon(drawer.open ? 'circle-chevron-up' : 'circle-chevron-down');
      arrow.classList.add('inline-drawer-icon');
      header.append(label, arrow);
      drawer.addEventListener('toggle', () => {
        if (drawer.open) collapsed.delete(section.id);
        else collapsed.add(section.id);
        arrow.classList.toggle('fa-circle-chevron-up', drawer.open);
        arrow.classList.toggle('fa-circle-chevron-down', !drawer.open);
      });
      const wrap = make('div', 'inline-drawer-content');
      const cards = make('div', 'secretKeyManagerList');
      if (rows.length) cards.append(...rows.map(row => rowNode(row, isUnassigned ? undefined : section, presentations.get(row.id))));
      else cards.append(make('p', 'st-orb-empty-state', '此标签暂无配置'));
      wrap.append(cards);
      drawer.append(header, wrap);
      list.append(drawer);
    }
    if (!list.childElementCount) list.append(make('p', 'api-keys-empty', '没有匹配的配置'));
    main.scroll.replaceChildren(panel);
  }
  function manager() {
    const pane = popup('API 管理');
    const wrap = make('div', 'config-group-manager');
    const list = make('div', 'group-list');
    function render() {
      list.replaceChildren();
      for (const rows of sites().values()) {
        const row = rows[0];
        const item = make('div', 'group-list-item');
        const info = make('div', 'group-info');
        const head = make('div', 'group-header');
        const details = make('div', 'group-details');
        head.append(make('span', 'group-name', row.site),
          make('span', 'group-count', new Set(rows.map(entry => entry.model).filter(Boolean)).size + ' 个模型'));
        const url = make('span', 'group-url', row.url || row.source);
        url.title = row.url;
        details.append(url, make('span', 'group-keys', new Set(rows.filter(entry => entry.key).map(credentialRef)).size + ' 个密钥'));
        info.append(head, details);
        const actions = make('div', 'group-actions');
        actions.append(
          button('编辑此组的端点、密钥和模型', () => edit(rows, render), 'pen', true),
          button('删除此组的所有模型配置', () => deleteRows(pane, rows, '删除此配置组的所有模型配置？', () => { render(); refresh(); }), 'trash', true),
        );
        item.append(info, actions);
        list.append(item);
      }
      if (!list.childElementCount) list.append(make('p', 'group-list-empty', '暂无 API 配置'));
    }
    render();
    wrap.append(list);
    pane.scroll.append(wrap);
    pane.footer.append(button('添加配置', () => edit([], render), 'plus'), closeButton(pane));
    pane.open();
  }
  const edit = (rows, afterSave) => openCatalogEditor({
    host, storage, popup, make, button, fieldInput, closeButton, save, run, refresh, groupColor,
  }, rows, afterSave);

  function filters() {
    const pane = popup('筛选');
    const wrap = make('div', 'category-popup-modal filter-modal');
    const { entries, groups } = storage.catalog;
    const selections = [categoryFilter, siteFilter];
    const controls = [];
    const header = make('div', 'category-popup-header');
    header.append(make('span', 'category-popup-title', '筛选标签和配置组'), button('清空', () => {
      for (const selection of selections) selection.clear();
      for (const control of controls) control.checked = false;
      refresh();
    }, 'eraser'));
    wrap.append(header);
    const sections = [
      ['标签', [{ id: unassigned, name: '未分类', count: entries.filter(row => !row.groupIds.length).length },
        ...groups.map(group => ({ ...group, count: entries.filter(row => row.groupIds.includes(group.id)).length }))]],
      ['配置组', [...sites()].map(([id, rows]) => ({ id, name: rows[0].site, count: rows.length }))],
    ];
    sections.forEach(([name, options], index) => {
      const section = make('section', 'category-popup-section');
      const header = make('div', 'category-popup-section__header');
      const inputs = [];
      const selected = selections[index];
      const selectAll = value => {
        for (const [id, control] of inputs) {
          control.checked = value;
          if (value) selected.add(id);
          else selected.delete(id);
        }
        refresh();
      };
      header.append(make('strong', 'category-popup-section__title', name),
        button('全选', () => selectAll(true)));
      const list = make('div', 'category-popup-options');
      for (const option of options) {
        const label = make('label', 'category-popup-option filter-option-item');
        const input = make('input');
        input.type = 'checkbox';
        input.checked = selected.has(option.id);
        input.addEventListener('change', () => {
          if (input.checked) selected.add(option.id);
          else selected.delete(option.id);
          refresh();
        });
        inputs.push([option.id, input]);
        controls.push(input);
        label.append(input, make('span', '', option.name), make('small', 'category-popup-option__count', String(option.count)));
        list.append(label);
      }
      section.append(header, list);
      wrap.append(section);
    });
    pane.scroll.append(wrap);
    pane.footer.append(closeButton(pane));
    pane.open();
  }
  function tagOption(group, input, extras = []) {
    const tag = make('span', 'category-tag menu_button menu_button_icon');
    const label = make('label', 'catalog-tag-label');
    const dot = make('span', 'category-color-dot');
    dot.style.backgroundColor = groupColor(group);
    label.append(input, dot, make('span', 'category-tag-name', group.name));
    tag.append(label, ...extras);
    return tag;
  }
  function rowGroups(row, afterSave) {
    const pane = popup('管理分组');
    const wrap = make('div', 'set-category-modal');
    wrap.append(make('div', 'set-category-target', rowTitle(row)));
    const grid = make('div', 'category-tag-grid');
    const inputs = storage.catalog.groups.map(group => {
      const control = make('input');
      control.type = 'checkbox';
      control.checked = row.groupIds.includes(group.id);
      grid.append(tagOption(group, control));
      return [group.id, control];
    });
    if (!inputs.length) grid.append(make('p', 'category-tag-grid__empty', '可在「标签设置」创建标签'));
    wrap.append(grid);
    pane.scroll.append(wrap);
    pane.footer.append(button('清空', () => { for (const [, input] of inputs) input.checked = false; }),
      closeButton(pane, '取消'), button('保存', () => save(pane, catalog => ({
        ...catalog, entries: catalog.entries.map(entry => entry.id === row.id ? {
          ...entry, groupIds: inputs.filter(([, input]) => input.checked).map(([id]) => id),
        } : entry),
      }), '已保存标签。', () => { refresh(); pane.dialog.close(); afterSave(); }), 'check'));
    pane.open();
  }
  function tagSettings() {
    const pane = popup('标签设置');
    const wrap = make('div', 'batch-category-modal');
    const selectedRows = new Set();
    const selectedTags = new Set();
    let onlyUnassigned = false;
    const search = fieldInput('', '搜索组名、模型、标题或备注', { type: 'search', placeholder: '搜索组名、模型、标题或备注' });
    search.classList.add('search-input');
    const searchSection = make('div', 'search-section');
    searchSection.append(search);
    const toolbar = make('div', 'selection-toolbar');
    const list = make('div', 'config-list');
    const count = make('span', 'selection-count');
    const selectList = button('选择当前列表', () => {
      const rows = visibleRows();
      const allSelected = rows.every(row => selectedRows.has(row.id));
      for (const row of rows) if (allSelected) selectedRows.delete(row.id); else selectedRows.add(row.id);
      renderRows();
    });
    selectList.className = 'selection-action';
    const unassignedButton = button('未分类', () => {
      onlyUnassigned = !onlyUnassigned;
      unassignedButton.classList.toggle('active', onlyUnassigned);
      unassignedButton.setAttribute('aria-pressed', String(onlyUnassigned));
      renderRows();
    });
    unassignedButton.className = 'selection-action';
    const clearRows = button('取消选择', () => { selectedRows.clear(); renderRows(); });
    clearRows.className = 'selection-action';
    toolbar.append(selectList, unassignedButton, clearRows, count);
    const presentations = rowPresentations(sites());
    function visibleRows() {
      const terms = search.value.toLowerCase().split(/\s+/).filter(Boolean);
      return storage.catalog.entries.filter(row => {
        if (onlyUnassigned && row.groupIds.length) return false;
        const { keyLabel, keyNote } = presentations.get(row.id);
        const searchable = [row.site, row.model, row.name, keyLabel, keyNote, row.modelNote].join(' ').toLowerCase();
        return terms.every(term => searchable.includes(term));
      });
    }
    const addTags = button('添加标签', () => changeTags('add'), 'plus');
    const removeTags = button('移除标签', () => changeTags('remove'), 'minus');
    const clearTags = button('清空标签', () => {
      if (host.confirm('清空所选配置的标签？')) changeTags('clear');
    }, 'eraser');
    function setCount() {
      count.textContent = '已选中 ' + selectedRows.size + ' / ' + storage.catalog.entries.length + ' 个';
      addTags.disabled = removeTags.disabled = !selectedRows.size || !selectedTags.size;
      clearTags.disabled = !selectedRows.size;
    }
    function renderRows() {
      list.replaceChildren();
      for (const row of visibleRows()) {
        const label = make('label', 'config-item');
        const control = make('input', 'config-checkbox');
        control.type = 'checkbox';
        control.checked = selectedRows.has(row.id);
        label.classList.toggle('selected', control.checked);
        control.addEventListener('change', () => {
          if (control.checked) selectedRows.add(row.id);
          else selectedRows.delete(row.id);
          label.classList.toggle('selected', control.checked);
          setCount();
        });
        const info = make('span', 'config-info');
        info.append(make('strong', 'catalog-selection-model', row.model || '未选择模型'),
          rowMetadata(row, presentations.get(row.id)));
        label.append(control, info);
        list.append(label);
      }
      if (!list.childElementCount) list.append(make('p', 'api-keys-empty', '没有匹配的配置'));
      setCount();
    }
    search.addEventListener('input', renderRows);
    function changeTags(mode) {
      save(pane, catalog => ({
        ...catalog, entries: catalog.entries.map(row => {
          if (!selectedRows.has(row.id)) return row;
          const groupIds = mode === 'clear' ? [] : mode === 'add'
            ? labels([...row.groupIds, ...selectedTags]) : row.groupIds.filter(id => !selectedTags.has(id));
          return { ...row, groupIds };
        }),
      }), '已更新所选配置的标签。', () => { refresh(); renderRows(); });
    }
    const tagPanel = make('section', 'category-action-panel');
    const heading = make('div', 'category-action-panel__header');
    heading.append(make('span', 'category-action-panel__title', '管理标签'));
    const form = make('form', 'new-category-row');
    const name = fieldInput('', '新分组名称', { placeholder: '输入分类名称（如：Claude、GPT、本地模型）', required: true });
    name.classList.add('new-category-input');
    const color = fieldInput('#3b82f6', '选择颜色', { type: 'color' });
    color.className = 'color-picker';
    const add = button('新建分类', undefined, 'plus', true);
    add.type = 'submit';
    form.append(name, color, add);
    form.addEventListener('submit', event => {
      event.preventDefault();
      const value = name.value.trim();
      if (!value) return;
      save(pane, catalog => ({
        ...catalog, groups: [...catalog.groups, { id: makeId(), name: value, color: color.value }],
      }), '已创建分组。', () => { name.value = ''; renderTags(); refresh(); });
    });
    const grid = make('div', 'category-tag-grid');
    function renderTags() {
      grid.replaceChildren();
      for (const group of storage.catalog.groups) {
        const control = make('input');
        control.type = 'checkbox';
        control.checked = selectedTags.has(group.id);
        control.addEventListener('change', () => {
          if (control.checked) selectedTags.add(group.id);
          else selectedTags.delete(group.id);
          setCount();
        });
        const rename = button('重命名或改色', () => editTag(group), 'pen', true);
        const remove = button('删除标签', () => {
          if (!host.confirm('删除这个标签？其中的配置会保留。')) return;
          save(pane, catalog => ({
            ...catalog, groups: catalog.groups.filter(item => item.id !== group.id),
            entries: catalog.entries.map(row => ({ ...row, groupIds: row.groupIds.filter(id => id !== group.id) })),
          }), '已删除分组。', () => { selectedTags.delete(group.id); renderTags(); renderRows(); refresh(); });
        }, 'trash', true);
        rename.classList.add('category-tag-delete');
        remove.classList.add('category-tag-delete');
        grid.append(tagOption(group, control, [rename, remove]));
      }
      if (!grid.childElementCount) grid.append(make('p', 'category-tag-grid__empty', '暂无标签'));
      setCount();
    }
    function editTag(group) {
      const child = popup('编辑标签');
      const name = fieldInput(group.name, '标签名称');
      const color = fieldInput(groupColor(group), '选择颜色', { type: 'color' });
      const row = make('div', 'new-category-row');
      row.append(name, color);
      child.scroll.append(row);
      child.footer.append(closeButton(child, '取消'), button('保存', () => {
        const value = name.value.trim();
        if (!value) return;
        save(child, catalog => ({
          ...catalog, groups: catalog.groups.map(item => item.id === group.id ? { ...item, name: value, color: color.value } : item),
        }), '已保存标签。', () => { renderTags(); refresh(); child.dialog.close(); });
      }, 'check'));
      child.open();
    }
    const clearSelectedTags = button('清空', () => { selectedTags.clear(); renderTags(); }, 'eraser');
    tagPanel.append(heading, form, clearSelectedTags, grid);
    wrap.append(searchSection, toolbar, list, tagPanel);
    pane.scroll.append(wrap);
    pane.footer.classList.add('catalog-tag-actions');
    pane.footer.append(closeButton(pane, '取消'), addTags, removeTags, clearTags);
    renderRows();
    renderTags();
    pane.open();
  }

  function dataPanel() {
    const pane = popup('数据', 'small');
    const wrap = make('div', 'data-actions-modal');
    const file = fieldInput('', '导入配置文件', { type: 'file', accept: '.json,application/json' });
    file.className = 'data-actions-file-input';
    file.addEventListener('change', async () => {
      const selected = file.files[0];
      file.value = '';
      if (!selected) return;
      let decoded;
      await run(pane, async () => {
        try { decoded = readCatalog(JSON.parse(await selected.text())); } catch { throw formatError(); }
      });
      if (!decoded) return;
      const child = popup('导入方式', 'small');
      const options = make('div', 'import-mode-modal import-mode-options');
      options.append(make('p', '', '选择如何将文件中的配置导入目录'));
      for (const [label, detail, replace] of [
        ['合并导入', '保留本机配置并合并文件中的条目', false],
        ['替换导入', '使用导入文件中的配置和标签替换本机目录', true],
      ]) {
        const choice = button(label, () => {
          if (replace && !host.confirm('用导入文件替换本机目录？')) return;
          save(child, catalog => replace ? decoded.catalog : mergeCatalogs(catalog, decoded.catalog, decoded.legacy),
            undefined, () => {
              pane.status.textContent = replace ? '已替换导入配置。' : '已合并导入配置。';
              refresh();
              child.dialog.close();
            });
        });
        choice.classList.add('import-mode-option');
        choice.append(make('small', '', detail));
        options.append(choice);
      }
      child.scroll.append(options);
      child.footer.append(closeButton(child, '取消'));
      child.open();
    });
    const download = () => {
      const blob = new Blob([JSON.stringify(storage.catalog, null, 2)], { type: 'application/json' });
      const href = URL.createObjectURL(blob);
      const link = make('a');
      link.href = href;
      link.download = 'st-api-manager-configs.json';
      pane.dialog.append(link);
      link.click();
      link.remove();
      host.setTimeout(() => URL.revokeObjectURL(href), 1000);
      pane.status.textContent = '已导出配置，文件包含密钥。';
    };
    const clear = () => {
      if (!host.confirm('清空本机所有配置？标签会保留。')) return;
      save(pane, catalog => ({ ...catalog, entries: [] }), '已清空配置。');
    };
    const sync = make('div', 'data-actions-sync');
    const state = make('div', 'data-actions-sync__status');
    const time = make('div', 'data-actions-sync__time');
    function syncStatus() {
      const info = storage.syncInfo;
      state.textContent = !storage.canSync ? '账户同步：当前宿主不可用'
        : info.pending ? '账户同步：有本机改动待同步' : info.revision ? '账户同步：已同步' : '账户同步：尚未同步';
      time.textContent = info.syncedAt ? '上次同步：' + new Date(info.syncedAt).toLocaleString() : '上次同步：—';
      refresh();
    }
    const controls = make('div', 'data-actions-sync__controls');
    async function synchronize(direction) {
      let result;
      await run(pane, async () => {
        result = await storage[direction]();
        return typeof result === 'string' ? result : undefined;
      }, undefined, syncStatus);
      if (!result?.resolve) return;

      const child = popup('账户同步冲突');
      const body = make('div', 'sync-conflict-modal');
      const summary = make('div', 'sync-conflict-modal__summary');
      for (const [label, counts] of [['本机', result.local], ['账户', result.account]]) {
        summary.append(make('div', '', label + '：' + counts.entries + ' 个配置，' + counts.groups + ' 个标签'));
      }
      body.append(make('p', '', '本机与账户数据存在差异。使用账户数据会替换本机目录，使用本机数据会覆盖账户目录，合并会将结果保存到两端。'), summary);
      const colorChoices = new Map();
      if (result.colors.length) {
        const colors = make('div', 'sync-conflict-modal__colors');
        colors.append(make('p', '', '合并时使用以下标签颜色。'));
        for (const [index, conflict] of result.colors.entries()) {
          const row = make('div', 'sync-conflict-modal__color-row');
          row.append(make('span', '', conflict.name));
          for (const [side, label, color] of [
            ['local', '本机颜色', conflict.localColor], ['account', '账户颜色', conflict.accountColor],
          ]) {
            const option = make('label');
            const input = make('input');
            input.type = 'radio';
            input.name = 'sync-color-' + index;
            input.checked = side === 'local';
            input.addEventListener('change', () => colorChoices.set(conflict.accountId, side));
            const sample = make('span', 'category-color-dot');
            sample.style.backgroundColor = groupColor({ color });
            sample.setAttribute('aria-hidden', 'true');
            option.append(input, sample, make('span', '', label));
            row.append(option);
          }
          colors.append(row);
        }
        body.append(colors);
      }
      child.scroll.append(body);
      child.footer.append(closeButton(child, '取消'));
      for (const [choice, label, glyph] of [
        ['account', '使用账户数据', 'cloud-arrow-down'], ['local', '使用本机数据', 'laptop'], ['merge', '合并', 'code-merge'],
      ]) {
        child.footer.append(button(label, () => run(child, async () => {
          const message = await result.resolve(choice, colorChoices);
          pane.status.textContent = message;
        }, undefined, () => {
          syncStatus();
          child.dialog.close();
        }), glyph));
      }
      child.open();
    }
    const pull = button('从账户同步', () => synchronize('pull'), 'cloud-arrow-down');
    const push = button('同步到账户', () => synchronize('push'), 'cloud-arrow-up');
    pull.disabled = push.disabled = !storage.canSync;
    controls.append(pull, push);
    sync.append(state, time, controls);
    wrap.append(button('导出', download, 'file-export'), button('导入', () => file.click(), 'file-import'),
      button('清空配置', clear, 'trash-can'), file, sync);
    pane.scroll.append(wrap);
    pane.footer.append(closeButton(pane));
    syncStatus();
    pane.open();
  }

  function detection() {
    const pane = popup('检测');
    const list = make('div', 'secretKeyManagerList');
    const rows = storage.catalog.entries;
    const hints = make('p', 'st-native-hint', '检测站点的模型列表及记录中的模型 ID。结果供核对，配置会保留。');
    pane.scroll.append(hints, list);
    pane.footer.append(closeButton(pane));
    pane.open();
    run(pane, async () => {
      const requests = new Map();
      for (const row of rows) {
        const id = JSON.stringify([row.source, row.url, row.key]);
        if (!requests.has(id)) {
          requests.set(id, discoverModels(row, host.fetch.bind(host)).then(models => ({ models }), error => ({ error })));
        }
        const { models, error } = await requests.get(id);
        const result = error ? error.message : row.model && !models.includes(row.model) ? '列表中未找到此模型' : '模型列表可读取';
        list.append(make('div', 'secretKeyManagerItem', rowTitle(row) + ' · ' + result));
      }
      return rows.length ? '已检测 ' + rows.length + ' 条配置。' : '暂无配置。';
    });
  }
  return () => {
    if (main.dialog.open) return;
    main.status.textContent = '';
    refresh();
    main.open();
  };
}

