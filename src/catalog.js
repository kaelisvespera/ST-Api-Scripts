// One entry describes one credential and one model. Labels are independent of
// the endpoint, and neither the endpoint nor the credential is an entry ID.
const catalogFormat = 'st-api-manager-catalog';
const makeId = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), n => n.toString(16).padStart(2, '0')).join('');
const isObject = value => !!value && typeof value === 'object' && !Array.isArray(value);
const isText = value => typeof value === 'string';
const labels = value => Array.from(new Set(value.filter(id => isText(id) && id)));
const emptyCatalog = () => ({ format: catalogFormat, version: 2, entries: [], groups: [] });
const formatError = () => new Error('配置文件格式无效，原有配置已保留。');

function validateCatalog(value) {
  if (!isObject(value) || value.format !== catalogFormat || value.version !== 2 ||
      !Array.isArray(value.entries) || !Array.isArray(value.groups)) throw formatError();
  const groups = new Set();
  for (const group of value.groups) {
    if (!isObject(group) || !isText(group.id) || !group.id || groups.has(group.id) ||
        !isText(group.name) || !group.name.trim()) throw formatError();
    groups.add(group.id);
  }
  const entries = new Set();
  for (const row of value.entries) {
    if (!isObject(row) || !row.id || !isText(row.id) || entries.has(row.id) ||
        ![row.site, row.name, row.source, row.url, row.model, row.key].every(isText) ||
        !Array.isArray(row.groupIds) || row.groupIds.some(id => !groups.has(id))) throw formatError();
    entries.add(row.id);
  }
  return value;
}

function migrateCatalog(configs, categories = []) {
  const catalog = emptyCatalog();
  if (!Array.isArray(categories)) throw formatError();
  // Keep legacy IDs, colors and order; resolve category names used by older
  // exports. Unknown category references remain usable instead of disappearing.
  for (const category of categories) {
    if (!isObject(category) || !isText(category.name) || !category.name.trim()) throw formatError();
    const id = category.id || makeId();
    catalog.groups.push({ ...category, id });
  }
  const groupId = value => {
    const match = catalog.groups.find(group => group.id === value) ?? catalog.groups.find(group => group.name === value);
    if (match) return match.id;
    catalog.groups.push({ id: value, name: value });
    return value;
  };
  if (isObject(configs) && configs.format === 'grouped-api-configs' && Array.isArray(configs.groups)) {
    configs = configs.groups.flatMap(site => {
      if (!isObject(site) || !isText(site.groupName) || !isText(site.source) ||
          (site.models !== undefined && !Array.isArray(site.models))) throw formatError();
      const { models, ...shared } = site;
      return (models?.length ? models : [{}]).map(model => {
        if (!isObject(model)) throw formatError();
        return { ...shared, ...model };
      });
    });
  }
  if (!Array.isArray(configs)) throw formatError();
  for (const config of configs) {
    if (!isObject(config) || !isText(config.source) || !config.source ||
        (config.apiKeys !== undefined && !Array.isArray(config.apiKeys)) ||
        (config.categoryIds !== undefined && !Array.isArray(config.categoryIds))) throw formatError();
    const site = config.groupName || config.name || config.customUrl || '未命名站点';
    const model = config.customModel ?? '';
    const groupIds = labels(labels([...(config.categoryIds ?? []), config.categoryId]).map(groupId));
    const pool = config.apiKeys?.length ? [...config.apiKeys] : [];
    if (config.apiKey !== undefined && !pool.some(item => item?.key === config.apiKey)) pool.push({ key: config.apiKey });
    for (const [index, credential] of (pool.length ? pool : [{ key: '' }]).entries()) {
      if (!isObject(credential) || !isText(credential.key)) throw formatError();
      const { key, ...keyHistory } = credential;
      const { currentKeyIndex, enableKeyRotation, isActive, lastVerifiedAt, lastVerifiedKeyIndex, lastHealthStatus, lastHealthError } = config;
      catalog.entries.push({
        id: makeId(), site, name: config.name || '', source: config.source,
        url: config.customUrl ?? '', model, key, groupIds,
        history: { index, poolSize: pool.length, keyHistory, currentKeyIndex, enableKeyRotation, isActive, lastVerifiedAt, lastVerifiedKeyIndex, lastHealthStatus, lastHealthError },
      });
    }
  }
  return validateCatalog(catalog);
}

function readCatalog(value) {
  if (value?.format === catalogFormat) return { catalog: validateCatalog(value), legacy: false };
  if (Array.isArray(value) || value?.format === 'grouped-api-configs') return { catalog: migrateCatalog(value), legacy: true };
  if (!isObject(value) || !(value.configStore || Array.isArray(value.configs))) throw formatError();
  return { catalog: migrateCatalog(value.configStore ?? value.configs, value.categories), legacy: true };
}

