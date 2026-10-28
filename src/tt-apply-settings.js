// TT parks #openai_settings with the closed AI-response-settings drawer.
// It is not part of the API connection form and must not gate API selection.
async function Ac(config, options = {}) {
  const host = window.parent || window;
  const context = host.SillyTavern?.getContext?.();
  const settings = context?.chatCompletionSettings;
  const $ = host.$;
  if (!settings || !$) throw new GA('无法访问酒馆 API 设置上下文', 'context');
  const source = er(config.source);
  const progress = options.onProgress || (() => {});
  const key = HA(options.apiKey || '');

  progress('写入酒馆配置');
  const mainInput = $('#main_api');
  const selectedApi = String(mainInput.val() ?? context.mainApi ?? '');
  if (selectedApi !== 'openai' && !mainInput.length) {
    throw new GA('未找到主 API 选择框，无法切换到聊天补全', 'write');
  }
  // Secret APIs refresh the local secret state. Do this before a source change:
  // TT's source-change handler immediately starts the native connection flow.
  if (key) {
    progress('同步密钥');
    await ec(context, config, options.keyItem, source.secretKey, key);
  }

  function writeModelSettings() {
    settings.chat_completion_source = config.source;
    if (source.requiresCustomUrl) settings.custom_url = config.customUrl;
    if (config.source === 'custom') settings.custom_api_format = 'openai_compat';
    for (const field of source.stateModelKeys || [source.modelSettingKey]) {
      if (field && !(field === 'custom_model' && config.source !== 'custom')) {
        settings[field] = config.customModel;
      }
    }
  }
  // Fill the complete settings object before native change handlers can start
  // a status request. TT generation reads this shared oai_settings object.
  writeModelSettings();
  if (key) settings[source.secretKey === 'api_key_custom' ? 'custom_api_key' : source.secretKey] = key;
  if (selectedApi !== 'openai') mainInput.val('openai').trigger('change');
  const sourceInput = $('#chat_completion_source');
  sourceInput.val(config.source);
  if (source.requiresCustomUrl) $('#custom_api_url_text').val(config.customUrl || source.defaultUrl || '');
  // A non-empty native key field means "save a new secret" to TT's connect
  // handler. The key is already registered above, so leave that field empty.
  $(source.keyInputSelector).val('');
  const sourceStartsConnection = options.triggerConnect !== false && sourceInput.length > 0;
  if (sourceStartsConnection) {
    sourceInput.trigger('change');
    if (String(sourceInput.val()) !== config.source) {
      throw new GA('当前 TT 设置不允许切换到此聊天补全来源', 'write');
    }
  }
  // Source gates restore provider-specific fields synchronously on change.
  $(source.keyInputSelector).val('');
  if (source.requiresCustomUrl) $('#custom_api_url_text').val(config.customUrl || source.defaultUrl || '').trigger('input');

  // Model lists may be empty or unavailable. Select the configured model now;
  // explicit detection and test-message actions remain the network checks.
  for (const selector of [source.modelInputSelector, ...(source.fallbackModelInputSelectors || [])].filter(Boolean)) {
    const input = $(selector);
    if (!input.length) continue;
    if (input[0]?.tagName === 'SELECT') {
      const hasModel = input.find('option').toArray().some(option => option.value === config.customModel);
      if (!hasModel) input.append($('<option></option>').val(config.customModel).text(config.customModel));
    }
    input.val(config.customModel).trigger('change').trigger('input');
    break;
  }
  writeModelSettings();
  if (typeof context.saveSettingsDebounced !== 'function') {
    throw new GA('酒馆未提供设置保存接口', 'write');
  }
  context.saveSettingsDebounced();

  if (options.triggerConnect !== false) {
    const button = $('#api_button_openai').first();
    if (sourceStartsConnection && button.length) {
      progress('配置已写入，发起原生连接');
    } else if (button.length && !button.prop('disabled')) {
      progress('配置已写入，发起原生连接');
      button[0].click();
    } else {
      (window.toastr || host.toastr)?.warning('配置已写入，原生连接按钮暂不可用，可在 API 连接区重新连接。');
    }
  }
  return true;
}
