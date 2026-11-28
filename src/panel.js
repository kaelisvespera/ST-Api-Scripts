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
  const theme = createCatalogTheme(host, storage);
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
    let backdropPointer = null;
    const hitsBackdrop = event => {
      if (event.target !== dialog) return false;
      const { left, right, top, bottom } = dialog.getBoundingClientRect();
      return event.clientX < left || event.clientX >= right || event.clientY < top || event.clientY >= bottom;
    };
    // Native dialogs retarget backdrop events to the dialog itself. Require
    // both ends outside so a drag across its edge does not dismiss it.
    dialog.addEventListener('pointerdown', event => {
      if (!event.isPrimary || event.button !== 0) return;
      backdropPointer = !busy && hitsBackdrop(event) ? event.pointerId : null;
    });
    dialog.addEventListener('pointercancel', event => {
      if (event.pointerId === backdropPointer) backdropPointer = null;
    });
    dialog.addEventListener('click', event => {
      const startedOutside = backdropPointer !== null
        && (event.pointerId === undefined || event.pointerId === backdropPointer);
      backdropPointer = null;
      if (!startedOutside || !event.detail || busy || !hitsBackdrop(event)) return;
      event.stopPropagation();
      dialog.close();
    });
    dialog.addEventListener('close', () => { backdropPointer = null; });
    dialog.addEventListener('close', () => {
      if (!main) dialog.remove();
    });
    doc.body.append(dialog);
    return {
      dialog, heading, scroll, footer, status,
      open() {
        theme.applyDialog(dialog);
        dialog.showModal();
      },
    };
  }
  async function run(pane, action, success, done) {
    if (busy) return;
    busy = true;
    const controls = [...pane.dialog.querySelectorAll('button,input,select,textarea')].filter(item => !item.disabled);
    for (const control of controls) control.disabled = true;
    try {
      try {
        const result = await action();
        pane.status.textContent = success ?? result ?? '';
      } finally {
        for (const control of controls) control.disabled = false;
        busy = false;
      }
      done?.();
    } catch (error) {
      pane.status.textContent = error.message || '操作失败，原有配置已保留。';
    }
  }
  const main = popup('API 管理器', 'large', true);
  if (host.__TAURITAVERN__) main.dialog.dataset.catalogHost = 'tt';
  const version = make('span', 'toolbar-version', catalogPanelVersion);
  version.setAttribute('aria-label', '当前版本');
  main.footer.classList.add('catalog-main-footer');
  main.footer.append(version, closeButton(main));
  const unassigned = Symbol('uncategorized');
  let sortingGroup;
  const expandedRows = new Set();
  const disclosureChecks = new Map();
  const disclosureResize = new host.ResizeObserver(entries => {
    for (const { target } of entries) disclosureChecks.get(target)?.();
  });
  function resetDisclosures() {
    disclosureResize.disconnect();
    disclosureChecks.clear();
  }
  doc.fonts?.addEventListener('loadingdone', () => {
    for (const check of disclosureChecks.values()) check();
  });
  const groupKey = group => group?.id ?? unassigned;
  const focusSortToggle = id => [...main.scroll.querySelectorAll('.catalog-sort-toggle')]
    .find(control => control.dataset.groupId === (id === unassigned ? '' : id))?.focus();
  main.dialog.addEventListener('cancel', event => {
    if (sortingGroup === undefined || busy) return;
    event.preventDefault();
    const previous = sortingGroup;
    sortingGroup = undefined;
    refresh();
    focusSortToggle(previous);
  });
  main.dialog.addEventListener('close', () => {
    sortingGroup = undefined;
    expandedRows.clear();
    if (!main.dialog.open) resetDisclosures();
  });
  const collapsed = new Set(storage.collapsedGroups.map(id => id === null ? unassigned : id));
  const toolbar = make('div', 'api-manager-toolbar');
  const managerButton = button('API 管理', manager, 'layer-group');
  managerButton.classList.add('catalog-toolbar-primary');
  toolbar.append(managerButton, button('检测', detection, 'bolt'), button('设置', settings, 'gear'));
  const searchLabel = '搜索模型名称或备注';
  const mainSearch = fieldInput('', searchLabel, { type: 'search', placeholder: searchLabel });
  mainSearch.classList.add('catalog-main-search');
  let searchQuery = '';
  const searchCollapsed = new Set();
  function updateMainSearch(event) {
    if (event.isComposing) return;
    const query = mainSearch.value.trim().toLowerCase();
    if (query === searchQuery) return;
    searchQuery = query;
    searchCollapsed.clear();
    sortingGroup = undefined;
    refresh();
    main.scroll.scrollTop = 0;
  }
  mainSearch.addEventListener('input', updateMainSearch);
  mainSearch.addEventListener('compositionend', updateMainSearch);
  main.heading.append(toolbar, mainSearch);
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
  function colorGroupHeading(heading, group) {
    heading.classList.add('catalog-colored-group-heading');
    const rail = make('span', 'catalog-group-rail');
    rail.style.backgroundColor = groupColor(group);
    rail.setAttribute('aria-hidden', 'true');
    heading.append(rail);
  }
  function groupMarker(group) {
    const iconName = isGroupIcon(group.icon) ? group.icon : undefined;
    const image = iconName && catalogTagIconImages[iconName];
    const marker = iconName
      ? make(image ? 'img' : 'span', 'catalog-tag-icon catalog-tag-icon--' + iconName)
      : make('span', 'category-color-dot');
    if (image) {
      marker.src = image;
      marker.alt = '';
    } else if (!iconName) {
      marker.style.backgroundColor = groupColor(group);
    }
    marker.setAttribute('aria-hidden', 'true');
    return marker;
  }
  function groupHeadingMarker(group) {
    const slot = make('span', 'catalog-group-marker-slot');
    slot.append(groupMarker(group));
    return slot;
  }
  function activeGroupKey({ entries, groups }) {
    const activeRow = entries.find(row => row.id === connection.activeRowId());
    if (!activeRow) return;
    const appliedGroup = connection.activeGroupId();
    if (activeRow.groupIds.includes(appliedGroup)) return appliedGroup;
    // If the source tag is absent, use the first current tag in catalog order.
    return groupKey(groups.find(group => activeRow.groupIds.includes(group.id)));
  }
  function appliedBadge() {
    const badge = make('span', 'active-badge-sm');
    badge.append(icon('check'), '已应用');
    return badge;
  }
  function tagIconPicker(selection) {
    const field = make('fieldset', 'catalog-tag-icon-picker');
    field.append(make('legend', '', '标签图标'));
    const choices = make('div', 'catalog-tag-icon-choices');
    const radios = [];
    for (const [value, label] of [['', '色点'], ...groupIconNames]) {
      const option = make('label', 'catalog-tag-icon-choice');
      const input = make('input');
      input.type = 'radio';
      input.name = 'catalog-tag-icon';
      input.value = value;
      input.checked = value === (selection ?? '');
      radios.push(input);
      option.append(input);
      if (value) option.append(groupMarker({ icon: value }));
      option.append(make('span', '', label));
      choices.append(option);
    }
    field.append(choices);
    return {
      field,
      value: () => radios.find(input => input.checked)?.value || undefined,
    };
  }
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
  // Reorder only through dedicated controls. The rest of each row keeps its
  // normal touch scrolling, selection and apply/edit behavior.
  function sortable(pane, list, items, commit) {
    const nodes = [...list.children];
    const move = (from, to) => {
      if (busy || from === to || to < 0 || to >= items.length) return;
      const ids = items.map(item => item.id);
      ids.splice(to, 0, ids.splice(from, 1)[0]);
      commit(ids, items[from].id);
    };
    nodes.forEach((node, index) => {
      const controls = make('div', 'catalog-sort-controls');
      const handle = button('拖动排序：' + items[index].name, null, 'grip-vertical', true);
      handle.classList.add('catalog-sort-handle');
      handle.title += '（也可按上下方向键）';
      const up = button('上移：' + items[index].name, () => move(index, index - 1), 'arrow-up', true);
      const down = button('下移：' + items[index].name, () => move(index, index + 1), 'arrow-down', true);
      up.disabled = index === 0;
      down.disabled = index === nodes.length - 1;
      handle.disabled = nodes.length < 2;
      controls.append(handle, up, down);
      if (node.classList.contains('catalog-config-card')) node.append(controls);
      else node.prepend(controls);
      handle.addEventListener('keydown', event => {
        if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
        event.preventDefault();
        move(index, index + (event.key === 'ArrowUp' ? -1 : 1));
      });
      handle.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); });
      handle.addEventListener('pointerdown', event => {
        if (busy || !event.isPrimary || event.button !== 0) return;
        event.preventDefault();
        handle.focus({ preventScroll: true });
        const pointerId = event.pointerId;
        const startY = event.clientY;
        let target = index, dragging = false, frame = 0, lastPointer;
        const clearMarks = () => nodes.forEach(row => row.classList.remove('catalog-sort-before', 'catalog-sort-after'));
        const update = e => {
          if (e.pointerId !== pointerId) return;
          if (!dragging && Math.abs(e.clientY - startY) < 5) return;
          dragging = true;
          lastPointer = e;
          if (!frame) frame = host.requestAnimationFrame(scrollFrame);
          node.classList.add('catalog-sorting');
          clearMarks();
          const bounds = list.getBoundingClientRect();
          const viewport = pane.scroll.getBoundingClientRect();
          if (e.clientX < bounds.left || e.clientX > bounds.right || e.clientY < viewport.top || e.clientY > viewport.bottom) {
            target = index; return;
          }
          const others = nodes.filter(row => row !== node);
          let slot = others.findIndex(row => { const box = row.getBoundingClientRect(); return e.clientY < box.top + box.height / 2; });
          if (slot < 0) slot = others.length;
          target = slot;
          if (target !== index) {
            const marker = others[slot] ?? others[others.length - 1];
            marker?.classList.add(slot < others.length ? 'catalog-sort-before' : 'catalog-sort-after');
          }
        };
        const scrollFrame = () => {
          if (!node.isConnected || !pane.dialog.open) { finish(false); return; }
          const viewport = pane.scroll.getBoundingClientRect();
          const bounds = list.getBoundingClientRect();
          const { clientX: x, clientY: y } = lastPointer;
          const speed = x < bounds.left || x > bounds.right || y < viewport.top || y > viewport.bottom ? 0
            : y < viewport.top + 36 ? -10 : y > viewport.bottom - 36 ? 10 : 0;
          if (speed) { pane.scroll.scrollTop += speed; update(lastPointer); }
          frame = host.requestAnimationFrame(scrollFrame);
        };
        const finish = apply => {
          host.cancelAnimationFrame(frame); frame = 0;
          handle.removeEventListener('pointermove', update);
          handle.removeEventListener('pointerup', release);
          handle.removeEventListener('pointercancel', cancel);
          handle.removeEventListener('lostpointercapture', cancel);
          doc.removeEventListener('keydown', escape, true);
          pane.dialog.removeEventListener('close', cancel);
          clearMarks(); node.classList.remove('catalog-sorting');
          if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
          if (apply && dragging && node.isConnected) move(index, target);
        };
        const release = e => { if (e.pointerId === pointerId) { update(e); finish(true); } };
        const cancel = () => finish(false);
        const escape = e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancel(); } };
        handle.addEventListener('pointermove', update);
        handle.addEventListener('pointerup', release);
        handle.addEventListener('pointercancel', cancel);
        handle.addEventListener('lostpointercapture', cancel);
        doc.addEventListener('keydown', escape, true);
        pane.dialog.addEventListener('close', cancel);
        handle.setPointerCapture(pointerId);
      });
    });
  }
  function deleteRows(pane, rows, message, done = refresh) {
    if (!host.confirm(message)) return;
    const ids = new Set(rows.map(row => row.id));
    return save(pane, catalog => ({ ...catalog, entries: catalog.entries.filter(row => !ids.has(row.id)) }),
      '已删除配置。', done);
  }
  function rowMetadata(row, { keyLabel, keyNote, alias }, compactNotes = true) {
    const meta = make('span', 'catalog-card-meta');
    meta.append(make('span', 'catalog-card-site', row.site));
    if (keyLabel) meta.append(make('span', 'catalog-key-label', keyLabel));
    if (compactNotes) {
      for (const [value, glyph] of [[keyNote, 'key'], [row.modelNote, 'comment']]) {
        if (!value) continue;
        const note = make('span', 'catalog-meta-note');
        note.append(icon(glyph), make('span', '', value));
        meta.append(note);
      }
    }
    if (alias) meta.append(make('span', 'catalog-card-alias', alias));
    return meta;
  }
  function rowFields(className, entries) {
    const fields = make('dl', className);
    for (const [label, value] of entries) {
      if (value) fields.append(make('dt', '', label), make('dd', '', value));
    }
    return fields;
  }
  function focusRowAction(row, group, selector = '.catalog-card-edit', options) {
    const cards = [...main.scroll.querySelectorAll('.catalog-config-card')].filter(card =>
      card.dataset.entryId === row.id && card.getClientRects().length);
    const card = cards.find(card => card.dataset.groupId === (group?.id ?? '')) ?? cards[0];
    (card?.querySelector(selector) ?? main.heading.querySelector('button'))?.focus(options);
  }
  function rowActions(row, group) {
    const wrapper = make('div', 'secretKeyManagerItemActions');
    const actions = make('div', 'secretKeyManagerItemActionsRow catalog-card-actions');
    const action = (label, click, glyph) => {
      const control = button(label, click, glyph, true);
      if (glyph !== 'trash') control.firstElementChild.classList.add('fa-fw');
      return control;
    };
    const refreshAndFocus = selector => {
      refresh();
      focusRowAction(row, group, selector);
    };
    const apply = action('应用', () => run(main, () => connection.apply(row, group?.id ?? null), undefined, () => {
      refresh();
      focusRowAction(row, group, '.catalog-card-apply', { preventScroll: true });
    }), 'check');
    apply.classList.add('catalog-card-apply');
    const editButton = action('编辑', event => {
      event.currentTarget.focus({ preventScroll: true });
      edit([row], () => focusRowAction(row, group));
    }, 'pen-to-square');
    editButton.classList.add('catalog-card-edit');
    const groups = action('管理分组', event => {
      event.currentTarget.focus({ preventScroll: true });
      rowGroups(row, () => focusRowAction(row, group, '.catalog-card-groups'));
    }, 'tag');
    groups.classList.add('catalog-card-groups');
    actions.append(apply, editButton, groups);
    if (group) {
      const remove = action('移出当前分组', () => {
        save(main, catalog => ({
          ...catalog, entries: catalog.entries.map(entry => entry.id === row.id
            ? { ...entry, groupIds: entry.groupIds.filter(id => id !== group.id) } : entry),
        }), '已移出标签分组。', () => refreshAndFocus());
      }, 'xmark');
      remove.title = '移出标签分组';
      actions.append(remove);
    }
    actions.append(action('删除', () => deleteRows(main, [row], '删除这一条配置？', () => refreshAndFocus()), 'trash'));
    wrapper.append(actions);
    return wrapper;
  }
  function rowNode(row, group, presentation, drawer) {
    const card = make('div', 'secretKeyManagerItem catalog-config-card');
    card.dataset.entryId = row.id;
    card.dataset.groupId = group?.id ?? '';
    const title = make('div', 'catalog-card-title');
    const model = row.model || '未选择模型';
    const modelText = make('span', 'catalog-card-model', model);
    const disclosure = make('button', 'catalog-card-disclosure');
    disclosure.type = 'button';
    disclosure.title = '展开或收起完整信息';
    disclosure.setAttribute('aria-label', model);
    disclosure.append(icon('angle-right'));
    title.append(modelText, disclosure);

    const information = make('div', 'catalog-card-information');
    const { keyLabel, keyNote, alias } = presentation;
    const meta = rowMetadata(row, presentation, false);
    if (connection.activeRowId() === row.id) {
      card.classList.add('secretKeyManagerItem--applied');
      meta.append(appliedBadge());
    }
    information.append(meta);
    const notes = rowFields('catalog-card-notes', [['密钥备注', keyNote], ['模型备注', row.modelNote]]);
    if (notes.childElementCount) information.append(notes);
    const visibleFields = [model, row.site, keyLabel, keyNote, row.modelNote];
    // The current site and model already show both parts of a generated title.
    const repeatsSiteAndModel = row.name?.replace(/[ \t]+/g, ' ') === rowTitle(row).replace(/[ \t]+/g, ' ');
    const originalTitle = row.name && !repeatsSiteAndModel && row.name !== alias && !visibleFields.includes(row.name)
      ? rowFields('catalog-card-original', [['原条目标题', row.name]]) : null;
    if (originalTitle) information.append(originalTitle);
    if (originalTitle || visibleFields.includes(alias)) {
      meta.querySelector('.catalog-card-alias')?.classList.add('catalog-card-alias-summary');
    }
    card.append(title, information, rowActions(row, group));

    const expansionKey = JSON.stringify([row.id, group?.id ?? null]);
    const previewFields = [modelText, ...meta.querySelectorAll('.catalog-card-site, .catalog-card-alias'),
      ...notes.querySelectorAll('dd')];
    const hasLineBreak = previewFields.some(field => /[\r\n]/.test(field.textContent.trim()));
    const checkDisclosure = () => {
      if (!main.dialog.open || !drawer.open) return;
      const expanded = expandedRows.has(expansionKey);
      // Single-line text can extend past the line box vertically without hiding any characters.
      const canExpand = expanded || Boolean(originalTitle) || hasLineBreak
        || previewFields.some(field => field.scrollWidth > field.clientWidth);
      if (disclosure.hidden === !canExpand) return;
      const restoreFocus = !canExpand && doc.activeElement === disclosure;
      disclosure.hidden = !canExpand;
      if (restoreFocus) {
        title.tabIndex = -1;
        title.focus({ preventScroll: true });
      }
    };
    const updateExpansion = expanded => {
      card.classList.toggle('catalog-card-expanded', expanded);
      disclosure.setAttribute('aria-expanded', String(expanded));
      if (originalTitle) originalTitle.hidden = !expanded;
    };
    const expanded = expandedRows.has(expansionKey);
    disclosure.hidden = !expanded && !originalTitle && !hasLineBreak;
    updateExpansion(expanded);
    disclosureChecks.set(card, checkDisclosure);
    disclosureResize.observe(card);
    title.addEventListener('click', event => {
      if (disclosure.hidden || (!disclosure.contains(event.target) && host.getSelection()?.toString())) return;
      disclosure.focus({ preventScroll: true });
      const next = !expandedRows.has(expansionKey);
      if (next) expandedRows.add(expansionKey); else expandedRows.delete(expansionKey);
      updateExpansion(next);
      checkDisclosure();
    });
    card.classList.toggle('catalog-card-sort-mode', sortingGroup === groupKey(group));
    card.addEventListener('click', event => {
      if (sortingGroup === groupKey(group) || title.contains(event.target)
        || event.target.closest('button,input,a,select,textarea')
        || (expandedRows.has(expansionKey) && information.contains(event.target))
        || host.getSelection()?.toString()) return;
      card.querySelector('.catalog-card-apply').click();
    });
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
  // Keep the original summary solid even when the host styles drawers as glass.
  function keepGroupLayerOpaque(layer) {
    layer.style.setProperty('opacity', '1', 'important');
    layer.style.setProperty('filter', 'none', 'important');
    layer.style.setProperty('mix-blend-mode', 'normal', 'important');
    layer.style.setProperty('backdrop-filter', 'none', 'important');
    layer.style.setProperty('-webkit-backdrop-filter', 'none', 'important');
  }
  function refresh() {
    resetDisclosures();
    const catalog = storage.catalog;
    const { entries, groups } = catalog;
    const activeGroup = activeGroupKey(catalog);
    const stickyExpandedGroups = storage.stickyExpandedGroups;
    if (sortingGroup !== undefined && sortingGroup !== unassigned && !groups.some(group => group.id === sortingGroup)) {
      sortingGroup = undefined;
    }
    const presentations = rowPresentations(sites());
    const groupCollapsed = searchQuery ? searchCollapsed : collapsed;
    let matching;
    if (searchQuery) {
      const terms = searchQuery.split(/\s+/);
      matching = new Set(entries.filter(row => {
        const text = [row.model, row.name, row.modelNote, presentations.get(row.id)?.keyNote].join(' ').toLowerCase();
        return terms.every(term => text.includes(term));
      }).map(row => row.id));
    }
    const panel = make('div', 'api-manager-panel');
    const list = make('div', 'api-config-list');
    list.classList.toggle('catalog-sticky-expanded', stickyExpandedGroups);
    panel.append(list);
    const sections = [{ id: unassigned, name: '未分类' }, ...groups];
    for (const section of sections) {
      const isUnassigned = section.id === unassigned;
      const orderedRows = orderedGroupEntries(catalog, isUnassigned ? null : section.id);
      const rows = matching ? orderedRows.filter(row => matching.has(row.id)) : orderedRows;
      if (sortingGroup === section.id && (!rows.length || groupCollapsed.has(section.id))) sortingGroup = undefined;
      if (!rows.length && (matching || isUnassigned)) continue;
      const active = section.id === activeGroup;
      const sticky = stickyExpandedGroups && rows.length > 0;
      const drawer = make('details', 'inline-drawer');
      drawer.dataset.groupId = isUnassigned ? '' : section.id;
      drawer.toggleAttribute('data-catalog-empty', !rows.length);
      drawer.open = !groupCollapsed.has(section.id);
      // Native details owns the state. The host delegates .inline-drawer-toggle
      // and would independently hide the same content with inline styles.
      const header = make('summary', 'inline-drawer-header catalog-group-heading');
      const label = make('span', 'catalog-group-label');
      const title = make('span', 'catalog-group-title');
      if (!isUnassigned) {
        colorGroupHeading(header, section);
        title.append(groupHeadingMarker(section));
      }
      title.append(make('b', '', section.name), make('small', 'category-count', '(' + rows.length + ')'));
      label.append(title);
      if (active) {
        header.classList.add('catalog-group-active');
        const badge = appliedBadge();
        badge.classList.add('catalog-group-active-badge');
        label.append(badge);
        header.style.setProperty('border-color', 'var(--catalog-applied-accent)', 'important');
      }
      if (sticky || active) {
        keepGroupLayerOpaque(drawer);
        keepGroupLayerOpaque(header);
        header.style.setProperty('background', 'var(--catalog-group-heading-fill, var(--catalog-group-surface))', 'important');
        header.style.setProperty('margin-block', '0', 'important');
      }
      if (sticky) drawer.style.setProperty('overflow', 'visible', 'important');
      const arrow = icon(drawer.open ? 'circle-chevron-up' : 'circle-chevron-down');
      arrow.classList.add('inline-drawer-icon');
      const sortToggle = button(sortingGroup === section.id ? '完成' : '排序', event => {
        event.preventDefault(); event.stopPropagation();
        if (busy) return;
        sortingGroup = sortingGroup === section.id ? undefined : section.id;
        if (sortingGroup !== undefined) groupCollapsed.delete(section.id);
        refresh();
        focusSortToggle(section.id);
      }, sortingGroup === section.id ? 'check' : 'sort');
      sortToggle.classList.add('catalog-sort-toggle');
      sortToggle.dataset.groupId = isUnassigned ? '' : section.id;
      sortToggle.setAttribute('aria-pressed', String(sortingGroup === section.id));
      sortToggle.disabled = rows.length < 2 && sortingGroup !== section.id;
      header.append(label, sortToggle, arrow);
      const wrap = make('div', 'inline-drawer-content');
      let revealCollapsedHeader = false;
      if (sticky) {
        header.addEventListener('click', () => {
          if (!drawer.open) return;
          const padding = Number.parseFloat(host.getComputedStyle(drawer).paddingBlockStart);
          const naturalTop = drawer.getBoundingClientRect().top + drawer.clientTop + padding;
          revealCollapsedHeader = header.getBoundingClientRect().top > naturalTop + 1;
        });
        // Native focus scrolling does not account for the summary covering the card.
        wrap.addEventListener('focusin', event => {
          const viewportTop = main.scroll.getBoundingClientRect().top + main.scroll.clientTop;
          const { top, bottom } = header.getBoundingClientRect();
          if (top > viewportTop + 1 || bottom <= viewportTop) return;
          const targetTop = event.target.getBoundingClientRect().top;
          if (targetTop < bottom) main.scroll.scrollBy({ top: targetTop - bottom - 4, behavior: 'instant' });
        });
      }
      drawer.addEventListener('toggle', () => {
        if (!drawer.isConnected) return;
        const changed = groupCollapsed.has(section.id) === drawer.open;
        if (revealCollapsedHeader && !drawer.open) {
          // Once sticky positioning ends, keep the title the user just activated in view.
          const viewportTop = main.scroll.getBoundingClientRect().top + main.scroll.clientTop;
          main.scroll.scrollBy({ top: header.getBoundingClientRect().top - viewportTop, behavior: 'instant' });
        }
        revealCollapsedHeader = false;
        if (drawer.open) {
          groupCollapsed.delete(section.id);
          for (const card of cards.children) disclosureChecks.get(card)?.();
        } else {
          groupCollapsed.add(section.id);
          if (sortingGroup === section.id) {
            sortingGroup = undefined;
            refresh();
            focusSortToggle(section.id);
          }
        }
        arrow.classList.toggle('fa-circle-chevron-up', drawer.open);
        arrow.classList.toggle('fa-circle-chevron-down', !drawer.open);
        if (!matching && changed) void storage.setGroupCollapsed(isUnassigned ? null : section.id, !drawer.open)
          .catch(error => { main.status.textContent = error.message; });
      });
      const cards = make('div', 'secretKeyManagerList');
      if (rows.length) cards.append(...rows.map(row => rowNode(row, isUnassigned ? undefined : section, presentations.get(row.id), drawer)));
      else cards.append(make('p', 'st-orb-empty-state', '此标签暂无配置'));
      if (rows.length && sortingGroup === section.id) sortable(main, cards, rows.map(row => ({ id: row.id, name: row.model || row.site })), (ids, movedId) => {
        save(main, catalog => reorderGroupEntries(catalog, isUnassigned ? null : section.id, ids),
          '已保存此分组内的顺序。', () => {
            refresh();
            focusRowAction({ id: movedId }, isUnassigned ? undefined : section, '.catalog-sort-handle');
          });
      });
      if (sortingGroup === section.id) wrap.append(make('p', 'catalog-sort-help', '拖动排序柄或使用上下按钮、方向键调整，仅影响当前分组；每次移动自动保存。'));
      wrap.append(cards);
      drawer.append(header, wrap);
      list.append(drawer);
    }
    if (!list.childElementCount || matching?.size === 0) list.append(make('p', 'api-keys-empty',
      matching ? '没有匹配的模型，试试其他关键词。' : '暂无 API 配置'));
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
    host, storage, popup, make, button, fieldInput, closeButton, run, refresh, groupMarker,
  }, rows, afterSave);

  function settings(event) {
    event.currentTarget.focus({ preventScroll: true });
    const pane = popup('设置', 'small');
    const list = make('div', 'catalog-settings-list');
    const sections = [
      ['标签设置', '管理分组、颜色和图标', 'tags', tagSettings],
      ['主题设置', '日夜模式与透明度', 'palette', () => theme.openSettings({ popup, make, button, closeButton })],
      ['数据', '导入、导出、同步和入口', 'database', dataPanel],
    ];
    for (const [label, description, glyph, open] of sections) {
      const entry = make('button', 'menu_button interactable catalog-settings-entry');
      entry.type = 'button';
      entry.setAttribute('aria-label', label);
      entry.setAttribute('aria-haspopup', 'dialog');
      const copy = make('span', 'catalog-settings-entry-copy');
      const detail = make('span', 'catalog-settings-entry-description', description);
      detail.id = 'catalog-settings-' + glyph + '-description';
      entry.setAttribute('aria-describedby', detail.id);
      copy.append(make('span', 'catalog-settings-entry-label', label), detail);
      const chevron = icon('chevron-right');
      chevron.classList.add('catalog-settings-entry-chevron');
      entry.append(icon(glyph), copy, chevron);
      entry.addEventListener('click', () => {
        entry.focus({ preventScroll: true });
        open();
      });
      list.append(entry);
    }
    const stickyLabel = make('label', 'catalog-sticky-groups-toggle');
    const sticky = make('input');
    sticky.type = 'checkbox';
    sticky.checked = storage.stickyExpandedGroups;
    stickyLabel.append(make('span', '', '展开分组标题吸顶'), sticky);
    sticky.addEventListener('change', async () => {
      await run(pane, () => storage.setStickyExpandedGroups(sticky.checked), undefined, refresh);
      sticky.checked = storage.stickyExpandedGroups;
      if (pane.dialog.open) sticky.focus({ preventScroll: true });
    });
    pane.scroll.append(list, stickyLabel);
    pane.footer.append(closeButton(pane));
    pane.open();
  }
  function tagOption(group, input, extras = []) {
    const tag = make('span', 'category-tag menu_button menu_button_icon');
    const label = make('label', 'catalog-tag-label');
    label.append(input, groupMarker(group), make('span', 'category-tag-name', group.name));
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
    const addTags = button('添加标签', () => changeTags('add'));
    const removeTags = button('移除标签', () => changeTags('remove'));
    const clearTags = button('清空标签', () => {
      if (host.confirm('清空所选配置的标签？')) changeTags('clear');
    });
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
    const form = make('form');
    const fields = make('div', 'new-category-row');
    const name = fieldInput('', '新分组名称', { placeholder: '输入分类名称（如：Claude、GPT、本地模型）', required: true });
    name.classList.add('new-category-input');
    const color = fieldInput('#3b82f6', '选择颜色', { type: 'color' });
    color.className = 'color-picker';
    const add = button('新建分类', undefined, 'plus', true);
    add.type = 'submit';
    const appearance = tagIconPicker();
    fields.append(name, color, add);
    form.append(fields, appearance.field);
    form.addEventListener('submit', event => {
      event.preventDefault();
      const value = name.value.trim();
      if (!value) return;
      save(pane, catalog => ({
        ...catalog, groups: [...catalog.groups, { id: makeId(), name: value, color: color.value, icon: appearance.value() }],
      }), '已创建分组。', () => { name.value = ''; renderTags(); refresh(); });
    });
    const grid = make('div', 'category-tag-grid catalog-sort-tags');
    heading.append(make('small', 'st-native-hint', '拖动排序柄或使用上下按钮，调整主界面的分组顺序。'));
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
        rename.title = '重命名、改色或更换图标';
        const remove = button('删除标签', () => {
          if (!host.confirm('删除这个标签？其中的配置会保留。')) return;
          save(pane, catalog => ({
            ...catalog, groups: catalog.groups.filter(item => item.id !== group.id),
            entries: catalog.entries.map(row => ({ ...row, groupIds: row.groupIds.filter(id => id !== group.id) })),
          }), '已删除分组。', () => { selectedTags.delete(group.id); renderTags(); renderRows(); refresh(); });
        }, 'trash', true);
        rename.classList.add('category-tag-delete');
        remove.classList.add('category-tag-delete');
        const tag = tagOption(group, control, [rename, remove]);
        tag.dataset.sortId = group.id;
        grid.append(tag);
      }
      if (!grid.childElementCount) grid.append(make('p', 'category-tag-grid__empty', '暂无标签'));
      else sortable(pane, grid, storage.catalog.groups, (ids, movedId) => {
        save(pane, catalog => {
          const byId = new Map(catalog.groups.map(group => [group.id, group]));
          return { ...catalog, groups: ids.map(id => byId.get(id)) };
        }, '已保存标签和主界面的分组顺序。', () => {
          renderTags(); refresh();
          [...grid.children].find(node => node.dataset.sortId === movedId)?.querySelector('.catalog-sort-handle')?.focus();
        });
      });
      setCount();
    }
    function editTag(group) {
      const child = popup('编辑标签');
      const name = fieldInput(group.name, '标签名称');
      const color = fieldInput(groupColor(group), '选择颜色', { type: 'color' });
      const row = make('div', 'new-category-row');
      color.className = 'color-picker';
      const appearance = tagIconPicker(group.icon);
      row.append(name, color);
      child.scroll.append(row, appearance.field);
      child.footer.append(closeButton(child, '取消'), button('保存', () => {
        const value = name.value.trim();
        if (!value) return;
        save(child, catalog => ({
          ...catalog, groups: catalog.groups.map(item => item.id === group.id ? { ...item, name: value, color: color.value, icon: appearance.value() } : item),
        }), '已保存标签。', () => { renderTags(); refresh(); child.dialog.close(); });
      }, 'check'));
      child.open();
    }
    const clearSelectedTags = button('清空', () => { selectedTags.clear(); renderTags(); }, 'eraser');
    tagPanel.append(heading, form, clearSelectedTags, grid);
    wrap.append(searchSection, toolbar, list, tagPanel);
    pane.scroll.append(wrap);
    pane.footer.classList.add('catalog-tag-actions');
    for (const controls of [[button('取消', () => pane.dialog.close()), addTags], [removeTags, clearTags]]) {
      const pair = make('div', 'catalog-tag-action-pair');
      pair.append(...controls);
      pane.footer.append(pair);
    }
    renderRows();
    renderTags();
    pane.open();
  }

  function dataPanel() {
    const pane = popup('数据', 'small');
    const wrap = make('div', 'data-actions-modal');
    const entryOptions = make('fieldset', 'catalog-entry-options');
    entryOptions.append(make('legend', '', '入口设置'));
    const entryStatus = make('p', 'st-native-hint');
    const entryRadios = [];
    const renderEntryOptions = () => {
      const current = storage.entryPoints;
      for (const [input, value] of entryRadios) input.checked = current.wand === value.wand && current.qr === value.qr;
      entryStatus.textContent = storage.entryPointStatus.message;
    };
    for (const [label, value] of [['魔法棒入口', { wand: true, qr: false }],
      ['QR 入口', { wand: false, qr: true }], ['同时启用', { wand: true, qr: true }]]) {
      const row = make('label');
      const input = make('input');
      input.type = 'radio'; input.name = 'catalog-entry-point';
      input.addEventListener('change', async () => {
        if (!input.checked) return;
        await run(pane, () => storage.setEntryPoints(value), '已保存入口设置。');
        renderEntryOptions();
      });
      entryRadios.push([input, value]);
      row.append(input, make('span', '', label)); entryOptions.append(row);
    }
    entryOptions.append(entryStatus, make('small', 'st-native-hint', '也可输入 /st-api-manager 打开。入口设置保存在当前酒馆，不随目录导出或账户同步。'));
    host.addEventListener('st-api-manager-entry-status-changed', renderEntryOptions);
    pane.dialog.addEventListener('close', () => host.removeEventListener('st-api-manager-entry-status-changed', renderEntryOptions), { once: true });
    renderEntryOptions();
    wrap.append(entryOptions);
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
      const options = make('div', 'import-mode-modal');
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
        const includesIcons = result.colors.some(conflict => conflict.localIcon || conflict.accountIcon);
        colors.append(make('p', '', includesIcons ? '请选择合并后的标签颜色和图标。' : '合并时使用以下标签颜色。'));
        for (const [index, conflict] of result.colors.entries()) {
          const row = make('div', 'sync-conflict-modal__color-row');
          row.append(make('span', '', conflict.name));
          const hasIcons = conflict.localIcon || conflict.accountIcon;
          for (const [side, label, color, iconName] of [
            ['local', hasIcons ? '本机外观' : '本机颜色', conflict.localColor, conflict.localIcon],
            ['account', hasIcons ? '账户外观' : '账户颜色', conflict.accountColor, conflict.accountIcon],
          ]) {
            const option = make('label');
            const input = make('input');
            input.type = 'radio';
            input.name = 'sync-color-' + index;
            input.checked = side === 'local';
            input.addEventListener('change', () => colorChoices.set(conflict.accountId, side));
            option.append(input, groupMarker({ color }));
            if (iconName) option.append(groupMarker({ icon: iconName }));
            option.append(make('span', '', label));
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
  function fillPluginForm(plan) {
    const pane = popup('填入插件 API', 'medium');
    if (plan.warning) {
      pane.scroll.append(make('p', 'st-native-hint', plan.warning));
      pane.footer.append(closeButton(pane, '取消'));
      pane.open();
      return;
    }
    const fields = plan.fields.map(({ kind, label }) => label || (kind === 'url' ? 'API 地址' : 'API 密钥'));
    const destination = plan.scopeLabel || '当前插件';
    const pluginExtraLabels = { includeBody: '主体附加参数', excludeBody: '排除参数', includeHeaders: '请求标头' };
    const supportedExtra = new Set(plan.extraFields ?? []);
    const modelHint = plan.modelField ? '已保存的模型名也会一并填入。' : '';
    pane.scroll.append(make('p', 'st-native-hint', '选择配置，将填入「' + destination + '」的 ' + fields.join('、') + '。' + modelHint));
    if (plan.fields.length === 1 && plan.fields[0].kind === 'key') {
      pane.scroll.append(make('p', 'st-native-hint', '仅填写密钥。请先确认插件当前的 API 地址与所选配置一致。'));
    }
    const search = fieldInput('', '搜索可填入的 API 配置', { type: 'search', placeholder: '搜索站点、模型或备注' });
    const list = make('div', 'catalog-fill-list');
    const presentations = rowPresentations(sites());
    search.classList.add('catalog-fill-search');
    pane.scroll.append(search, list);
    const pickerCollapsed = new Set(collapsed);
    function renderRow(row) {
      const { keyLabel, keyNote } = presentations.get(row.id) ?? {};
      const item = make('div', 'catalog-fill-row');
      const summary = make('div', 'catalog-fill-summary');
      const title = rowTitle(row) || '未命名配置';
      summary.append(make('strong', '', title));
      let endpointHost;
      try {
        endpointHost = endpointUrl(row.url.trim() || (Object.hasOwn(defaultEndpoints, row.source) ? defaultEndpoints[row.source] : '')).host;
      } catch { /* Some entries only contain a key. */ }
      const details = [endpointHost, keyLabel, keyNote, row.modelNote].filter(Boolean).join(' · ');
      if (details) summary.append(make('small', '', details));
      if (row.extra) {
        const configured = entryExtraFields.filter(name => row.extra[name]?.trim());
        const pending = configured.filter(name => supportedExtra.has(name));
        const nativeOnly = configured.filter(name => !supportedExtra.has(name));
        if (pending.length) summary.append(make('small', '', '一并填入：' + pending.map(name => pluginExtraLabels[name]).join('、')));
        if (nativeOnly.length) summary.append(make('small', '', '本表单无法填入：' + nativeOnly.map(name => pluginExtraLabels[name]).join('、')));
      }
      const fill = button('填入', () => run(pane, () => {
        const current = storage.catalog.entries.find(entry => entry.id === row.id);
        if (!current || current.url !== row.url || current.key !== row.key || current.source !== row.source ||
          (plan.modelField && current.model !== row.model) ||
          Boolean(current.extra) !== Boolean(row.extra) ||
          entryExtraFields.some(name => current.extra?.[name] !== row.extra?.[name])) {
          throw new Error('这条配置已变化，请关闭后重新选择。');
        }
        return plan.fill(current);
      }, undefined, () => {
        pane.dialog.close();
        plan.afterFill?.();
      }), 'paste');
      fill.setAttribute('aria-label', ['填入', title, keyLabel].filter(Boolean).join(' '));
      item.append(summary, fill);
      return item;
    }
    function render() {
      list.replaceChildren();
      const terms = search.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
      const catalog = storage.catalog;
      const matching = new Set(catalog.entries.filter(row => {
        const { keyLabel, keyNote, alias } = presentations.get(row.id) ?? {};
        const searchable = [row.site, row.model, keyLabel, keyNote, row.modelNote, alias].join(' ').toLowerCase();
        return terms.every(term => searchable.includes(term));
      }).map(row => row.id));
      for (const group of [{ id: unassigned, name: '未分类' }, ...catalog.groups]) {
        const rows = orderedGroupEntries(catalog, group.id === unassigned ? null : group.id)
          .filter(row => matching.has(row.id));
        if (!rows.length) continue;
        const section = make('details', 'catalog-fill-group');
        section.open = terms.length > 0 || !pickerCollapsed.has(group.id);
        const header = make('summary', 'catalog-fill-group-header catalog-group-heading');
        const title = make('b', 'catalog-fill-group-name', group.name);
        if (group.id !== unassigned) {
          colorGroupHeading(header, group);
          header.append(groupHeadingMarker(group));
        }
        const arrow = icon('chevron-right');
        arrow.classList.add('catalog-fill-group-arrow');
        header.append(title, make('small', 'category-count', '(' + rows.length + ')'), arrow);
        const items = make('div', 'catalog-fill-group-rows');
        items.append(...rows.map(renderRow));
        section.append(header, items);
        section.addEventListener('toggle', () => {
          if (terms.length || !section.isConnected) return;
          if (section.open) pickerCollapsed.delete(group.id);
          else pickerCollapsed.add(group.id);
        });
        list.append(section);
      }
      if (!list.childElementCount) list.append(make('p', 'api-keys-empty', '没有找到 API 配置。'));
    }
    search.addEventListener('input', render);
    pane.footer.append(closeButton(pane, '取消'));
    render();
    pane.open();
  }
  mountCatalogFormFill(host, fillPluginForm);
  return () => {
    if (main.dialog.open) return;
    main.status.textContent = '';
    mainSearch.value = '';
    searchQuery = '';
    searchCollapsed.clear();
    refresh();
    main.open();
  };
}

