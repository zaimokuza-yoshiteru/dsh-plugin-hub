// Registered with the DSH locale service. Catalog copy remains data-owned.
const pairs = [
  ['冷静期：{minutes} 分钟 · {source}', 'Release age: {minutes} minutes · {source}'],
  ['本机 pnpm 配置', 'Local pnpm configuration'], ['默认 48 小时', 'Default 48 hours'],
  ['未满 {minutes} 分钟', 'Under {minutes} minutes'], ['预计满 {minutes} 分钟：{date}', 'Eligible after {minutes} minutes: {date}'],
  ['不按版本限制，运行时检查接口','No version gate; runtime API checks'],
  ['目录格式不受支持：需要 schemaVersion: 1 和 plugins 数组','Unsupported catalog: expected schemaVersion: 1 and a plugins array'],
  ['目录最多支持 25000 个插件','A catalog supports at most 25000 plugins'],
  ['插件记录必须为对象','Plugin entry must be an object'],
  ['npm 包名无效','Invalid npm package name'], ['npm 包名重复','Duplicate npm package name'],
  ['目录包 plugins.json 重复或过大','Catalog plugins.json is duplicated or too large'],
  ['目录过大','Catalog is too large'], ['目录包缺少 plugins.json','Catalog package is missing plugins.json'],
  ['仓库请求地址不属于配置的 Nexus','Registry request does not belong to the configured Nexus'],
  ['Invalid release request','Invalid release request','无效的版本查询请求'],
  ['Invalid catalog source id','Invalid catalog source ID','无效的数据源 ID'],
  ['Invalid catalog package name','Invalid catalog package name','无效的目录数据包名'],
  ['At most 20 catalog sources are supported','At most 20 catalog sources are supported','最多支持 20 个数据源'],
  ['Catalog source kind must be npm or json','Catalog source kind must be npm or json','数据源类型必须是 npm 或 json'],
  ['JSON source requires getCatalog({ signal })','JSON source requires getCatalog({ signal })','JSON 数据源需要 getCatalog({ signal })'],
  ['Source priority must be an integer between -1000 and 1000','Source priority must be an integer between -1000 and 1000','数据源优先级必须为 -1000 到 1000 的整数'],
  ['Invalid source displayName','Invalid source displayName','无效的数据源显示名称'],
  ['Invalid source cacheVersion','Invalid source cacheVersion','无效的数据源缓存版本'],
  ['兼容声明存在冲突，需要维护者确认','Compatibility declarations conflict; the maintainer must clarify'],
  ['声明不支持当前 DSH profile','This DSH profile is not covered by the declaration'],
  ['作者逐版本声明','Author release declaration'],
  ['不支持的请求方法','Unsupported request method'], ['接口不存在','Endpoint not found'], ['请求过大','Request body is too large'],
  ['目录 npm 包没有 integrity，无法校验','Catalog package has no integrity field'],
  ['目录 npm 包完整性校验失败','Catalog package integrity check failed'],
  ['目录来源必须是 npm 数据包','Catalog source must be an npm data package'],
  ['目录 npm 包没有可下载的 latest 版本','Catalog package has no downloadable latest release'],
  ['目录 tarball 地址不属于配置的仓库','Catalog tarball does not belong to the configured registry'],
  ['插件命令失败','Plugin command failed'],
  ['安装命令结束，但实际版本不匹配','Installation finished but the installed version does not match'],
  ['包已下载，但尚未注册为 DSH bundle','Package downloaded but not registered as a DSH bundle'],
  ['卸载命令结束，但插件仍在 profile 中','Uninstall finished but the plugin is still in the profile'],
  ['插件操作超时，请检查 profile 后重试','Plugin operation timed out; check the profile and retry'],
  ['来源未核实','Source unverified'],
  ['宿主依赖声明','Host peer declarations'], ['兼容依据：{basis}','Compatibility evidence: {basis}'],

  ['已确认可安装','Confirmed installable'],
  ['当前 npm 仓库未找到此包（404）','Package not found in this npm registry (404)'],
  ['当前仓库未找到','Not found in this registry'], ['来源不匹配','Source mismatch'],
  ['npm 包未声明可核对的 GitHub 来源','The npm package does not declare a verifiable GitHub repository'],
  ['npm 包对应的 GitHub 仓库与目录不一致','The npm package points to a different GitHub repository'],
  ['该版本的 npm 来源无法与目录仓库核对','This npm version cannot be matched to the catalog repository'],
  ['正在查询版本','Loading releases'], ['加载更多','Load more'],
  ['已查询 {done} / {total} 个插件的版本','Loaded releases for {done} / {total} plugins'],

  ['插件目录','Plugin directory'],
  ['数据源','Data sources'], ['关闭数据源','Close data sources'], ['来源','Source'], ['Company catalog','Company catalog','公司目录'], ['Demo catalog','Demo catalog','演示目录'], ['Team handbook','Team handbook','团队手册目录'], ['npm 数据包','npm data package'], ['扩展插件 JSON','Provider plugin JSON'], ['已加载','Loaded'], ['使用缓存','Using cache'], ['目录来源读取超时','Catalog source timed out'], ['目录来源读取已取消','Catalog source read cancelled'], ['优先级 {priority} · {count} 个插件','Priority {priority} · {count} plugins'], ['已合并 {count} 条重复记录','Merged {count} duplicate entries'], ['同名插件按来源优先级保留一条；优先级相同时按来源 ID 排序。','Duplicate package names use the highest-priority source; equal priorities are ordered by source ID.'],
  ['介绍文档','Documentation'], ['模拟卸载','Simulate uninstall'], ['卸载插件','Uninstall plugin'], ['正在卸载…','Uninstalling…'], ['卸载中','Uninstalling'], ['卸载失败','Uninstall failed'], ['卸载','Uninstall'], ['安装','Install'], ['模拟操作已完成','Simulated operations finished'], ['插件操作已完成','Plugin operations finished'], ['{count} 个插件操作正在执行','{count} plugin operations in progress'], ['该插件尚未安装','This plugin is not installed'], ['该插件已有其它操作，请等待完成','Wait for the other operation on this plugin to finish'], ['请通过 DSH CLI 管理市场插件自身','Manage the marketplace itself through the DSH CLI'], ['无效的插件操作','Invalid plugin operation'],

  ['nav','Plugin Hub','Plugin Hub'],
  ['插件市场','Marketplace'], ['。','.'], ['找到适合当前 DSH 的工具。','Find the right tools for your current DSH.'],
  ['收录插件','Plugins'], ['有可安装版本','Installable'], ['使用与故障排查','Help & troubleshooting'],
  ['本地演示','Local demo'], ['Nexus npm 请求已拦截，目录包、版本与安装结果均为模拟。','Nexus npm requests are mocked, including the catalog package, versions and installs.'],
  ['切换场景','Demo scenarios'], ['正常目录','Normal catalog'], ['新插件登记','New plugin registered'], ['目录格式损坏','Invalid catalog JSON'], ['目录源不可用','Catalog unavailable'], ['查看拦截请求','View intercepted requests'], ['重置模拟安装','Reset simulated installs'],
  ['目录更新失败，继续使用上一份有效数据','Catalog update failed. Using the last valid catalog.'], ['目录暂不可用','Catalog is currently unavailable'], ['重试','Retry'], ['关闭错误','Dismiss error'], ['关闭请求记录','Close request log'], ['请求拦截记录','Intercepted requests'], ['独立 MockAgent 返回 npm 元数据和目录压缩包，不连接真实 Nexus。','An isolated MockAgent returns npm metadata and catalog tarballs without contacting a real Nexus.'],
  ['插件范围','Plugin scope'], ['全部插件','All plugins'], ['内部插件','Internal'], ['社区精选','Community'], ['已安装','Installed'], ['搜索插件','Search plugins'], ['搜索插件、用途或维护团队','Search plugins, purpose or owner'], ['清空搜索','Clear search'], ['按标签筛选','Filter by tag'], ['所有标签','All tags'], ['刷新','Refresh'], ['刷新目录与版本','Refresh catalog and versions'], ['“{query}” 的搜索结果','Results for “{query}”'], ['你的工作工具','Your tools'], ['为团队精选','Curated tools'], ['版本信息来自 npm · 按当前 DSH 检查声明','npm versions · checked against this DSH'],
  ['内部','Internal'], ['精选','Curated'], ['选择版本','Version'], ['{name}版本','{name} version'], ['暂不可用','Unavailable'], ['推荐','Recommended'], ['发布于 {date}','Published {date}'], ['没有可用版本','No releases available'], ['排查指南','Troubleshooting'],
  ['查询失败','Query failed'], ['兼容性未知','Compatibility unknown'], ['版本不兼容','Incompatible'], ['未满 {hours} 小时','Under {hours} hours'], ['发布时间未知','Release date unknown'], ['符合安装条件','Eligible to install'], ['暂不可安装','Not installable'],
  ['已加入队列','Queued'], ['正在安装…','Installing…'], ['演示已安装','Demo installed'], ['模拟安装','Simulate install'], ['安装插件','Install plugin'], ['正在读取插件目录…','Loading plugin catalog…'], ['重新获取','Try again'], ['时间未知','Unknown time'],
  ['没有找到匹配的插件','No matching plugins'], ['试试其它关键词，或清除当前筛选条件。','Try another keyword or clear your filters.'], ['查看全部插件','View all plugins'], ['未加载','Not loaded'], ['目录 {version} · 更新于 {date}','Catalog {version} · updated {date}'], ['市场 v{version}','Marketplace v{version}'],
  ['“符合安装条件”依据版本声明与发布时间，实际下载仍以 Nexus 为准。','Eligibility is based on version declarations and release dates. Nexus determines actual download availability.'], ['本页包含模拟版本声明，不代表这些插件的真实兼容范围。','Version declarations on this page are simulated and do not represent actual plugin compatibility.'],
  ['{count} 个插件正在排队或安装','{count} plugins queued or installing'], ['模拟安装已完成','Simulated installs finished'], ['安装任务已完成','Install tasks finished'], ['{count} 项模拟完成 · 不修改真实插件','{count} simulated operations completed · no real plugins changed'], ['{count} 项待手动重启生效','{count} installs awaiting a manual restart'], ['收起','Collapse'], ['查看任务','View tasks'], ['排队中','Queued'], ['安装中','Installing'], ['模拟完成','Simulated'], ['待重启','Restart required'], ['安装失败','Install failed'],
  ['关闭详情','Close details'], ['维护团队','Maintainer'], ['当前宿主','Current host'], ['发行版本','Releases'], ['发布时间 {date} · DSH {range}','Published {date} · DSH {range}'], ['未声明','Not declared'], ['预计满 {hours} 小时：{date}','Eligible after {hours} hours: {date}'], ['打开 troubleshooting','Open troubleshooting'],
  ['Agent 接入','Agent access'], ['开发工具','Developer tools'], ['知识文档','Knowledge'], ['效率工具','Productivity'], ['系统集成','Integrations'], ['界面','Interface'],
  ['连接已断开，请确认本地 DSH 实例正在运行。恢复后页面会自动重连。','Disconnected. Check that the local DSH instance is running. This page will reconnect automatically.'],
  ['请求超时，正在等待 DSH 响应。','Request timed out while waiting for DSH.'], ['请先登录当前 DSH 实例','Please authenticate with this DSH instance'], ['请求来源不匹配','Request origin does not match this DSH instance'], ['服务返回了无效响应，请刷新 DSH 页面。','The server returned an invalid response. Reload the DSH page.'],
  ['未提供有效的 DSH 兼容声明','No valid DSH compatibility declaration'], ['仓库未返回有效发布时间','The registry did not provide a valid release date'], ['返回内容不是有效 JSON，已保留上一份可用数据','Invalid JSON received. The last valid catalog has been retained.'], ['仓库没有返回有效的发行版本','The registry returned no valid releases'], ['上次进程中断，请重新安装','The previous process was interrupted. Please install again.'], ['市场正在关闭','Marketplace is shutting down'], ['插件不在当前目录中','Plugin is not in the current catalog'], ['该版本不可安装','This version cannot be installed'], ['安装队列已满','Install queue is full'], ['无效的演示场景','Invalid demo scenario'], ['只在演示模式可用','Only available in demo mode'], ['响应超过大小限制','Response exceeds the size limit'],
];
export const words = { zh: {}, en: {} };
for (const [key, en, zh = key] of pairs) { words.zh[key] = zh; words.en[key] = en; }
export const tagKeys = { agent: 'Agent 接入', 'developer-tools': '开发工具', knowledge: '知识文档', productivity: '效率工具', integration: '系统集成', ui: '界面' };

