const catalogQrTitle = 'st-api-manager: owned launch entry';

function mountCatalogEntries(host, storage, open, slashAvailable) {
  const doc = host.document;
  let running, rerun = false, failed = false, lastApi, partialSet;
  let status = { qrReady: false, message: '' };
  Object.defineProperty(storage, 'entryPointStatus', { get: () => ({ ...status }) });
  const notify = (qrReady, message) => {
    if (status.qrReady === qrReady && status.message === message) return;
    status = { qrReady, message };
    host.dispatchEvent(new host.Event('st-api-manager-entry-status-changed'));
  };
  function wand(show) {
    const old = doc.getElementById('st-api-manager-extension-button');
    if (!show) { old?.parentElement.remove(); return; }
    if (old) return;
    const menu = doc.getElementById('extensionsMenu');
    if (!menu) return;
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
    const activate = event => { event.stopPropagation(); open(); };
    item.addEventListener('click', activate);
    item.addEventListener('keydown', event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      if (!event.repeat) activate(event);
    });
    wrapper.append(item);
    menu.append(wrapper);
  }
  const safeSet = set => set && !set.disableSend && !set.injectInput && !set.placeBeforeInput;
  function owned(set) {
    const qr = set?.qrList?.[0];
    return set?.qrList?.length === 1 && safeSet(set)
      && qr.label === 'API 管理' && qr.message === '/st-api-manager'
      && qr.title === catalogQrTitle && !qr.isHidden
      && !qr.executeOnStartup && !qr.executeOnUser && !qr.executeOnAi
      && !qr.executeOnChatChange && !qr.executeOnGroupMemberDraft
      && !qr.executeOnNewChat && !qr.executeBeforeGeneration && !qr.automationId;
  }
  async function reconcile() {
    const preference = storage.entryPoints;
    const api = host.quickReplyApi;
    if (api !== lastApi) { lastApi = api; failed = false; }
    let ready = false, message = '';
    try {
      const capable = ['getSetByName', 'createSet', 'createQuickReply', 'addGlobalSet', 'removeGlobalSet', 'listGlobalSets']
        .every(key => typeof api?.[key] === 'function');
      if (!capable || !slashAvailable) {
        if (preference.qr) message = 'QR 尚未就绪，暂保留魔法棒入口；也可使用 /st-api-manager。';
      } else {
        let name = storage.qrSetName;
        let set = name ? api.getSetByName(name) : undefined;
        if (!preference.qr) {
          if (owned(set) && api.listGlobalSets().includes(name)) api.removeGlobalSet(name);
        } else if (failed) {
          message = 'QR 入口未能启用，已保留魔法棒。请切换到魔法棒后重新选择 QR。';
        } else if (set && !owned(set) && !(set === partialSet && safeSet(set) && set.qrList.length === 0)) {
          message = '专用 QR 集合不完整或已被修改，未覆盖它；请在 Quick Reply 设置中检查，暂保留魔法棒入口。';
        } else {
          if (!set) {
            // Never call createSet on an existing name: the host API replaces it.
            if (!name) {
              name = 'API Manager - ' + makeId();
              while (api.getSetByName(name)) name = 'API Manager - ' + makeId();
              await storage.setQrSetName(name);
            }
            if (api.getSetByName(name)) throw new Error('QR name claimed during preference save');
            const creation = api.createSet(name, { disableSend: false, placeBeforeInput: false, injectInput: false });
            // Upstream inserts the new set before awaiting its first save. Retain
            // that identity so a failed initial save can resume without replacement.
            partialSet = api.getSetByName(name);
            set = await creation;
            partialSet = set;
          }
          if (api.getSetByName(name) !== set || !safeSet(set)
              || !(owned(set) || (set === partialSet && set.qrList.length === 0))) {
            throw new Error('QR set changed during creation');
          }
          if (set === partialSet && set.qrList.length === 0) {
            await api.createQuickReply(name, 'API 管理', {
              message: '/st-api-manager', title: catalogQrTitle, icon: 'fa-plug', showLabel: true,
            });
          }
          if (api.getSetByName(name) !== set || !owned(set)) throw new Error('QR reply changed during creation');
          if (set === partialSet) {
            await set.save();
            partialSet = undefined;
          }
          if (api.getSetByName(name) !== set || !owned(set)) throw new Error('QR set changed during save');
          if (storage.entryPoints.qr && !api.listGlobalSets().includes(name)) api.addGlobalSet(name, true);
          // Global QR enablement is the user's host setting; never enable other sets as a side effect.
          const link = api.settings?.config?.setList?.find(item => item.set === set);
          ready = storage.entryPoints.qr && api.settings?.isEnabled === true && link?.isVisible === true && !!set.dom?.isConnected;
          if (!ready) message = '请在酒馆 Quick Reply 设置中启用并显示此集合；暂保留魔法棒入口。';
        }
      }
    } catch {
      failed = true;
      message = 'QR 入口未能启用，已保留魔法棒。请切换到魔法棒后重新选择 QR。';
    }
    notify(ready, message);
    wand(storage.entryPoints.wand || !ready || !storage.entryPoints.qr);
  }
  const refresh = () => {
    // Coalesce timer ticks while a save is pending; never grow an unbounded queue.
    if (running) { rerun = true; return running; }
    running = (async () => {
      do { rerun = false; await reconcile(); } while (rerun);
    })().finally(() => { running = undefined; });
    return running;
  };
  host.addEventListener('st-api-manager-entry-points-changed', () => { failed = false; refresh(); });
  // QR initializes after extensions in some hosts. Also notice host QR visibility changes.
  host.setInterval(refresh, 2000);
  wand(true);
  refresh();
  return refresh;
}
