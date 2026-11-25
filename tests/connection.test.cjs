const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const names = ['include_body', 'exclude_body', 'include_headers'];
const extra = { includeBody: 'temperature: 0.42\n', excludeBody: '- top_p', includeHeaders: 'X-Fixture: test' };
const filled = [extra.includeBody, extra.excludeBody, extra.includeHeaders];
const row = { id: 'first', source: 'custom', site: '示例配置', key: 'fixture-key', model: 'fixture-model', url: 'https://fixture.invalid/v1' };
const source = ['catalog.js', 'connection.js']
  .map(file => fs.readFileSync(path.join(__dirname, '..', 'src', file), 'utf8')).join('\n')
  + '\nexport { createCatalogConnection };';

async function fixture(mode, validate = () => {}) {
  const calls = [];
  const context = vm.createContext({
    URL,
    async validateEntryExtraYaml(host, value) { calls.push('validate'); return validate(host, value); },
  });
  const module = new vm.SourceTextModule(source, {
    context,
    async importModuleDynamically(specifier) {
      assert.equal(specifier, '/scripts/secrets.js');
      assert.equal(mode, 'st');
      const shim = new vm.SyntheticModule(['readSecretState'], function () {
        this.setExport('readSecretState', async () => { calls.push('readSecretState'); });
      }, { context });
      await shim.link(() => { throw new Error('Unexpected import'); });
      await shim.evaluate();
      return shim;
    },
  });
  await module.link(() => { throw new Error('Unexpected static import'); });
  await module.evaluate();

  const legacy = names.map(name => 'legacy ' + name);
  const entry = Object.fromEntries(names.map(name => [name, 'old ' + name]));
  const sibling = { include_body: 'sibling body', exclude_body: 'sibling exclude', include_headers: 'sibling headers' };
  const settings = Object.fromEntries(names.map((name, i) => ['custom_' + name, legacy[i]]));
  if (mode === 'tt') settings.additional_parameters_by_source = { custom: entry, openai: sibling };
  const values = () => names.map(name => mode === 'tt' ? entry[name] : settings['custom_' + name]);
  const triggers = [];
  const makeTrigger = (id, value, options) => ({
    tagName: 'SELECT', value, options: options.map(value => ({ value })),
    dispatchEvent(event) { triggers.push({ id, event: event.type, values: values() }); },
  });
  const controls = {
    '#main_api': makeTrigger('api', 'other', ['openai', 'other']),
    '#chat_completion_source': makeTrigger('source', 'openai', ['custom', 'openai']),
    '#custom_api_url_text': { value: 'https://previous.invalid' },
  };
  for (const name of names) controls['#custom_' + name] = { value: 'previous UI' };

  const host = {
    ...(mode === 'tt' ? { __TAURITAVERN__: {} } : {}),
    document: { querySelector: query => controls[query] },
    Event: class { constructor(type) { this.type = type; } },
    async fetch(url) {
      assert.equal(url, '/api/secrets/read');
      calls.push('secrets');
      const secret = { id: 'fixture-id', active: true, value: row.key };
      return { ok: true, json: async () => ({ api_key_custom: [secret], api_key_openai: [secret] }) };
    },
  };
  const manager = module.namespace.createCatalogConnection(host, {
    chatCompletionSettings: settings,
    saveSettingsDebounced() { calls.push('save'); },
  }, {
    connectionState: {},
    async setConnectionState() {},
  });
  return { manager, calls, triggers, settings, entry, sibling, legacy, controls, values };
}

for (const mode of ['st', 'tt']) {
  test(mode + ' custom Apply writes extra parameters before native triggers and clears them for the next site', async () => {
    const f = await fixture(mode);
    await f.manager.apply({ ...row, extra });
    assert.equal(f.calls[0], 'validate');
    assert.deepEqual(f.values(), filled);
    assert.deepEqual(f.triggers, [{ id: 'api', event: 'change', values: filled }, { id: 'source', event: 'change', values: filled }]);
    assert.equal(f.controls['#custom_api_url_text'].value, row.url);
    if (mode === 'st') {
      assert.deepEqual(names.map(name => f.controls['#custom_' + name].value), filled);
    } else {
      assert.equal(f.settings.additional_parameters_by_source.custom, f.entry);
      assert.deepEqual(names.map(name => f.settings['custom_' + name]), f.legacy);
      assert.deepEqual(names.map(name => f.controls['#custom_' + name].value), names.map(() => 'previous UI'));
    }

    await f.manager.apply({ ...row, id: 'second', url: 'https://other.invalid/v1' });
    assert.deepEqual(f.values(), ['', '', '']);
    assert.deepEqual(f.triggers.at(-1).values, ['', '', '']);
    await f.manager.apply({ ...row, source: 'openai', extra });
    assert.deepEqual(f.values(), ['', '', '']);
    if (mode === 'tt') {
      assert.deepEqual(f.settings.additional_parameters_by_source.openai,
        { include_body: 'sibling body', exclude_body: 'sibling exclude', include_headers: 'sibling headers' });
    }
  });
}

test('invalid extra parameters abort custom Apply before secrets and settings are touched', async () => {
  const f = await fixture('st', () => { throw new Error('invalid parameters'); });
  await assert.rejects(f.manager.apply({ ...row, extra }), /invalid parameters/);
  assert.deepEqual(f.calls, ['validate']);
  assert.deepEqual(f.values(), f.legacy);
  assert.deepEqual(f.triggers, []);
  assert.equal(f.controls['#custom_api_url_text'].value, 'https://previous.invalid');
});
