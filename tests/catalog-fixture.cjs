const url = 'https://fixture.invalid/compat/v1';
const categories = [
  { id: 'group-a', name: '第一组', color: '#1a3456', order: 0 },
  { id: 'group-b', name: '第二组', color: '#345678', order: 1 },
];
const credential = (id, key, successCount = 0) => ({ id, key, successCount, failureCount: 1 });
const config = (key, categoryId = 'group-a') => ({
  name: '共用模型', source: 'custom', customUrl: url, customModel: 'same-model',
  groupName: '共用站点', groupKey: 'same-site', apiKeys: [credential(key, key, 3)],
  categoryId, currentKeyIndex: 0, enableKeyRotation: true, isActive: true,
});
const flatConfigs = [config('fixture-key-a'), config('fixture-key-b', 'group-b')];
const legacyValues = {
  api_configs_manager: JSON.stringify(flatConfigs),
  api_configs_categories: JSON.stringify(categories),
  api_configs_category_switch_indexes: '{"group-a":1}',
  stb_api_management_settings: '{"lockTavernConfig":true}',
};
const grouped = {
  version: 2, format: 'grouped-api-configs',
  groups: [{
    groupName: '共用站点', groupKey: 'same-site', source: 'custom', customUrl: url,
    apiKeys: [credential('a', 'fixture-key-a', 3), credential('b', 'fixture-key-b', 8)],
    enableKeyRotation: true,
    models: [
      { name: '共用模型', customModel: 'same-model', currentKeyIndex: 1, categoryId: 'group-a', isActive: true },
      { name: '另一个模型', customModel: 'second-model', categoryIds: ['group-b'] },
    ],
  }],
};

module.exports = { url, categories, credential, config, flatConfigs, legacyValues, grouped };
