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

  function luminance(rgb) {
    const [red, green, blue] = rgb.map(channel => {
      const srgb = channel / 255;
      return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  }

  const mix = (base, tint, weight) => base.map((channel, i) => Math.round(channel * (1 - weight) + tint[i] * weight));
  const contrast = (first, second) => {
    const a = luminance(first), b = luminance(second);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  };
  const rgb = channels => 'rgb(' + channels.join(', ') + ')';

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
    return [red, green, blue];
  }

  function followPalette(mode, tint, ink, accent) {
    const dark = mode === 'dark';
    const base = dark ? [43, 45, 48] : [224, 226, 224];
    const text = dark ? [221, 224, 225] : [51, 53, 50];
    let surface = tint ? mix(base, tint, .84) : base;
    let foreground = ink ? mix(text, ink, .55) : text;
    // Check the least separated control fill and muted text as well as the shell.
    const readable = () => contrast(foreground, mix(surface, foreground, .16)) >= 5 &&
      contrast(mix(foreground, surface, .15), mix(surface, foreground, .13)) >= 4.5;
    if (!readable()) foreground = text;
    if (!readable()) surface = mix(surface, base, .68);
    if (!readable()) surface = base;
    const highlight = accent ? mix(accent, foreground, .25) : foreground;
    const focusColor = contrast(highlight, mix(surface, foreground, .16)) >= 3 ? highlight : foreground;
    return { tint: rgb(surface), ink: rgb(foreground), accent: rgb(focusColor) };
  }

  function appearance() {
    if (!preference.followHost) return { mode: preference.manual };
    const style = view.getComputedStyle(doc.body);
    const tint = readColor(style.getPropertyValue('--SmartThemeBlurTintColor').trim()) ?? readColor(style.backgroundColor);
    const ink = readColor(style.getPropertyValue('--SmartThemeBodyColor').trim()) ?? readColor(style.color);
    const accent = readColor(style.getPropertyValue('--SmartThemeQuoteColor').trim());
    // Clear host tints give the color scheme; ink is a better signal for midtones.
    const tone = tint ? luminance(tint) : .3;
    const dark = tone < .22 ? true : tone > .38 ? false
      : ink ? luminance(ink) > .38
      : style.colorScheme === 'dark' || (style.colorScheme !== 'light' && systemDark?.matches);
    const mode = dark ? 'dark' : 'light';
    return { mode, ...followPalette(mode, tint, ink, accent) };
  }

  function paintDialog(dialog, { mode, tint, ink, accent }) {
    dialog.dataset.catalogTheme = mode;
    dialog.dataset.catalogFollowHost = String(preference.followHost);
    const transparency = preference.followHost ? preference.transparency : 0;
    dialog.style.setProperty('--catalog-panel-transparency', transparency + '%');
    for (const [name, color] of Object.entries({ tint, ink, accent })) {
      const token = '--catalog-host-' + name;
      if (color) dialog.style.setProperty(token, color);
      else dialog.style.removeProperty(token);
    }
    // Host themes can use important rules for all popup backgrounds.
    dialog.style.setProperty('background-color', 'var(--catalog-panel-background)', 'important');
  }

  function updateAppearance() {
    const current = appearance();
    for (const dialog of doc.querySelectorAll('dialog.st-api-manager[open]')) paintDialog(dialog, current);
    renderSettings?.();
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
    const hint = make('p', 'catalog-theme-hint', '正在跟随酒馆主题。透明度只作用于面板底色。');
    hint.id = 'catalog-opacity-hint';
    opacityHeader.append(sliderLabel, percentage);
    transparency.append(opacityHeader, slider, hint);
    controls.append(followLabel, manual, transparency);
    pane.scroll.append(controls);
    pane.footer.append(closeButton(pane));

    const render = () => {
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
    render();
    pane.open();
  }

  return { applyDialog: dialog => paintDialog(dialog, appearance()), openSettings };
}
