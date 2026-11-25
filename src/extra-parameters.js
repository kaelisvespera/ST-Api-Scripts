const entryExtraYamlFields = [
  ['includeBody', '包含主体参数', false],
  ['excludeBody', '排除主体参数', true],
  ['includeHeaders', '包含请求标头', false],
];

// The hosts expose the same YAML parser their connection UI uses.
async function parseEntryExtraYaml(host, extra, requested) {
  const fields = entryExtraYamlFields.filter(([name]) => requested.includes(name) && extra?.[name]?.trim());
  const parsed = {};
  if (!fields.length) return parsed;
  let parse;
  try {
    const library = await import(new URL('/lib.js', host.document.location.href).href);
    parse = library.yaml?.parse;
    if (typeof parse !== 'function') throw new Error();
  } catch {
    throw new Error('当前酒馆无法加载 YAML 校验，请检查扩展与酒馆版本。');
  }
  for (const [name, label, list] of fields) {
    let value;
    try { value = parse(extra[name]); }
    catch { throw new Error(label + '不是有效的 YAML，请检查缩进和语法。'); }
    if (value == null) continue; // Comments and empty YAML documents have no effect.
    if (list) {
      if (!Array.isArray(value) || !value.every(item => typeof item === 'string' && item.trim())) {
        throw new Error(label + '需要使用 YAML 数组，每项是一个参数名。');
      }
    } else if (!isObject(value)) {
      throw new Error(label + '需要使用 YAML 对象，例如 top_k: 20。');
    }
    parsed[name] = value;
  }
  return parsed;
}

async function validateEntryExtraYaml(host, extra) {
  await parseEntryExtraYaml(host, extra, entryExtraFields);
}

// The supported editors manage connection, model, and request-envelope fields separately.
const pluginReservedBodyKeys = new Set([
  'model', 'messages', 'prompt', 'stream', 'json_schema', 'response_format', 'chat_completion_source',
  'reverse_proxy', 'proxy_password', 'custom_url', 'custom_include_body', 'custom_include_headers',
  'custom_exclude_body', 'base_url', 'api_key', 'apiKey', 'key', 'headers', 'secret_id', 'secretId',
]);
function serializePluginExtraBody(body) {
  if (Object.keys(body).some(key => pluginReservedBodyKeys.has(key))) {
    throw new Error('主体附加参数含有插件保留字段，请在插件对应设置中填写。');
  }
  try {
    return JSON.stringify(body, (key, value) => {
      if (['__proto__', 'constructor', 'prototype'].includes(key) ||
        (typeof value === 'number' && !Number.isFinite(value))) throw new Error();
      return value;
    }, 2);
  } catch {
    throw new Error('主体附加参数无法转换成插件接受的 JSON 对象。');
  }
}

async function formatEntryExtraForPlugin(host, extra, extraFields, yamlFields = []) {
  if (!extra || !extraFields.length) return {};
  const requested = extraFields.filter(name => (name === 'includeBody' || name === 'excludeBody') && extra[name]?.trim());
  const parsed = await parseEntryExtraYaml(host, extra, requested);
  const result = {};
  if (requested.includes('includeBody')) {
    if (yamlFields.includes('includeBody')) result.includeBody = extra.includeBody ?? '';
    else result.includeBody = parsed.includeBody ? serializePluginExtraBody(parsed.includeBody) : '';
  }
  if (requested.includes('excludeBody')) {
    if (yamlFields.includes('excludeBody')) {
      result.excludeBody = extra.excludeBody ?? '';
      return result;
    }
    const names = parsed.excludeBody ?? [];
    if (names.some(name => /[,，\r\n]/.test(name))) {
      throw new Error('排除参数名不能包含逗号或换行，请把每个名称写成单独一项。');
    }
    result.excludeBody = names.map(name => name.trim()).join('\n');
  }
  return result;
}
