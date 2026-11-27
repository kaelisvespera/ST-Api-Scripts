function createCatalogTheme(host, storage) {
  const doc = host.document;
  const view = doc.defaultView ?? host;
  const systemDark = view.matchMedia?.('(prefers-color-scheme: dark)');
  const canvas = doc.createElement('canvas');
  canvas.width = canvas.height = 1;
  const paint = canvas.getContext('2d', { willReadFrequently: true });
  let preference = storage.themePreferences;
  let requested = preference;
  let saveId = 0;
  let saveFailed = false;
  let renderSettings;
  let settingsStatus;

  function readColor(value) {
    if (!paint || !value) return;
    // An unsupported color leaves the last fill style in place.
    paint.fillStyle = '#010203';
    paint.fillStyle = value;
    if (paint.fillStyle === '#010203') {
      paint.fillStyle = '#040506';
      paint.fillStyle = value;
      if (paint.fillStyle === '#040506') return;
    }
    paint.clearRect(0, 0, 1, 1);
    paint.fillRect(0, 0, 1, 1);
    const [red, green, blue, alpha] = paint.getImageData(0, 0, 1, 1).data;
    if (alpha < 20) return;
    const linear = channel => {
      const srgb = channel / 255;
      return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
    };
    return {
      color: 'rgb(' + [red, green, blue].join(', ') + ')',
      lightness: 0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue),
    };
  }

  function appearance() {
    if (!preference.followHost) return { mode: preference.manual };
    const style = view.getComputedStyle(doc.body);
    const tint = readColor(style.getPropertyValue('--SmartThemeBlurTintColor').trim());
    const ink = readColor(style.getPropertyValue('--SmartThemeBodyColor').trim());
    // Clear host tints take precedence. The text color gives a better signal
    // when the host surface is transparent or somewhere in the middle.
    const dark = tint && tint.lightness < 0.22 ? true
      : tint && tint.lightness > 0.38 ? false
      : ink ? ink.lightness > 0.38
      : style.colorScheme === 'dark' || (style.colorScheme !== 'light' && systemDark?.matches);
    return { mode: dark ? 'dark' : 'light', tint: tint?.color };
  }

  function paintDialog(dialog, { mode, tint }) {
    dialog.dataset.catalogTheme = mode;
    dialog.dataset.catalogFollowHost = String(preference.followHost);
    const transparency = preference.followHost ? preference.transparency : 0;
    dialog.style.setProperty('--catalog-panel-transparency', transparency + '%');
    if (tint) dialog.style.setProperty('--catalog-host-tint', tint);
    else dialog.style.removeProperty('--catalog-host-tint');
    // Host themes can use important rules for all popup backgrounds.
    dialog.style.setProperty('background-color', 'var(--catalog-panel-background)', 'important');
  }

  function updateAppearance() {
    const current = appearance();
    for (const dialog of doc.querySelectorAll('dialog.st-api-manager[open]')) paintDialog(dialog, current);
    renderSettings?.(current.mode);
  }

  let refreshPending = false;
  function scheduleRefresh() {
    if (refreshPending || !preference.followHost || !doc.querySelector('dialog.st-api-manager[open]')) return;
    refreshPending = true;
    view.requestAnimationFrame(() => {
      refreshPending = false;
      if (preference.followHost) updateAppearance();
    });
  }
  if (view.MutationObserver) {
    const observer = new view.MutationObserver(scheduleRefresh);
    for (const element of [doc.documentElement, doc.body]) observer.observe(element, { attributes: true });
    observer.observe(doc.head, { attributes: true, childList: true, characterData: true, subtree: true });
  }
  doc.head.addEventListener('load', scheduleRefresh, true);
  systemDark?.addEventListener?.('change', scheduleRefresh);

  const saveError = '主题设置未能保存，请重试。';
  function save() {
    if (requested === preference) return;
    const revision = ++saveId;
    requested = preference;
    saveFailed = false;
    if (settingsStatus) settingsStatus.textContent = '';
    void storage.setThemePreferences(requested).catch(() => {
      if (revision !== saveId) return;
      const stored = storage.themePreferences;
      if (preference === requested) preference = stored;
      requested = stored;
      updateAppearance();
      saveFailed = true;
      if (settingsStatus) settingsStatus.textContent = saveError;
    });
  }

  function openSettings({ popup, make, closeButton }) {
    const pane = popup('主题设置', 'small');
    const controls = make('div', 'catalog-theme-settings');

    const followLabel = make('label', 'catalog-theme-follow');
    const follow = make('input');
    follow.type = 'checkbox';
    followLabel.append(make('span', '', '跟随 ST/TT 主题'), follow);

    const manual = make('fieldset', 'catalog-theme-mode');
    manual.append(make('legend', '', '外观'));
    const modes = new Map();
    for (const [mode, name] of [['light', '日间'], ['dark', '夜间']]) {
      const option = make('label', 'catalog-theme-mode-option');
      const radio = make('input');
      radio.type = 'radio';
      radio.name = 'catalog-theme-manual';
      radio.value = mode;
      radio.addEventListener('change', () => {
        if (!radio.checked) return;
        preference = { ...preference, manual: mode };
        updateAppearance();
        save();
      });
      modes.set(mode, radio);
      option.append(radio, make('span', '', name));
      manual.append(option);
    }

    const transparency = make('div', 'catalog-theme-opacity');
    const opacityHeader = make('div', 'catalog-theme-opacity-header');
    const slider = make('input');
    slider.type = 'range';
    slider.id = 'catalog-panel-opacity';
    slider.min = '0';
    slider.max = String(maxCatalogTransparency);
    slider.step = '1';
    slider.setAttribute('aria-describedby', 'catalog-opacity-hint');
    const sliderLabel = make('label', 'catalog-theme-opacity-label', '面板透明度');
    sliderLabel.htmlFor = slider.id;
    const percentage = make('output', 'catalog-theme-opacity-value');
    percentage.setAttribute('for', slider.id);
    percentage.setAttribute('aria-live', 'off');
    const hint = make('p', 'catalog-theme-hint');
    hint.id = 'catalog-opacity-hint';
    opacityHeader.append(sliderLabel, percentage);
    transparency.append(opacityHeader, slider, hint);
    controls.append(followLabel, manual, transparency);
    pane.scroll.append(controls);
    pane.footer.append(closeButton(pane));

    const render = mode => {
      follow.checked = preference.followHost;
      manual.hidden = preference.followHost;
      transparency.hidden = !preference.followHost;
      slider.disabled = !preference.followHost;
      for (const [key, radio] of modes) radio.checked = key === preference.manual;
      const amount = String(preference.transparency);
      if (slider.value !== amount) slider.value = amount;
      const percent = amount + '%';
      percentage.value = percent;
      slider.setAttribute('aria-valuetext', percent);
      hint.textContent = '当前为' + (mode === 'dark' ? '夜间' : '日间') + '外观。透明度只作用于面板底色。';
    };
    follow.addEventListener('change', () => {
      preference = { ...preference, followHost: follow.checked };
      updateAppearance();
      save();
    });
    const preview = () => {
      const value = slider.valueAsNumber;
      if (!preference.followHost || value === preference.transparency) return;
      preference = { ...preference, transparency: value };
      updateAppearance();
    };
    slider.addEventListener('input', preview);
    slider.addEventListener('change', () => {
      preview();
      save();
    });
    pane.dialog.addEventListener('close', () => {
      if (renderSettings !== render) return;
      renderSettings = undefined;
      settingsStatus = undefined;
      save();
    });
    renderSettings = render;
    settingsStatus = pane.status;
    if (saveFailed) settingsStatus.textContent = saveError;
    render(appearance().mode);
    pane.open();
  }

  return { applyDialog: dialog => paintDialog(dialog, appearance()), openSettings };
}
