function mountCatalogFormFill(host, showPicker) {
  const doc = host.document;
  const realm = doc.defaultView ?? host;
  const Input = realm.HTMLInputElement;
  const setValue = Input?.prototype && Object.getOwnPropertyDescriptor(Input.prototype, 'value')?.set;
  if (!setValue) return;
  const ownUI = '.st-api-manager, .catalog-form-fill-trigger, #st-api-manager-extension-button';
  const excluded = ownUI + ', #openai_settings, #rm_api_block, #send_form, #chat, #send_textarea, '
    + '#api_settings, #api_connections, #extensions_url, #extensions_api_key, #custom_api_url_text, '
    + '#api_key_custom, #api_key_openai, #api_key_deepseek, #api_key_makersuite, [inert], [aria-hidden="true"]';
  const scopeSelector = 'form, fieldset, dialog, [role="form"], [role="dialog"], .popup, .inline-drawer-content, '
    + '[data-extension], [data-extension-id], [data-extension-name], [data-plugin], [data-plugin-id], [data-plugin-name]';
  const fieldLabels = { url: 'API 地址', key: 'API Key' };
  let current;

  function insideExcluded(input) {
    for (let node = input; node; node = node.getRootNode().host) {
      if (node.closest(excluded)) return true;
    }
    return false;
  }

  function fieldKind(input) {
    if (!(input instanceof Input) || input.ownerDocument !== doc || !input.isConnected ||
      !['text', 'url', 'password'].includes(input.type) || input.matches(':disabled') || input.readOnly ||
      insideExcluded(input) || input.getClientRects().length === 0 ||
      input.checkVisibility?.({ checkOpacity: true, checkVisibilityCSS: true }) === false ||
      realm.getComputedStyle(input).visibility !== 'visible') return undefined;

    const labelRoot = input.getRootNode();
    const labelledBy = (input.getAttribute('aria-labelledby') ?? '').trim().split(/\s+/)
      .map(id => labelRoot.getElementById?.(id)?.textContent);
    // Classification uses field metadata only. An existing value, especially a key, is never read.
    const label = [...input.labels ?? []].map(element => element.textContent);
    const hints = [input.getAttribute('aria-label'), ...labelledBy, ...label,
      input.getAttribute('placeholder'), input.name, input.id]
      .filter(Boolean).map(text => text.slice(0, 200)
        .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2').replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim());
    const autocomplete = input.autocomplete.toLowerCase().split(/\s+/);
    if (autocomplete.some(value => ['username', 'current-password', 'new-password', 'one-time-code'].includes(value)) ||
      hints.some(text => /\b(?:login|sign in)\b|登录(?:密码|口令)/.test(text))) return undefined;

    const apiKey = input.type !== 'url' && hints.some(text => /\b(?:api\s*(?:key|token|secret)|(?:llm|openai|claude|gemini|deepseek|anthropic)\s+(?:key|token))\b|(?:api|接口|中转)\s*(?:密钥|秘钥|令牌)/.test(text));
    const apiUrl = input.type !== 'password' && hints.some(text =>
      /\b(?:base\s*(?:url|uri)|(?:api|llm|openai|proxy)\s*(?:base\s*)?(?:url|uri|endpoint|address)|(?:api\s+)?endpoint\s+(?:url|uri|address))\b|(?:api|接口|中转|代理|反代|模型)\s*(?:地址|端点|链接|url|网址)/.test(text));
    if (apiKey === apiUrl) return undefined;
    return apiKey ? 'key' : 'url';
  }

  function scopeOf(input) {
    const root = input.getRootNode();
    return input.closest(scopeSelector) ?? (root.host ? root : null);
  }

  const scopeParent = (input, scope) => (scope?.host ?? scope ?? input).parentNode;

  function scopedFields(input, scope) {
    const kind = fieldKind(input);
    if (!kind) return [];
    const focused = { input, kind };
    if (!scope) return [focused];
    const candidates = [...scope.querySelectorAll('input')]
      .filter(field => scopeOf(field) === scope && field.form === input.form)
      .map(field => ({ input: field, kind: fieldKind(field) })).filter(field => field.kind);
    const partner = candidates.find(field => field.kind !== kind);
    if (!partner) return [focused];
    return candidates.length === 2 ? [focused, partner] : null;
  }

  function fill(input, scope, parent, form, fields, row) {
    const sameTarget = field => field.isConnected && scopeOf(field) === scope &&
      field.form === form && scopeParent(input, scope) === parent;
    const actual = scopedFields(input, scope);
    if (!sameTarget(input) || !actual ||
      actual.length !== fields.length || actual.some((field, index) =>
        field.input !== fields[index].input || field.kind !== fields[index].kind)) {
      throw new Error('插件输入框已变化，请关闭后重新选择。');
    }

    const assignments = fields.map(field => {
      let value;
      if (field.kind === 'url') {
        value = row.url.trim() || (Object.hasOwn(defaultEndpoints, row.source) ? defaultEndpoints[row.source] : '');
        const url = endpointUrl(value);
        if ([...url.searchParams.keys()].some(param => /^(?:key|api[_-]?(?:key|token)|access[_-]?token|token|password|secret)$/i.test(param))) {
          throw new Error('请把 URL 中的密钥参数移到 API 密钥栏。');
        }
      } else {
        value = row.key;
        if (!value.trim() || /[\r\n]/.test(value)) throw new Error('请选择有有效 API Key 的配置。');
      }
      if (field.input.maxLength >= 0 && value.length > field.input.maxLength) {
        throw new Error(fieldLabels[field.kind] + '超出插件输入框允许的长度。');
      }
      return { input: field.input, value };
    });

    // Apply both values before notifying listeners that may redraw the extension form.
    for (const assignment of assignments) setValue.call(assignment.input, assignment.value);
    for (const assignment of assignments) {
      for (const type of ['input', 'change']) {
        if (!sameTarget(assignment.input)) throw new Error('插件已刷新输入框，请检查填写结果。');
        assignment.input.dispatchEvent(new realm.Event(type, { bubbles: true, composed: true }));
      }
    }
    const labels = fields.map(field => fieldLabels[field.kind]).join('和');
    return '已填入' + labels + '。';
  }

  doc.addEventListener('focusin', event => {
    const path = event.composedPath();
    if (path.some(node => node.matches?.(ownUI))) return;
    const input = path.find(node => node instanceof Input);
    if (current?.input === input && current?.button.isConnected && fieldKind(input)) return;
    current?.button.remove();
    current = undefined;
    if (!fieldKind(input)) return;

    const button = doc.createElement('button');
    button.type = 'button';
    button.className = 'menu_button catalog-form-fill-trigger';
    button.textContent = '填入 API';
    const anchor = input.closest('label') ?? input;
    button.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      const scope = scopeOf(input);
      const parent = scopeParent(input, scope);
      const form = input.form;
      const fields = scopedFields(input, scope);
      if (button.previousElementSibling !== anchor || fields?.length === 0) {
        button.remove();
        return;
      }
      button.focus({ preventScroll: true });
      if (!fields) {
        showPicker({
          fields: [],
          warning: '同一表单中有多组 API 地址或密钥，无法确认配对。请打开只包含一组配置的设置区后重试。',
        });
        return;
      }
      const scopeLabel = scope?.getAttribute?.('aria-label')?.trim().slice(0, 80);
      showPicker({
        fields: fields.map(({ kind }) => ({ kind, label: fieldLabels[kind] })),
        scopeLabel,
        fill: row => fill(input, scope, parent, form, fields, row),
      });
    });
    anchor.after(button);
    current = { input, button };
  }, true);
}
