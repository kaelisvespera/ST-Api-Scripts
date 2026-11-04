async function startCatalogManager(host, browserStorage) {
  await (host.__TAURITAVERN__?.ready ?? host.__TAURITAVERN_MAIN_READY__);
  const doc = host.document;
  if (doc.readyState === 'loading') await new Promise(resolve => doc.addEventListener('DOMContentLoaded', resolve, { once: true }));
  const context = host.SillyTavern.getContext();
  const storage = await openCatalogStorage(host, context, browserStorage);
  const connection = createCatalogConnection(host, context, storage);
  const open = mountCatalogPanel(host, storage, connection);
  function openFromMenu(event) {
    event.stopPropagation();
    open();
  }
  const extensionsMenu = doc.getElementById('extensionsMenu');
  if (extensionsMenu && !doc.getElementById('st-api-manager-extension-button')) {
    const wrapper = doc.createElement('div');
    wrapper.className = 'extension_container interactable';
    wrapper.dataset.stApiManagerExtensionEntry = 'true';
    const item = doc.createElement('div');
    item.id = 'st-api-manager-extension-button';
    item.className = 'list-group-item flex-container flexGap5 interactable';
    item.dataset.stApiManagerExtensionEntry = 'true';
    item.setAttribute('role', 'button');
    item.tabIndex = 0;
    const icon = doc.createElement('i');
    icon.className = 'fa-solid fa-plug fa-fw';
    icon.setAttribute('aria-hidden', 'true');
    const label = doc.createElement('span');
    label.textContent = 'API 管理';
    item.append(icon, label);
    item.addEventListener('click', openFromMenu);
    item.addEventListener('keydown', event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      if (!event.repeat) openFromMenu(event);
    });
    wrapper.append(item);
    extensionsMenu.append(wrapper);
  }
  const connectionSettings = doc.getElementById('openai_settings');
  if (connectionSettings && !doc.getElementById('st-api-manager-connection-button')) {
    const button = doc.createElement('button');
    button.id = 'st-api-manager-connection-button';
    button.type = 'button';
    button.className = 'menu_button interactable';
    button.textContent = 'API 管理';
    button.addEventListener('click', openFromMenu);
    connectionSettings.append(button);
  }
  const callback = async () => { open(); return ''; };
  if (context.SlashCommandParser && context.SlashCommand) {
    context.SlashCommandParser.addCommandObject(context.SlashCommand.fromProps({ name: 'st-api-manager', callback, helpString: '打开 API 管理器' }));
  } else {
    context.registerSlashCommand?.('st-api-manager', callback, [], '打开 API 管理器', false, true);
  }
  host.addEventListener('st-api-manager-open-request', open);
  return { open, flush: storage.flush };
}
