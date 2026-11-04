async function startCatalogManager(host, browserStorage) {
  await (host.__TAURITAVERN__?.ready ?? host.__TAURITAVERN_MAIN_READY__);
  const doc = host.document;
  if (doc.readyState === 'loading') await new Promise(resolve => doc.addEventListener('DOMContentLoaded', resolve, { once: true }));
  const context = host.SillyTavern.getContext();
  const storage = await openCatalogStorage(host, context, browserStorage);
  const open = mountCatalogPanel(host, storage);
  function entry(selector, id) {
    const container = doc.querySelector(selector);
    if (!container || doc.getElementById(id)) return;
    const button = doc.createElement('button');
    button.id = id;
    button.type = 'button';
    button.className = 'menu_button interactable';
    button.textContent = 'API 管理器';
    button.addEventListener('click', event => { event.stopPropagation(); open(); });
    container.append(button);
  }
  entry('#extensionsMenu', 'st-api-manager-extension-button');
  entry('#openai_settings', 'st-api-manager-connection-button');
  const callback = async () => { open(); return ''; };
  if (context.SlashCommandParser && context.SlashCommand) {
    context.SlashCommandParser.addCommandObject(context.SlashCommand.fromProps({ name: 'st-api-manager', callback, helpString: '打开 API 管理器' }));
  } else {
    context.registerSlashCommand?.('st-api-manager', callback, [], '打开 API 管理器', false, true);
  }
  host.addEventListener('st-api-manager-open-request', open);
  return { open, flush: storage.flush };
}
