// Apply through the existing host context and native connection handler.
// Do not import TT modules or trigger a reconnect while secret I/O is pending.
async function Ac(config, options = {}) {
  const host = window.parent || window;
  const context = host.SillyTavern?.getContext?.();
  const settings = context?.chatCompletionSettings;
  const $ = host.$;
  if (!settings || !$) throw new GA('无法访问酒馆 API 设置上下文', 'context');
  if (typeof context.saveSettingsDebounced !== 'function') {
    throw new GA('酒馆未提供设置保存接口', 'write');
  }
  const source = er(config.source);
  const progress = options.onProgress || (() => {});
  const key = HA(options.apiKey || '');
  const mainInput = $('#main_api');
  const selectedApi = String(mainInput.val() ?? context.mainApi ?? '');
  if (selectedApi !== 'openai' && !mainInput.length) {
    throw new GA('未找到主 API 选择框，无法切换到聊天补全', 'write');
  }
  if (key) {
    progress('同步密钥');
    await ec(context, config, options.keyItem, source.secretKey, key);
  }

  function writeSettings() {
    settings.chat_completion_source = config.source;
    if (source.requiresCustomUrl) settings.custom_url = config.customUrl;
    if (config.source === 'custom') settings.custom_api_format = 'openai_compat';
    for (const field of source.stateModelKeys || [source.modelSettingKey]) {
      if (field && !(field === 'custom_model' && config.source !== 'custom')) {
        settings[field] = config.customModel;
      }
    }
  }
  function writeControls() {
    if (source.requiresCustomUrl) $('#custom_api_url_text').val(config.customUrl || source.defaultUrl || '');
    // The selected secret is already registered. A nonempty field would ask
    // TT's connect handler to save another new secret instead of reloading it.
    $(source.keyInputSelector).val('');
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
  }
  progress('写入酒馆配置');
  writeSettings();
  const sourceInput = $('#chat_completion_source');
  sourceInput.val(config.source);
  writeControls();
  if (selectedApi !== 'openai') mainInput.val('openai').trigger('change');

  if (options.triggerConnect !== false) {
    const button = $('#api_button_openai').first();
    if (button.length && !button.prop('disabled')) {
      progress('配置已写入，发起原生连接');
      if (sourceInput.length) {
        // TT's source handler starts onConnectButtonClick, whose first await is
        // readSecretState(). Complete synchronous source/model restoration
        // before that native handler continues with a fresh secret_id.
        sourceInput.trigger('change');
        if (String(sourceInput.val()) !== config.source) {
          throw new GA('当前 TT 设置不允许切换到此聊天补全来源', 'write');
        }
        writeControls();
        writeSettings();
      } else {
        button[0].click();
      }
    } else {
      (window.toastr || host.toastr)?.warning('配置已写入，原生连接按钮暂不可用，可在 API 连接区重新连接。');
    }
  }
  context.saveSettingsDebounced();
  return true;
}
