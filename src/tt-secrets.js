// TT returns masked secret values. A cached upstream secretId alone cannot
// prove that it still represents the key selected in this script.
// Use TT's HTTP bridge directly, without importing host modules or triggering
// DOM events while a configuration is being applied.
async function ttSecretRequest(context, action, body, operation) {
  const headers = context.getRequestHeaders?.() || { 'Content-Type': 'application/json' };
  let response;
  try {
    response = await fetch(`/api/secrets/${action}`, {
      method: 'POST', headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch (error) {
    throw new GA(`${operation}失败：${error instanceof Error ? error.message : String(error)}`, 'write');
  }
  if (!response.ok) throw new GA(`${operation}失败（HTTP ${response.status}）`, 'write');
  return response;
}
async function JA(context) {
  const response = await ttSecretRequest(context, 'read', undefined, '读取密钥状态');
  return response.json();
}
async function WA(context, secretKey, value, label) {
  const response = await ttSecretRequest(context, 'write', { key: secretKey, value, label }, '写入密钥');
  const result = await response.json();
  if (!result?.id) throw new GA('写入密钥失败：未返回密钥 ID', 'write');
  return result.id;
}
async function QA(context, secretKey, id) {
  await ttSecretRequest(context, 'rotate', { key: secretKey, id }, '切换密钥');
}
async function ttRegisterSecret(context, config, keyItem, secretKey, rawKey, activate) {
  const key = HA(rawKey);
  if (!key) throw new GA('API Key 为空，无法注册', 'write');
  const digest = await ttHost.crypto.subtle.digest('SHA-256', new TextEncoder().encode(secretKey + '\0' + key));
  const fingerprint = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  const storageKey = 'st_api_manager_tt_secret_bindings_v1';
  const bindings = JSON.parse(localStorage.getItem(storageKey) || '{}');
  const state = await JA(context);
  const secrets = Array.isArray(state[secretKey]) ? state[secretKey] : [];
  const previous = secrets.find(secret => secret.active)?.id;
  const matched = secrets.find(secret => secret.id === bindings[fingerprint])
    || secrets.find(secret => secret.value === key);
  const id = matched?.id || await WA(context, secretKey, key, `ST-ApiManager: ${config.groupName || config.name}`);
  if (!id) throw new GA('写入 secret 后未返回密钥 ID', 'write');
  if (activate && matched && !matched.active) await QA(context, secretKey, id);
  if (!activate && !matched && previous && previous !== id) await QA(context, secretKey, previous);
  bindings[fingerprint] = id;
  localStorage.setItem(storageKey, JSON.stringify(bindings));
  if (keyItem) keyItem.secretId = id;
  return id;
}
async function RA(config, keyItem) {
  const context = ttHost.SillyTavern?.getContext?.();
  if (!context) throw new GA('无法访问酒馆 API 设置上下文', 'context');
  return ttRegisterSecret(context, config, keyItem, er(config.source).secretKey, keyItem.key, false);
}
async function ec(context, config, keyItem, secretKey, key) {
  return ttRegisterSecret(context, config, keyItem, secretKey, key, true);
}
