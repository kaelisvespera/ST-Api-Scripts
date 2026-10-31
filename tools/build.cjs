const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
let code = fs.readFileSync(path.join(root, 'src', 'upstream-index-2.1.1.js'), 'utf8');
function replaceOnce(before, after) {
  if (code.split(before).length !== 2) throw new Error('Patch location changed: ' + before.slice(0, 100));
  code = code.replace(before, after);
}
replaceOnce("await import('/scripts/popup.js')", 'await ttPopupApi()');
replaceOnce(
  "const n=window.parent.SillyTavern?.getContext?.();if(!n||!n.generateRaw)throw new cr('无法访问 generateRaw 函数','unknown');const o=await n.generateRaw(",
  'const o=await ttGenerateRaw(',
);
// TT routes custom endpoint status itself; explicitly select OpenAI wire format.
replaceOnce("chat_completion_source:'custom',custom_url:Ar(e).baseUrl", "chat_completion_source:'custom',custom_api_format:'openai_compat',custom_url:Ar(e).baseUrl");
// TT 2.4 does not implement the upstream SubModel provider.
replaceOnce("return Object.prototype.hasOwnProperty.call(Zo.RP,e)", "return e!=='submodel'&&Object.prototype.hasOwnProperty.call(Zo.RP,e)");
code = require('./grouping-patch.cjs')(code);
code = require('./create-apply-patch.cjs')(code);
// Replace both application and generation-time registration with the same
// verified key-to-secret binding. Do not mutate the preserved upstream file.
const secretStart = code.indexOf('async function RA(');
const secretEnd = code.indexOf('class GA', secretStart);
const activeStart = code.indexOf('async function JA(');
const activeEnd = code.indexOf('function tc(', activeStart);
if (secretStart < 0 || secretEnd < 0 || activeStart < 0 || activeEnd < 0) throw new Error('Cannot find secret synchronizers');
code = code.slice(0, activeStart) + code.slice(activeEnd);
code = code.slice(0, secretStart) + fs.readFileSync(path.join(root, 'src', 'tt-secrets.js'), 'utf8') + '\n' + code.slice(secretEnd);
const applyStart = code.indexOf('async function Ac(');
const applyEnd = code.indexOf('function cc(', applyStart);
if (applyStart < 0 || applyEnd < 0) throw new Error('Cannot find native settings writer');
code = code.slice(0, applyStart) + fs.readFileSync(path.join(root, 'src', 'tt-apply-settings.js'), 'utf8') + '\n' + code.slice(applyEnd);
const version = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8')).version;
replaceOnce("wl='2.1.1'", `wl='${version}'`);
code = code.replace(/\n\/\/# sourceMappingURL=index\.js\.map\s*$/, '\n');
const output = fs.readFileSync(path.join(root, 'src', 'tt-bootstrap.js'), 'utf8') + '\n' + code;
fs.writeFileSync(path.join(root, 'ST-ApiManager', 'index-2.1.1-tt2.4.js'), output);
console.log('Built TT 2.4 adaptation (' + Buffer.byteLength(output) + ' bytes).');

// The native extension reuses the UI and provider adapters, with host events
// instead of Tavern Helper's script buttons and iframe style teleportation.
replaceOnce("replaceScriptButtons([{name:zd,visible:!0}]),eventOn(getButtonEvent(zd),()=>{Pd()}),", '');
replaceOnce('eventMakeFirst(tavern_events.CHAT_COMPLETION_SETTINGS_READY,', 'ttOnSettingsReady(');
if (code.split('getScriptId()').length !== 3) throw new Error('Script container anchors changed');
code = code.replaceAll(".attr('script_id',getScriptId())", ".attr('data-st-api-manager-extension','st-api-manager')");
replaceOnce("wd=function(e='head'){const t=$('<div>').attr('data-st-api-manager-extension','st-api-manager').append($('head > style',document).clone()).appendTo(e);return{destroy:()=>t.remove()}}(n.head)", 'wd=null');
const nativeOutput = "import * as Vue from './vendor/vue-3.5.22.runtime.esm-browser.prod.js';\n"
  + "import * as z from './vendor/zod-3.23.8.mjs';\n"
  + fs.readFileSync(path.join(root, 'src', 'native-bootstrap.js'), 'utf8') + '\n' + code;
fs.writeFileSync(path.join(root, 'index.js'), nativeOutput);
console.log('Built native extension (' + Buffer.byteLength(nativeOutput) + ' bytes).');
