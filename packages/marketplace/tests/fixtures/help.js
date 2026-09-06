const escape = text => String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export function demoHelp(plugin, language, kind = 'troubleshooting') {
  const en = !language.startsWith('zh');
  const name = en ? plugin.locales?.en?.displayName ?? plugin.displayName : plugin.displayName;
  const t = (zh, english) => en ? english : zh;
  if (kind === 'documentation') return `<!doctype html><html lang="${en ? 'en' : 'zh-CN'}"><meta charset="utf-8"><title>${t('介绍文档', 'Documentation')} · ${escape(name)}</title><style>body{font:16px/1.8 system-ui;max-width:760px;margin:70px auto;padding:24px;color:#292b30;background:#faf9f7}small{color:#bd2032}code{background:#eee;padding:3px 6px}</style><small>Plugin Hub · ${t('本地演示介绍文档', 'Local demo documentation')}</small><h1>${escape(name)}</h1><code>${escape(plugin.packageName)}</code><p>${escape(en ? plugin.locales?.en?.description ?? plugin.description : plugin.description)}</p><h2>${t('开始使用', 'Getting started')}</h2><p>${t('在市场选择兼容版本并完成安装，手动重启 DSH 后开始使用。此页面仅为介绍文档跳转演示，没有访问公司 Confluence。', 'Choose a compatible version in the marketplace, install it and restart DSH manually. This page demonstrates a documentation link without contacting company Confluence.')}</p><p>${t('正式文档地址：', 'Production documentation URL:')} ${escape(plugin.documentationUrl)}</p></html>`;
  return `<!doctype html><html lang="${en ? 'en' : 'zh-CN'}"><meta charset="utf-8"><title>Troubleshooting · ${escape(name)}</title><style>body{font:16px/1.8 system-ui;max-width:760px;margin:70px auto;padding:24px;color:#292b30;background:#faf9f7}small{color:#bd2032}h1{font-size:32px}code{background:#eee;padding:3px 6px}</style>
  <small>Plugin Hub · ${t('本地演示帮助页', 'Local demo help')}</small><h1>${escape(name)}</h1>
  <p>${t('正式环境会打开 JSON 中的 Confluence troubleshooting 地址。这里展示本地样例，没有访问公司 Confluence。', 'In production, this link opens the Confluence troubleshooting URL from the catalog. This is a local example; it does not contact company Confluence.')}</p>
  <p><code>${escape(plugin.packageName)}</code></p>
  <h2>${t('安装提示未满 48 小时', 'Release is less than 48 hours old')}</h2><p>${t('等待发布时间窗口结束，或选择满足条件的旧版本。若依赖仍被 Nexus 拦截，请联系仓库维护者。', 'Wait for the release window to end or choose an eligible older version. If Nexus still blocks dependencies, contact the registry owner.')}</p>
  <h2>${t('提示版本不兼容', 'Incompatible version')}</h2><p>${t('核对当前 DSH 与插件版本声明，选择匹配版本。声明缺失时请联系', 'Check the DSH compatibility declaration and choose a matching version. For missing declarations, contact')} ${escape(plugin.owner)}.</p>
  <h2>${t('安装后没有生效', 'Plugin does not appear after installation')}</h2><p>${t('完成其它插件安装后，手动重启当前 DSH 实例。', 'Finish installing other plugins, then restart this DSH instance manually.')}</p>
  <p>${t('正式帮助地址：', 'Production help URL:')} ${escape(plugin.troubleshootingUrl)}</p></html>`;
}
