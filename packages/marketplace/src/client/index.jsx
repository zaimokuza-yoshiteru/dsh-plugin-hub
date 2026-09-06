import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { Input, Button, Menu, Modal, Pill, StateDot, IconChevronDownOutline14 } from '@deepseek-ai/dsh-client-ui-primitives';
import { request as apiRequest } from './api.js';
import { inScope, resolveScope } from './scope.js';
import { words, tagKeys, diagnostic, localizePlugin } from './locale.js';
import css from './market.css';
const NS = __HUB_PACKAGE__;
const MARKET_ID = __HUB_ID__;
const BRAND = __HUB_BRAND__;
const request = (path, data, options) => apiRequest(path, data, { ...options, base: `/dsh-plugin-hub/${MARKET_ID}/api/` });

function Icon({ name = 'box', size = 18, ...props }) {
  const paths = {
    search: <><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/></>,
    box: <><path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="M3 8v9l9 5 9-5V8M12 13v9M7.5 5.5l9 5"/></>,
    download: <><path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/></>,
    arrow: <><path d="M7 17 17 7M7 7h10v10"/></>,
    refresh: <><path d="M20 7v5h-5M4 17v-5h5"/><path d="M5.2 7A8 8 0 0 1 19 6l1 2M4 16l1 2a8 8 0 0 0 13.8-1"/></>,
    clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
    check: <path d="m5 12 4 4L19 6"/>,
    close: <path d="m6 6 12 12M18 6 6 18"/>,
    code: <><path d="m8 6-6 6 6 6m8-12 6 6-6 6m-3-15-2 18"/></>,
    book: <><path d="M12 5v16M3 4c4-1 6 0 9 2 3-2 5-3 9-2v15c-4-1-6 0-9 2-3-2-5-3-9-2V4Z"/></>,
    plug: <><path d="M8 2v5m8-5v5M6 7h12v4a6 6 0 0 1-12 0V7ZM12 17v5"/></>,
    filter: <><path d="M4 7h16M7 12h10M10 17h4"/></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>{paths[name] ?? paths.box}</svg>;
}

/** Use the host's Menu and Button, including its portal and dismissal behavior. */
function Picker({ label, value, items, onChange, disabled, icon, title }) {
  const [open, setOpen] = useState(false);
  return <Menu open={open} onClose={() => setOpen(false)} items={items} selectedId={value} portal align="end"
    onSelect={id => { setOpen(false); onChange(id); }}
    anchor={<Button variant="outline" size="sm" disabled={disabled} aria-label={label} aria-haspopup="menu" aria-expanded={open} icon={icon} onClick={() => setOpen(v => !v)}>{title ?? items.find(item => item.id === value)?.label}<IconChevronDownOutline14/></Button>}/>;
}

function Badge({ tone = 'neutral', children }) {
  const state = { green: 'done', amber: 'warning', red: 'error', ongoing: 'ongoing' }[tone];
  return <Pill>{state && <StateDot state={state}/>} {children}</Pill>;
}

function status(plugin, release, t, hours) {
  if (plugin.metadataLoading) return { label: t('正在查询版本'), tone: 'ongoing' };
  if (plugin.queryError) return { label: t(plugin.queryError.includes('（404）') ? '当前仓库未找到' : plugin.queryError.includes('仓库与目录不一致') ? '来源不匹配' : plugin.queryError.includes('未声明可核对的 GitHub 来源') ? '来源未核实' : '查询失败'), tone: 'neutral' };
  if (!release || release.compatibility === 'unknown') return { label: t('兼容性未知'), tone: 'neutral' };
  if (release.compatibility === 'incompatible') return { label: t('版本不兼容'), tone: 'red' };
  if (release.age === 'waiting') return { label: t('未满 {hours} 小时', { hours }), tone: 'amber' };
  if (release.age === 'unknown') return { label: t('发布时间未知'), tone: 'neutral' };
  return release.canInstall ? { label: t('符合安装条件'), tone: 'green' } : { label: t('暂不可安装'), tone: 'neutral' };
}

export function Market({ locale, t }) {
  const language = useSyncExternalStore(listener => locale.subscribe(listener), () => locale.getSnapshot().active);
  const date = value => value ? new Date(value).toLocaleString(language.startsWith('zh') ? 'zh-CN' : language, { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }) : t('时间未知');
  const explain = value => diagnostic(value, t, language);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [connectionError, setConnectionError] = useState('');
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState('all');
  const [tag, setTag] = useState('all');
  const [visibleCount, setVisibleCount] = useState(40);
  useEffect(() => setVisibleCount(40), [query, tab, tag]);
  const [selected, setSelected] = useState({});
  const [detailName, setDetailName] = useState(null);
  const [showJobs, setShowJobs] = useState(false);
  const [submitting, setSubmitting] = useState({});

  useEffect(() => {
    const controller = new AbortController();
    let timer; let failures = 0;
    // Sequential polling prevents a disconnected instance from accumulating requests.
    async function poll(first = false) {
      try {
        const value = await request('state', undefined, { signal: controller.signal });
        if (!controller.signal.aborted) { setData(value); setConnectionError(''); failures = 0; }
      } catch (err) {
        if (!controller.signal.aborted) { setConnectionError(err.message); failures++; }
      } finally {
        if (!controller.signal.aborted) {
          if (first) setLoading(false);
          timer = setTimeout(() => poll(), Math.min(10000, 2000 * 2 ** failures));
        }
      }
    }
    void poll(true);
    return () => { controller.abort(); clearTimeout(timer); };
  }, []);

  const pendingVisible = (data?.lazyMetadata ? data.plugins.map(p => localizePlugin(p, language))

    .filter(p=>inScope(p,resolveScope(tab,data.sources??[]))&&(tag==='all'||p.tags.includes(tag))&&[p.displayName,p.packageName,p.description,p.owner,...p.tags.map(id=>tagKeys[id]?t(tagKeys[id]):id)].join(' ').toLowerCase().includes(query.trim().toLowerCase()))
    .slice(0,visibleCount).filter(p=>p.metadataLoading).slice(0,40).map(p=>p.packageName) : []).join('|');
  useEffect(() => {
    if(!pendingVisible)return;
    const controller=new AbortController();
    void request('releases',{packageNames:pendingVisible.split('|')},{signal:controller.signal}).catch(error=>{if(!controller.signal.aborted)setError(error.message);});
    return()=>controller.abort();
  },[pendingVisible]);

  function reportActionError(err) {
    if (['连接已断开，请确认本地 DSH 实例正在运行。恢复后页面会自动重连。', '请求超时，正在等待 DSH 响应。', '请先登录当前 DSH 实例', '服务返回了无效响应，请刷新 DSH 页面。'].includes(err.message)) setConnectionError(err.message);
    else setError(err.message);
  }
  async function update(path = 'refresh', body = {}) {
    setLoading(true); setError('');
    try { setData(await request(path === 'refresh' ? 'refresh-start' : path, body)); setConnectionError(''); }
    catch (err) { reportActionError(err); }
    finally { setLoading(false); }
  }
  async function install(plugin, release, action = 'install') {
    if (action === 'install' && !release?.canInstall) return;
    setSubmitting(previous => ({ ...previous, [plugin.packageName]: true })); setError('');
    try { await request(action, { packageName: plugin.packageName, ...(action === 'install' ? { version: release.version } : {}) }); setData(await request('state')); setShowJobs(true); setConnectionError(''); }
    catch (err) { reportActionError(err); }
    finally { setSubmitting(previous => ({ ...previous, [plugin.packageName]: false })); }
  }
  const releaseOf = plugin => plugin.versions.find(v => v.version === selected[plugin.packageName]) ?? plugin.versions.find(v => v.version === plugin.recommendedVersion) ?? plugin.versions[0];
  const linkFor = (plugin, key) => plugin[key];
  function documentLinks(plugin) {
    return <div className="hub-document-links">{[['documentationUrl', '介绍文档'], ['troubleshootingUrl', '排查指南']].filter(([key]) => plugin[key]).map(([key, label]) => <a className="hub-help-link" key={key} href={linkFor(plugin, key)} target="_blank" rel="noopener noreferrer" title={plugin[key]}>{t(label)} <Icon name="arrow" size={13}/></a>)}</div>;
  }
  function uninstallButton(plugin) {
    if (!plugin.installedVersion) return null;
    const job = data.jobs.find(job => job.packageName === plugin.packageName && ['queued', 'installing'].includes(job.status));
    return <Button size="sm" variant="outline" disabled={Boolean(job) || submitting[plugin.packageName] || Boolean(connectionError)} onClick={() => install(plugin, null, 'uninstall')}>{t(job?.action === 'uninstall' ? '正在卸载…' : '卸载插件')}</Button>;
  }
  function installButton(plugin, release) {
    const job = data.jobs.find(job => job.packageName === plugin.packageName && ['queued', 'installing'].includes(job.status));
    const installed = plugin.installedVersion === release?.version;
    const key = job ? job.status === 'queued' ? '已加入队列' : job.action === 'uninstall' ? '正在卸载…' : '正在安装…' : installed ? '已安装' : !release?.canInstall ? '暂不可安装' : '安装插件';
    return <Button variant={installed ? 'outline' : 'primary'} size="sm" disabled={!release?.canInstall || installed || Boolean(job) || submitting[plugin.packageName] || Boolean(connectionError)} onClick={() => install(plugin, release)} icon={<Icon name={installed ? 'check' : job ? 'clock' : 'download'} size={15}/>}>{t(key)}</Button>;
  }

  if (!data) return <section className="hub-market"><style>{css}</style><div className="hub-empty"><Icon name="box" size={38}/><h2>{BRAND.navTitle}</h2><p role={error || connectionError ? 'alert' : undefined}>{explain(error || connectionError) || t('正在读取插件目录…')}</p><Button variant="outline" onClick={() => update()}>{t('重新获取')}</Button></div></section>;
  const all = data.plugins.map(plugin => localizePlugin(plugin, language));
  const tags = Object.fromEntries(Object.entries(tagKeys).map(([key, label]) => [key, t(label)]));
  const sourceTabs = (data.sources ?? []).filter(source => !source.primary);
  const activeTab = resolveScope(tab, sourceTabs);
  const selectedSource = sourceTabs.find(source => activeTab === 'source:' + source.id);
  const tabs = [['all', '全部插件', all.length], ['installed', '已安装', all.filter(p => p.installedVersion).length], ...sourceTabs.map(source => ['source:' + source.id, source.displayName, all.filter(p => inScope(p, 'source:' + source.id)).length])];
  const filtered = all.filter(plugin => inScope(plugin, activeTab) && (tag === 'all' || plugin.tags.includes(tag)) && [plugin.displayName, plugin.packageName, plugin.description, plugin.owner, ...plugin.tags.map(item => tags[item] ?? item)].join(' ').toLowerCase().includes(query.trim().toLowerCase()));
  const detail = all.find(plugin => plugin.packageName === detailName);
  const pending = data.jobs.filter(job => ['queued', 'installing'].includes(job.status)).length;
  const ready = all.filter(plugin => plugin.recommendedVersion).length;

  const brand = data.brand ?? BRAND;
  return <section className="hub-market" lang={language} style={{ '--red': brand.primaryColor }}>
    <style>{css}</style>
    <div className="hub-topline"><span className="hub-brand"><span className="hub-brandmark">{brand.title.slice(0, 1)}</span>{brand.title} <span className="hub-divider"/> {brand.subTitle}</span><span className="hub-runtime"><i/>DSH {data.host.dsh}</span></div>
    <header className="hub-header"><div><div className="hub-eyebrow">{t('插件目录')}</div><h1>{t('插件市场')}<span>{t('。')}</span></h1><p>{t('找到适合当前 DSH 的工具。')}</p></div><div className="hub-header-art"><Icon name="box" size={44}/><span className="hub-art-plus">+</span><span className="hub-art-dot"/></div></header>
    <div className="hub-stats"><div><strong>{all.length.toString().padStart(2, '0')}</strong><span>{t('收录插件')}</span></div><div><strong>{ready.toString().padStart(2, '0')}</strong><span>{t(data.lazyMetadata ? '已确认可安装' : '有可安装版本')}</span></div></div>

    {(data.lazyMetadata || data.metadataProgress?.running) && <p>{t('已查询 {done} / {total} 个插件的版本', data.metadataProgress)}</p>}
    {data.catalog.error && <div className="hub-notice amber"><Icon name="clock"/><div><b>{t(data.catalog.stale ? '目录更新失败，继续使用上一份有效数据' : '目录暂不可用')}</b><span>{explain(data.catalog.error)}</span></div><Button size="sm" onClick={() => update()}>{t('重试')}</Button></div>}
    {connectionError && <div role="alert" className="hub-notice red"><span>{explain(connectionError)}</span><Button size="sm" onClick={() => update()}>{t('重试')}</Button></div>}
    {error && error !== connectionError && <div role="alert" className="hub-notice red"><span>{explain(error)}</span><Button size="sm" aria-label={t('关闭错误')} onClick={() => setError('')} icon={<Icon name="close"/>}/></div>}

    <nav className="hub-tabs" aria-label={t('插件范围')}>{tabs.map(([key, label, count]) => <Button key={key} size="sm" variant={activeTab === key ? 'toolbar' : 'ghost'} aria-pressed={activeTab === key} onClick={() => setTab(key)}>{t(label)}{count !== null && <span className="hub-tab-count">{count}</span>}</Button>)}</nav>
    <div className="hub-toolbar"><Input className="hub-search-input" icon={<Icon name="search" size={16}/>} aria-label={t('搜索插件')} placeholder={t('搜索插件、用途或维护团队')} value={query} onChange={event => setQuery(event.target.value)}/>{query && <Button size="sm" aria-label={t('清空搜索')} onClick={() => setQuery('')} icon={<Icon name="close" size={14}/>}/>}<Picker label={t('按标签筛选')} value={tag} items={[{ id: 'all', label: t('所有标签') }, ...Object.entries(tags).map(([id, label]) => ({ id, label }))]} onChange={setTag} icon={<Icon name="filter" size={16}/>}/><Button variant="outline" size="sm" disabled={loading} onClick={() => update()} title={t('刷新目录与版本')} icon={<Icon name="refresh" size={16} className={loading ? 'spinning' : ''}/>}>{t('刷新')}</Button></div>
    <div className="hub-results"><span>{query ? t('“{query}” 的搜索结果', { query }) : t(selectedSource?.displayName ?? (activeTab === 'installed' ? '你的工作工具' : '为团队精选'))} <b>{filtered.length}</b></span><small>{t('版本信息来自 npm · 按当前 DSH 检查声明')}</small></div>

    {selectedSource?.error && <div className="hub-notice amber"><span>{t(selectedSource.displayName)} · {explain(selectedSource.error)}{selectedSource.stale && ' · ' + t('使用缓存')}</span></div>}
    <div className="hub-grid">{filtered.slice(0, visibleCount).map((plugin, index) => {
      const release = releaseOf(plugin); const state = status(plugin, release, t, data.minimumAgeHours);
      return <article className="hub-card" key={plugin.packageName} style={{ '--card-index': index }}>
        <div className="hub-card-top"><span className={`hub-plugin-icon icon-${plugin.tags[0]}`}><Icon name={plugin.tags.includes('agent') ? 'plug' : plugin.tags[0] === 'knowledge' ? 'book' : plugin.tags.includes('developer-tools') ? 'code' : 'box'} size={25}/></span><Badge tone={state.tone}>{state.label}</Badge></div>
        <h2 className="hub-card-heading"><Button size="sm" onClick={() => setDetailName(plugin.packageName)}>{plugin.displayName}<Icon name="arrow" size={13}/></Button></h2>
        <code className="hub-card-package">{plugin.packageName}</code>
        {(data.sources?.length ?? 0) > 1 && <small className="hub-source-label">{t('来源')} · {t(plugin.catalogSource?.displayName ?? '')}</small>}
        <p className="hub-description">{plugin.description}</p>
        <div className="hub-tags">{plugin.tags.map(item => <Pill key={item}>{tags[item] ?? item}</Pill>)}</div>
        <div className="hub-version-row"><span>{t('选择版本')}</span><Picker label={t('{name}版本', { name: plugin.displayName })} value={release?.version ?? ''} disabled={!plugin.versions.length} items={plugin.versions.length ? plugin.versions.map(v => ({ id: v.version, label: v.version + (v.version === plugin.recommendedVersion ? ' · ' + t('推荐') : '') })) : [{ id: '', label: t('暂不可用') }]} onChange={value => setSelected(previous => ({ ...previous, [plugin.packageName]: value }))}/></div>
        <div className="hub-version-note">{plugin.queryError ? explain(plugin.queryError) : release?.canInstall ? t('发布于 {date}', { date: date(release.publishedAt) }) : explain(release?.reasons[0]) || t('没有可用版本')}</div>
        <div className="hub-card-actions">{installButton(plugin, release)}{uninstallButton(plugin)}</div>
        {documentLinks(plugin)}
      </article>;
    })}</div>
    {filtered.length > visibleCount && <div className="hub-pagination"><Button variant="outline" size="sm" onClick={() => setVisibleCount(value => value + 40)}>{t('加载更多')}</Button></div>}
    {!filtered.length && <div className="hub-empty"><Icon name="search" size={32}/><h3>{t('没有找到匹配的插件')}</h3><p>{t('试试其它关键词，或清除当前筛选条件。')}</p><Button variant="outline" onClick={() => { setQuery(''); setTag('all'); setTab('all'); }}>{t('查看全部插件')}</Button></div>}
    <footer className="hub-footer"><span><i/>{t('目录 {version} · 更新于 {date}', { version: data.catalog.version ?? t('未加载'), date: date(data.catalog.updatedAt) })}</span><span>{t('市场 v{version}', { version: data.marketVersion })}</span></footer>
    <p className="hub-footnote">{t('“符合安装条件”依据版本声明与发布时间，实际下载仍以 Nexus 为准。')}</p>

    {!!data.jobs.length && <aside className="hub-queue"><div className="hub-queue-summary"><span className="hub-queue-icon"><Icon name={pending ? 'download' : 'check'}/></span><span><b>{pending ? t('{count} 个插件操作正在执行', { count: pending }) : t('插件操作已完成')}</b><small>{t('{count} 项待手动重启生效', { count: data.pendingRestart })}</small></span><Button size="sm" onClick={() => setShowJobs(!showJobs)} aria-expanded={showJobs}>{t(showJobs ? '收起' : '查看任务')}</Button></div>{showJobs && <div className="hub-jobs">{data.jobs.slice().reverse().map(job => <div key={job.id}><span><b>{all.find(p => p.packageName === job.packageName)?.displayName ?? job.packageName}</b><small>{t(job.action === 'uninstall' ? '卸载' : '安装')} · {job.version}</small></span><Badge tone={job.status === 'completed' ? 'green' : job.status === 'failed' ? 'red' : 'amber'}>{t({ queued: '排队中', installing: job.action === 'uninstall' ? '卸载中' : '安装中', completed: '待重启', failed: job.action === 'uninstall' ? '卸载失败' : '安装失败' }[job.status])}</Badge>{job.error && <p>{explain(job.error)}</p>}</div>)}</div>}</aside>}

    <Modal open={Boolean(detail)} onClose={() => setDetailName(null)} title={detail?.displayName ?? ''} closeLabel={t('关闭详情')} className="hub-detail-dialog" contentClassName="hub-detail-scroll" description={detail?.description} footer={detail && <div className="hub-detail-actions"><div>{installButton(detail, releaseOf(detail))}{uninstallButton(detail)}</div>{documentLinks(detail)}</div>}>
      {detail && <div className="hub-detail-body"><code className="hub-package-name">{detail.packageName}</code><div className="hub-detail-info"><span>{t('维护团队')}<b>{detail.owner}</b></span><span>{t('当前宿主')}<b>DSH {data.host.dsh}</b></span></div><h3>{t('发行版本')}</h3><div className="hub-releases">{detail.versions.map(release => { const state = status(detail, release, t, data.minimumAgeHours); return <div key={release.version} className="hub-release"><div><Button variant={releaseOf(detail)?.version === release.version ? 'toolbar' : 'outline'} size="sm" aria-pressed={releaseOf(detail)?.version === release.version} onClick={() => setSelected(previous => ({ ...previous, [detail.packageName]: release.version }))}>{release.version}</Button><Badge tone={state.tone}>{state.label}</Badge></div><small>{t('发布时间 {date} · DSH {range}', { date: date(release.publishedAt), range: release.dshRange ?? t(release.compatibilityBasis === 'dshPluginHub.hostCompatibility' ? '不按版本限制，运行时检查接口' : release.compatibilityBasis === 'peerDependencies' ? '宿主依赖声明' : release.compatibilityBasis?.includes('dshReleases') ? '作者逐版本声明' : '未声明') })}</small>{release.reasons.length > 0 && <p>{release.reasons.map(explain).join(' · ')}</p>}{release.age === 'waiting' && <small>{t('预计满 {hours} 小时：{date}', { hours: data.minimumAgeHours, date: date(release.eligibleAt) })}</small>}</div>; })}{detail.queryError && <p>{explain(detail.queryError)}</p>}</div></div>}
    </Modal>
  </section>;
}

export const name = NS;
export const inject = ['slots', 'locale'];
export function apply(ctx) {
  ctx.effect(() => ctx.locale.register(NS, words), 'Plugin Hub: dictionaries');
  const t = ctx.locale.bind(NS);
  ctx.slots.inject('settings.section', () => ctx.slots.register({ name: 'settings.section', id: MARKET_ID, order: 39, label: () => BRAND.navTitle, locale: NS }, () => <Market locale={ctx.locale} t={t}/>));
}
