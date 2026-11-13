function startCatalogManager(host, browserStorage) {
  // Both native and legacy iframe builds share one host instance and slash callback.
  if (host.__stApiManagerStartup) return host.__stApiManagerStartup;
  const startup = initializeCatalogManager(host, browserStorage);
  host.__stApiManagerStartup = startup;
  startup.catch(() => { if (host.__stApiManagerStartup === startup) delete host.__stApiManagerStartup; });
  return startup;
}

async function initializeCatalogManager(host, browserStorage) {
  await (host.__TAURITAVERN__?.ready ?? host.__TAURITAVERN_MAIN_READY__);
  const doc = host.document;
  if (doc.readyState === 'loading') await new Promise(resolve => doc.addEventListener('DOMContentLoaded', resolve, { once: true }));
  const context = host.SillyTavern.getContext();
  const storage = await openCatalogStorage(host, context, browserStorage);
  const connection = createCatalogConnection(host, context, storage);
  const open = mountCatalogPanel(host, storage, connection);
  const callback = async () => { open(); return ''; };
  let slashAvailable = false;
  try {
    if (context.SlashCommandParser && context.SlashCommand) {
      context.SlashCommandParser.addCommandObject(context.SlashCommand.fromProps({ name: 'st-api-manager', callback, helpString: '打开 API 管理器' }));
      slashAvailable = true;
    } else if (context.registerSlashCommand) {
      context.registerSlashCommand('st-api-manager', callback, [], '打开 API 管理器', false, true);
      slashAvailable = true;
    }
  } catch { /* The menu remains available if this host cannot register slash commands. */ }
  host.addEventListener('st-api-manager-open-request', open);
  const refreshEntries = mountCatalogEntries(host, storage, open, slashAvailable);
  return { open, flush: storage.flush, refreshEntries };
}