// Compare values independently of JSON property order. Signatures stay in
// memory; keys are never embedded in IDs, DOM attributes, or sync metadata.
function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (isObject(value)) return '{' + Object.keys(value).filter(key => value[key] !== undefined).sort()
    .map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  return JSON.stringify(value);
}
const withoutId = ({ id, ...value }) => canonical(value);
const conflictContent = ({ id, conflictSourceId, ...value }) => canonical(value);

function mergeCatalogRecords(local, incoming, legacy) {
  const records = [...local];
  const byId = new Map(local.map(record => [record.id, record]));
  const reservedIds = new Set(incoming.map(record => record.id));
  const ids = new Map();
  for (const record of incoming) {
    const existing = byId.get(record.id);
    let result;
    if (existing && canonical(existing) === canonical(record)) {
      result = existing;
    } else if (existing) {
      // Reuse only a copy made for this ID. An independent record can have
      // identical contents, even if it is absent from the imported subset.
      const content = conflictContent(record);
      result = local.find(candidate => !reservedIds.has(candidate.id) &&
        candidate.conflictSourceId === record.id && conflictContent(candidate) === content);
    } else if (legacy) {
      const content = withoutId(record);
      result = local.find(candidate => !reservedIds.has(candidate.id) && withoutId(candidate) === content);
    }
    if (!result) {
      result = existing ? { ...record, id: makeId(), conflictSourceId: record.id } : record;
      records.push(result);
    }
    reservedIds.add(result.id);
    ids.set(record.id, result.id);
  }
  return { records, ids };
}

function mergeCatalogs(local, incoming, legacy = false) {
  const { records: groups, ids: groupIds } = mergeCatalogRecords(local.groups, incoming.groups, legacy);
  const incomingEntries = incoming.entries.map(row => ({ ...row, groupIds: row.groupIds.map(id => groupIds.get(id)) }));
  const { records: entries } = mergeCatalogRecords(local.entries, incomingEntries, legacy);
  return { ...local, entries, groups };
}

const defaultEndpoints = {
  openai: 'https://api.openai.com/v1', deepseek: 'https://api.deepseek.com/v1',
  makersuite: 'https://generativelanguage.googleapis.com/v1beta',
};
function endpointUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('请填写完整的 HTTP 或 HTTPS 站点地址。'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('站点地址须为 HTTP 或 HTTPS，密钥请填在单独的密钥栏。');
  }
  return url;
}

async function discoverModels({ source, url, key }, request) {
  const google = source === 'makersuite';
  if (source !== 'custom' && !Object.hasOwn(defaultEndpoints, source)) {
    throw new Error('此来源请手动填写模型名。');
  }
  const target = endpointUrl(url.trim() || defaultEndpoints[source]);
  const base = target.pathname.replace(/\/+$/, '').replace(/\/(?:chat\/completions|models)$/, '');
  target.pathname = (base || (google ? '/v1beta' : '/v1')) + '/models';
  target.hash = '';
  for (const param of [...target.searchParams.keys()]) {
    if (/^(?:key|api[_-]?key|access_token)$/i.test(param)) {
      throw new Error('请移除 URL 中的密钥参数，改填在 API 密钥栏。');
    }
  }
  target.searchParams.delete('pageToken');
  const headers = key ? (google ? { 'x-goog-api-key': key } : { Authorization: 'Bearer ' + key }) : {};
  const models = new Set();
  const pages = new Set();
  let next;
  do {
    if (next) {
      if (pages.has(next)) throw new Error('站点返回了重复的模型分页。');
      pages.add(next);
      target.searchParams.set('pageToken', next);
    }
    let response, data;
    try {
      response = await request(target.href, {
        method: 'GET', headers, credentials: 'omit', redirect: 'error', cache: 'no-store',
        signal: AbortSignal.timeout(15000),
      });
      if (response.ok) data = await response.json();
    } catch {
      throw new Error('无法读取模型列表，请检查站点、密钥或跨域访问，也可以手动填写模型。');
    }
    if (!response.ok) throw new Error('模型列表请求失败（HTTP ' + response.status + '），原有配置已保留。');
    const list = google ? data?.models : (data?.data ?? data?.models);
    if (!Array.isArray(list)) throw new Error('站点没有返回可识别的模型列表。');
    for (const item of list) {
      const name = google ? item?.name : isText(item) ? item : item?.id ?? item?.model ?? item?.name;
      if (isText(name) && name.trim()) models.add(google ? name.replace(/^models\//, '') : name.trim());
    }
    next = google && isText(data.nextPageToken) ? data.nextPageToken : undefined;
  } while (next);
  return [...models].sort();
}

export { emptyCatalog, readCatalog, migrateCatalog, mergeCatalogs, validateCatalog, discoverModels };