// Preserve third-party diagnostics verbatim; translate known marketplace diagnostics.
export function diagnostic(value, t, language) {
  if (!value) return '';
  if (words.en[value]) return t(value);
  if (value.includes('；') || value.includes('; ')) return value.split(/；|; /).map(part => diagnostic(part, t, language)).join(language.startsWith('zh') ? '；' : '; ');
  const entry = value.match(/^目录第 (\d+) 条：(.*)$/);
  if (entry && !language.startsWith('zh')) return `Catalog entry ${entry[1]}: ${diagnostic(entry[2], t, language)}`;
  if (language.startsWith('zh')) return value.replace(/^Duplicate catalog source id: (.+)$/, '数据源 ID 重复：$1');
  return value
    .replace(/(\S+) 无效/g, 'Invalid $1')
    .replace(/(\S+) 不是有效 URL/g, '$1 is not a valid URL')
    .replace(/(\S+) 必须是无凭据的 HTTPS 链接/g, '$1 must be an HTTPS URL without credentials')
    .replace(/请求失败[（ ]HTTP (\d+)[）]?/g, 'Request failed (HTTP $1)')
    .replace(/作者声明不兼容 DSH (.+)/g, 'The author declares DSH $1 incompatible')
    .replace(/插件命令失败（退出码 (\d+)）/g, 'Plugin command failed (exit code $1)')
    .replace(/要求 DSH (.+)，当前为 (.+)/g, 'Requires DSH $1; current version is $2')
    .replace(/要求 Node (.+)/g, 'Requires Node $1')
    .replace(/无法确认宿主接口 (.+)/g, 'Cannot verify host interface $1')
    .replace(/(.+) 要求 (.+)，当前为 (.+)/g, '$1 requires $2; current version is $3')
    .replace(/不支持当前 (os|cpu): (.+)/g, 'Unsupported $1: $2')
    .replace(/发布未满 (\d+) 小时/g, 'Published less than $1 hours ago')
    .replace(/发布未满 (\d+) 分钟/g, 'Published less than $1 minutes ago')
    .replace(/已弃用：(.*)/g, 'Deprecated: $1');
}

export function localizePlugin(plugin, language) {
  const locale = plugin.locales?.[language] ?? plugin.locales?.[language.split('-')[0]];
  return locale ? { ...plugin, ...locale } : plugin;
}
