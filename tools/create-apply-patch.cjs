'use strict';

// Applying a saved connection writes local host settings. Network health checks
// remain in the explicit detect / test actions, not in either switching path.
module.exports = function patchApplyConfig(code) {
  function section(startMarker, endMarker, replacements) {
    const start = code.indexOf(startMarker);
    const end = code.indexOf(endMarker, start);
    if (start < 0 || end < 0) throw new Error('Cannot find API apply section');
    let body = code.slice(start, end);
    for (const [before, after] of replacements) {
      if (body.split(before).length !== 2) throw new Error('Unexpected API apply conversion: ' + before.slice(0, 80));
      body = body.replace(before, after);
    }
    code = code.slice(0, start) + body + code.slice(end);
  }
  section('function Mc(){', 'function Kc(', [
    [
      "o.lastHealthStatus='unhealthy',o.lastHealthError=e,p(),sr().error(e)",
      'sr().error(e)',
    ],
    [
      "const{result:t,keyIndex:r}=await zr(o,async(e,t,n)=>{let r=o.customModel?[o.customModel]:[];i({step:'verifying',message:'检查配置健康状态'}),function(e){return!!e.lastVerifiedAt&&Date.now()-e.lastVerifiedAt<3e5&&'healthy'===e.lastHealthStatus}(o)&&o.lastVerifiedKeyIndex===n||(r=await async function(e,t,n){const o=await br(e.customUrl,t||void 0);return e.lastVerifiedAt=Date.now(),e.lastVerifiedKeyIndex=n,e.lastHealthStatus='healthy',e.lastHealthError=void 0,o}(o,e,n)),i({step:'connecting',message:'连接酒馆并同步模型'});return await Ac(o,{apiKey:e,keyItem:t,knownModels:r,onProgress:e=>{i({step:'connecting',message:e})}})})",
      "const ttKeyIndex=Er(o),ttKeyItem=o.apiKeys[ttKeyIndex];if(!ttKeyItem?.key.trim())throw new GA('当前 API Key 为空，请选择有效密钥','write');i({step:'applying',message:'写入酒馆连接配置'});const t=await Ac(o,{apiKey:ttKeyItem.key,keyItem:ttKeyItem,onProgress:e=>{i({step:'applying',message:e})}})",
    ],
    [
      "o.isActive=!0,o.lastVerifiedKeyIndex=r,o.lastHealthStatus='healthy',o.lastHealthError=void 0,o.lastVerifiedAt=Date.now(),p()",
      'o.isActive=!0,p()',
    ],
    [
      "const t=function(e,t){const n=pr(t);return e.lastVerifiedAt=Date.now(),e.lastHealthStatus='unhealthy',e.lastHealthError=n.message,n}(o,e),n=e instanceof GA?",
      'const t=e instanceof GA?e:pr(e),n=e instanceof GA?',
    ],
    [
      "n=e instanceof GA?function(e,t){switch(e){case'context':return'原生 API 面板未就绪，无法写入配置';case'write':return t||'写入原生 API 配置失败';case'connect':return'未找到原生连接按钮，无法同步配置';case'models':return'已写入配置，但未获取到模型列表';default:return t||'应用失败'}}(e.stage,t.message):t.message||'应用失败'",
      "n=t.message||'应用失败'",
    ],
  ]);
  section('handleSwitchInCategory:async function(t,o,r){', ',resetFilterState:', [
    [
      'const{result:r,keyIndex:a}=await zr(c,async(e,t)=>{const n=await o(c.customUrl,e||void 0);return Ac(c,{apiKey:e,keyItem:t,knownModels:n})});if(r)',
      "const ttKeyIndex=Er(c),ttKeyItem=c.apiKeys[ttKeyIndex];if(!ttKeyItem?.key.trim())throw new GA('当前 API Key 为空，请选择有效密钥','write');const ttApplied=await Ac(c,{apiKey:ttKeyItem.key,keyItem:ttKeyItem});if(ttApplied)",
    ],
    [
      "c.isActive=!0,c.lastVerifiedAt=Date.now(),c.lastVerifiedKeyIndex=a,c.lastHealthStatus='healthy',c.lastHealthError=void 0,g()",
      'c.isActive=!0,g()',
    ],
  ]);
  return code;
};
