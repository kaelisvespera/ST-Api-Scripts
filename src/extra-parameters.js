// The hosts expose the same YAML parser their connection UI uses.
async function validateEntryExtraYaml(host, extra) {
  const fields = [
    ['includeBody', '包含主体参数', false],
    ['excludeBody', '排除主体参数', true],
    ['includeHeaders', '包含请求标头', false],
  ].filter(([name]) => extra?.[name]?.trim());
  if (!fields.length) return;
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
  }
}
