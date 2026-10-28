'use strict';

// Patch only the site's save conversion; explicit category actions stay unchanged.
module.exports = function patchGrouping(code) {
  const start = code.indexOf('saveEditForm:function(t,n){const o=function(e,t,n){');
  const end = code.indexOf('}(t,n,e.value);', start);
  if (start < 0 || end < 0) throw new Error('Cannot find API manager save conversion');
  let save = code.slice(start, end);
  const replacements = [
    ['let p,m,u,g=[],C=[...n];', 'let p,m,u,C=[...n];'],
    ['m=e.groupKey,g=es(e),u=', 'm=e.groupKey,u='],
    [
      'const f=e.selectedModels.map(e=>e.trim()).filter(Boolean),b=f.length>0?f:[\'\'],v=0===a.length||0===f.length,h=b.map(t=>({',
      'const ttPreviousGroup=n.filter(e=>e.groupKey===(m||d)),ttCategories=new Map(ttPreviousGroup.map(e=>[e.customModel.trim(),es(e)]));if(null===t){const ttActive=ttPreviousGroup.find(e=>e.isActive);ttActive&&(p=ttActive.customModel)}const f=e.selectedModels.map(e=>e.trim()).filter(Boolean),b=null===t?Array.from(new Set([...ttPreviousGroup.map(e=>e.customModel.trim()).filter(Boolean),...f])):f,v=0===a.length||0===b.length,h=(b.length?b:[\'\']).map(t=>({',
    ],
    ['categoryId:g[0],categoryIds:g,', 'categoryId:ttCategories.get(t)?.[0],categoryIds:[...(ttCategories.get(t)||[])],'],
    ['if(null!==t&&p){const e=h.find', 'if(p){const e=h.find'],
  ];
  for (const [before, after] of replacements) {
    if (save.split(before).length !== 2) throw new Error('Unexpected API manager grouping conversion');
    save = save.replace(before, after);
  }
  return code.slice(0, start) + save + code.slice(end);
};
