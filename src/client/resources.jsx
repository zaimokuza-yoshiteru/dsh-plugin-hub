import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Button, Input, Menu, Modal, Pill, Tag, StateDot, Switch, Tooltip, MarkdownText,
  IconCordisPluginOutline14, IconSearchOutline16, IconRefreshOutline16, IconFolderOpenOutline16, IconCloseOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives';
import css from './resources.css';
import { mcpFields } from './mcp-help.js';
import marketCss from './market.css';


function ItemIcon({ row }) {
  const [failed, setFailed] = useState(false);
  const label = row.name.split('/').pop().replace(/^@/, '').slice(0, 1).toLocaleUpperCase();
  return <span className="hub-item-icon" aria-hidden="true">{row.icon && !failed ? <img src={row.icon} alt="" referrerPolicy="no-referrer" onError={() => setFailed(true)}/> : label}</span>;
}

function ScopePicker({ data, scope, setScope, t, disabled }) {
  const [open, setOpen] = useState(false);
  const items = [{ id: '', label: t('全局') }, ...(data?.workspaces ?? []).map(row => ({ id: row.id, label: row.title }))];
  return <Menu open={open} onClose={() => setOpen(false)} items={items} selectedId={scope} portal align="end"
    onSelect={id => { setOpen(false); setScope(id); }}
    anchor={<Button size="md" disabled={disabled} aria-label={t('资源范围')} aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen(!open)}>{items.find(row => row.id === scope)?.label ?? t('全局')}</Button>}/>;
}

function ResourceModal(props) {
  // The layout's Escape shortcut otherwise closes the panel underneath the native Modal.
  useEffect(() => {
    if (!props.open) return;
    const escape = event => {
      if (event.key !== 'Escape' || event.isComposing) return;
      event.preventDefault(); event.stopImmediatePropagation(); props.onClose();
    };
    window.addEventListener('keydown', escape, true);
    return () => window.removeEventListener('keydown', escape, true);
  }, [props.open, props.onClose]);
  return <Modal {...props}/>;
}

function McpEditor({ row, t, busy, save, close, request, profile }) {
  const [format, setFormat] = useState('json');
  const [help, setHelp] = useState(false);
  const [text, setText] = useState(JSON.stringify({ serverName: 'my_server', transport: 'stdio', command: 'npx', args: ['-y', 'mcp-server-package'] }, null, 2));
  const [loading, setLoading] = useState(Boolean(row));
  const [error, setError] = useState('');
  const [ready, setReady] = useState(!row);
  useEffect(() => {
    if (!row) return;
    const controller = new AbortController();
    request('mcp-config', { id: row.id, revision: row.revision, profile, format: 'json' }, { signal: controller.signal }).then(result => {
      if (!controller.signal.aborted) { setText(result.text); setReady(true); }
    }).catch(error => { if (!controller.signal.aborted) setError(error.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [row, profile, request]);
  const convert = async target => {
    setLoading(true); setError('');
    try { const result = await request('mcp-format', { text, format: target, profile }); setText(result.text); setFormat(target); }
    catch (error) { setError(error.message); }
    finally { setLoading(false); }
  };
  const submit = async event => {
    event.preventDefault(); setError('');
    try { await save({ action: row ? 'mcp-edit' : 'mcp-add', ...(row ? { id: row.id, revision: row.revision } : {}), text }); }
    catch (error) { setError(error.message); }
  };
  const blocked = busy || loading;
  return <ResourceModal open className={`hub-resource-dialog hub-resource-editor-dialog ${help ? 'with-help' : ''}`} contentClassName="hub-resource-dialog-scroll" title={t(row ? '编辑' : '添加 MCP')} closeLabel={t('关闭')} onClose={blocked ? () => {} : close}
    footer={<div className="hub-resource-actions"><Button size="md" disabled={blocked} onClick={close}>{t('取消')}</Button><Button size="md" variant="primary" type="submit" form="hub-mcp-editor" disabled={blocked || !ready}>{t('保存')}</Button></div>}>
    <div className="hub-editor-columns"><form id="hub-mcp-editor" className="hub-resource-form" onSubmit={submit}>
      <div className="hub-resource-actions" role="group" aria-label={t('配置格式')}>{['json', 'yaml'].map(value => <Button key={value} size="md" className="hub-resource-tab" aria-pressed={format === value} disabled={blocked || !ready} onClick={() => { void convert(value); }}>{value.toUpperCase()}</Button>)}<Button size="md" disabled={blocked || !ready} onClick={() => { void convert(format); }}>{t('格式化')}</Button></div>
      <div className="hub-resource-editor-note">{t('推荐在启动 DSH 的环境中设置凭据。YAML 使用')} <code>!!js process.env.MCP_TOKEN</code>{t('；JSON 使用')} <code>{'{"__jsExpr":"process.env.MCP_TOKEN"}'}</code><Button size="md" aria-expanded={help} onClick={() => setHelp(!help)}>{t('帮助')}</Button></div>
      {loading && <p role="status">{t('正在读取配置')}</p>}
      <label className="hub-resource-field">{t('MCP 配置')}<textarea className="hub-resource-code" value={ready ? text : ''} onChange={event => setText(event.target.value)} disabled={blocked || !ready} spellCheck={false} autoCapitalize="off" autoComplete="off" maxLength={24000} required/></label>
      {error && <p role="alert">{t(error)}</p>}
    </form>{help && <aside className="hub-editor-help"><h3>{t('MCP 配置帮助')}</h3><p>macOS / Linux: <code>export MCP_TOKEN=…</code><br/>Windows PowerShell: <code>$env:MCP_TOKEN=…</code></p><p>{t('下列默认值由 DSH 提供；切换格式不会补入这些字段。')}</p><dl>{mcpFields.map(([key, description, fallback]) => <div key={key}><dt><code>{key}</code></dt><dd>{t(description)}<span>{t(fallback.includes('必填') ? '要求' : '默认值')} · {fallback.includes('必填') ? t(fallback) : fallback}</span></dd></div>)}</dl></aside>}</div>
  </ResourceModal>;
}

function McpSummary({ row, t, activation }) {
  const endpoint = row.endpoint || '';
  let endpointLabel = endpoint;
  if (row.transport === 'stdio') endpointLabel = endpoint.split(/[\\/]/).filter(Boolean).pop() || endpoint;
  else { try { endpointLabel = new URL(endpoint).host; } catch { /* Keep non-URL endpoint metadata readable. */ } }
  const loaded = activation(row.activation);
  return <div className="hub-mcp-summary">
    <div className="hub-mcp-statuses">
      <Tooltip label={`${t('加载状态')} · ${loaded}`}><span tabIndex={0}><Tag tone={({ active: 'success', loading: 'info', unloading: 'info', failed: 'danger' })[row.activation] ?? 'neutral'}>{loaded === t('未知') ? t('加载未知') : loaded}</Tag></span></Tooltip>
      <Tooltip label={t('宿主未公开持续连接状态；已加载不代表连接成功。')}><span tabIndex={0}><Tag tone="neutral">{t('连接未知')}</Tag></span></Tooltip>
    </div>
    <Tooltip label={`${row.transport}${endpoint ? ' · ' + endpoint : ''}`}><span className="hub-mcp-endpoint" tabIndex={0}><Tag tone="neutral">{row.transport === 'streamable-http' ? 'HTTP' : row.transport === 'unknown' ? t('未知') : row.transport}</Tag>{endpointLabel && <code>{endpointLabel}</code>}</span></Tooltip>
  </div>;
}

function SkillPreview({ file, t, close }) {
  const view = useRef(null);
  const frontmatter = file.text.match(/^---\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)(?:\r?\n|$)/);
  const title = file.path.split(/[\\/]/).slice(-2, -1).join('') + '/skill.md';
  const body = frontmatter ? file.text.slice(frontmatter[0].length) : file.text;
  useEffect(() => {
    if (window.matchMedia('(max-width: 850px)').matches) view.current?.scrollIntoView({ block: 'start' });
  }, [file]);
  return <aside className="hub-skill-view" ref={view} aria-label={title}>
    <div className="hub-resource-card-heading"><h2 title={title}>{title}</h2><Button size="sm" onClick={close} icon={<IconCloseOutline16/>}>{t('关闭')}</Button></div>
    <div className="hub-skill-markdown">
      <MarkdownText text={body} labels={{ code: { copyLabel: t('复制'), copiedLabel: t('已复制') }, footnotes: t('脚注') }}/>
    </div>
  </aside>;
}

export function ResourceHub({ ctx, request, t, brand, panelId }) {
  useSyncExternalStore(fn => ctx.locale.subscribe(fn), () => ctx.locale.getSnapshot().active);
  const [tab, setTab] = useState('skills'); const [scope, setScope] = useState('');
  const [file, setFile] = useState(null); const [desktopHelp, setDesktopHelp] = useState(false);
  const [data, setData] = useState(null); const [query, setQuery] = useState('');
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const [editor, setEditor] = useState(null); const [deleting, setDeleting] = useState(null);
  const generation = useRef(0); const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; generation.current++; }; }, []);
  const refresh = async (signal) => {
    const token = ++generation.current;
    try { const [result, experiments] = await Promise.all([request('resources', { workspaceId: scope }, { signal }), request('experiments', {}, { signal })]); result.experiments = experiments; if (mounted.current && token === generation.current) { setData(result); setError(''); } }
    catch (error) { if (!signal?.aborted && mounted.current && token === generation.current) setError(error.message); }
  };
  useEffect(() => { const controller = new AbortController(); setData(null); void refresh(controller.signal); return () => controller.abort(); }, [scope]);
  const action = async (body, route = 'resource-mutate') => {
    setBusy(true); setError('');
    try {
      const result = await request(route, { ...body, workspaceId: scope, profile: data.profile.directory });
      if (mounted.current && result.skills) { generation.current++; setData(previous => ({ ...result, experiments: previous.experiments })); }
      return result;
    } catch (error) { if (mounted.current) setError(error.message); throw error; }
    finally { if (mounted.current) setBusy(false); }
  };
  const run = (body, route) => { void action(body, route).catch(() => {}); };
  const tabs = [{ id: 'skills', label: 'Skill' }, { id: 'mcps', label: 'MCP' }, { id: 'plugins', label: 'Plugin' }, { id: 'experiments', label: t('实验性功能') }];
  const rows = (data?.[tab] ?? []).filter(row => [row.name, tab === 'experiments' ? t(row.description) : row.description, row.source, row.directory, row.endpoint].filter(Boolean).join(' ').toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const switchTab = id => { setTab(id); setQuery(''); };
  const activation = state => t(({ active: '已加载', loading: '加载中', pending: '未加载', disabled: '已禁用', failed: '加载失败', disposed: '未加载', unloading: '加载中' })[state] ?? '未知');
  return <section className={`hub-resource-page ${file ? 'with-file' : ''}`} aria-label={brand.title}>
    <style>{marketCss}{css}</style>
    <div className="hub-market hub-resource-content" style={{ '--red': brand.primaryColor }}>
    <div className="hub-topline"><div className="hub-brand"><span className="hub-brandmark"><IconCordisPluginOutline14 size={17}/></span>{brand.title}<span className="hub-divider"/>{brand.subTitle}</div><Button size="md" onClick={() => ctx.layout.selectPanel(null)} icon={<IconCloseOutline16/>}>{t('返回会话')}</Button></div>
    <header className="hub-header"><div><span className="hub-eyebrow">SKILLS · MCP · PLUGINS</span><h1>{t('资源管理')}<span>.</span></h1><p>{t('在当前实例中管理 Skill、MCP 和插件。')}</p></div><div className="hub-header-art" aria-hidden="true"><IconCordisPluginOutline14 size={38}/><span className="hub-art-plus">+</span><span className="hub-art-dot"/></div></header>
    <div className="hub-resource-profile"><Pill>{t('当前 profile')} · {data?.profile.name ?? '…'}</Pill><span className="hub-resource-path" title={data?.profile.directory}>{data?.profile.directory ?? '…'}</span></div>
    <div role="tablist" className="hub-tabs" aria-label={brand.title} onKeyDown={event => {
      const index = tabs.findIndex(row => row.id === tab); const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : -1;
      if (next !== -1) { event.preventDefault(); switchTab(tabs[next].id); event.currentTarget.querySelectorAll('[role="tab"]')[next].focus(); }
    }}>{tabs.map(row => <Button key={row.id} role="tab" id={`${panelId}-${row.id}`} aria-controls={`${panelId}-content`} aria-selected={tab === row.id} tabIndex={tab === row.id ? 0 : -1} size="md" className="hub-resource-tab" onClick={() => switchTab(row.id)}>{row.label}<span className="hub-tab-count">{data?.[row.id]?.length ?? '—'}</span></Button>)}</div>
    <div role="tabpanel" id={`${panelId}-content`} aria-labelledby={`${panelId}-${tab}`}>
        <div className="hub-toolbar"><Input className="hub-search-input" icon={<IconSearchOutline16/>} aria-label={t('搜索名称、描述或来源')} placeholder={t('搜索名称、描述或来源')} value={query} onChange={event => setQuery(event.target.value)}/>
          {tab === 'skills' && <ScopePicker data={data} scope={scope} setScope={setScope} t={t} disabled={busy}/>}
          <Button size="md" disabled={busy} onClick={() => { setBusy(true); void refresh().finally(() => { if (mounted.current) setBusy(false); }); }} icon={<IconRefreshOutline16/>}>{t('刷新')}</Button>
          {tab === 'plugins' && data?.profile.installation === 'desktop' && <Button onClick={() => setDesktopHelp(true)}>{t('桌面插件管理')}</Button>}
          {tab === 'mcps' && <Button size="md" variant="primary" disabled={!data || busy} onClick={() => setEditor({})}>{t('添加 MCP')}</Button>}
        </div>
        <div className="hub-results"><span>{t('当前列表')} <b>{rows.length}</b></span><span className="hub-resource-scope-note">{t(tab === 'skills' ? '开关只影响当前 profile；Skill 源文件保持原样。' : tab === 'mcps' ? 'MCP 为当前 profile 的全局服务；工作区范围只筛选 Skill。' : tab === 'plugins' ? '仅展示已安装的非官方插件' : '实验性功能')}</span></div>
        {error && <p role="alert">{t(error)}</p>}
        {!data && !error && <p role="status">{t('正在读取资源')}</p>}
        {data && tab === 'skills' && !data.skillsComplete && <p role="status">{t('资源尚未完整加载，请刷新重试')}</p>}
        <div className="hub-grid hub-resource-grid">{rows.map(row => <article key={row.id ?? row.name} className="hub-card hub-resource-card">
          <div className="hub-resource-card-heading"><div className="hub-resource-identity"><ItemIcon row={row}/><h2 className="hub-resource-card-name" title={row.name}>{row.name}{(tab === 'mcps' || tab === 'plugins') && <span className="hub-resource-version">@{row.version || t('未知')}</span>}</h2></div>{tab !== 'plugins' && tab !== 'experiments' ? <Switch checked={Boolean(row.enabled)} label={`${t(row.enabled ? '禁用' : '启用')} ${row.name}`} disabled={busy || (tab === 'skills' && (!row.canToggle || (!row.enabled && !row.managed)))} title={tab === 'skills' && !row.canToggle ? t('此开关继承自其它范围，请切换范围修改') : undefined} onChange={enabled => run({ action: tab === 'skills' ? 'skill-toggle' : 'mcp-toggle', id: row.id, revision: row.revision, enabled })}/> : tab === 'experiments' ? <Switch checked={Boolean(row.enabled)} label={`${t(row.enabled ? '禁用' : '启用')} ${row.name}`} disabled={busy || !row.canToggle} onChange={enabled => { setBusy(true); void request('experiment-mutate', { id: row.id, enabled, profile: data.profile.directory }).then(() => refresh()).catch(error => setError(error.message)).finally(() => setBusy(false)); }}/> : null}</div>
          {tab === 'mcps' && <McpSummary row={row} t={t} activation={activation}/>}
          <p className="hub-description" title={tab === 'experiments' ? t(row.description) : row.description}>{(tab === 'experiments' ? t(row.description) : row.description) || t(tab === 'mcps' ? '服务尚未提供描述，可测试连接读取。' : '暂无描述')}</p>
          {tab === 'mcps' && <>
            {row.probe && <p className="hub-resource-meta"><Pill><StateDot state={row.probe.status === 'success' ? 'done' : 'error'}/> {t(row.probe.status === 'success' ? '测试成功' : '测试失败')} · {new Date(row.probe.at).toLocaleTimeString()}{row.probe.tools !== undefined && ` · ${t('工具数')} ${row.probe.tools}`}</Pill></p>}</>}
          {tab === 'experiments' && <div className="hub-resource-actions"><Pill><StateDot state={row.pendingRestart ? 'warning' : row.enabled ? 'done' : 'idle'}/>{t(row.pendingRestart ? '重启 DSH 后生效' : row.enabled === null ? '未知' : row.enabled ? '已启用' : '已禁用')}</Pill>{!row.installed && <Button size="sm" disabled={busy || !row.canInstall} onClick={() => { setBusy(true); void request('experiment-mutate', { id: row.id, action: 'install', profile: data.profile.directory }).then(() => refresh()).catch(error => setError(error.message)).finally(() => setBusy(false)); }}>{t('安装 Agent Teams')}</Button>}{data.profile.installation === 'desktop' && <Button size="sm" onClick={() => setDesktopHelp(true)}>{t('桌面插件管理')}</Button>}</div>}
          {tab !== 'experiments' && <div className="hub-resource-card-footer">
          <div className="hub-resource-actions">
            {tab === 'plugins' && <><Button size="sm" disabled={busy} icon={<IconFolderOpenOutline16/>} onClick={() => run({ id: row.name, kind: 'plugin' }, 'open-directory')}>{t('打开目录')}</Button></>}
            {tab === 'skills' && <><Button size="sm" disabled={!row.directory || busy} onClick={() => { setBusy(true); void action({ id: row.id }, 'skill-file').then(setFile).catch(() => {}); }}>{t('查看 SKILL.md')}</Button><Button size="sm" disabled={!row.directory || busy} onClick={() => run({ id: row.id }, 'open-directory')} icon={<IconFolderOpenOutline16/>}>{t('打开目录')}</Button></>}
            {tab === 'mcps' && <><Tooltip label={t('独立测试会临时连接服务并读取工具列表，不执行工具。')}><Button size="sm" disabled={busy || !row.enabled} onClick={() => run({ id: row.id, revision: row.revision }, 'mcp-test')}>{t('测试连接')}</Button></Tooltip><Button size="sm" disabled={busy || !row.enabled} onClick={() => run({ action: 'mcp-reconnect', id: row.id, revision: row.revision })}>{t('重新连接')}</Button><Button size="sm" disabled={busy} onClick={() => setEditor(row)}>{t('编辑')}</Button><Tooltip label={row.canDelete ? t('删除') : t('来自共享配置或宿主包，请在来源处删除')}><Button size="sm" disabled={busy || !row.canDelete} onClick={() => setDeleting(row)}>{t('删除')}</Button></Tooltip></>}
          </div><p className="hub-resource-path hub-resource-source" title={row.directory ?? row.source}>{t('来源')} · {row.directory ?? row.source}</p></div>}
        </article>)}</div>
        {data && !rows.length && <p className="hub-resource-empty">{t('未找到匹配资源')}</p>}
    </div>
    </div>
    {file && <SkillPreview key={file.path} file={file} t={t} close={() => setFile(null)}/>}
    <ResourceModal className="hub-resource-dialog" open={desktopHelp} title={t('桌面插件管理')} closeLabel={t('关闭')} onClose={() => setDesktopHelp(false)}><p>{t('当前 DSH 主窗口未提供打开管理窗口的接口。请使用系统菜单的 Desktop Plugins，或按')} <kbd>{data?.profile.platform === 'darwin' ? '⌘ ,' : 'Ctrl+,'}</kbd></p></ResourceModal>
    {editor && <McpEditor request={request} profile={data.profile.directory} row={editor.id ? editor : null} t={t} busy={busy} close={() => setEditor(null)} save={async body => { await action(body); setEditor(null); }}/>}
    <ResourceModal className="hub-resource-dialog" contentClassName="hub-resource-dialog-scroll" open={Boolean(deleting)} title={t('确认删除')} closeLabel={t('关闭')} onClose={() => setDeleting(null)} footer={<div className="hub-resource-actions"><Button disabled={busy} onClick={() => setDeleting(null)}>{t('取消')}</Button><Button variant="primary" disabled={busy} onClick={() => { void action({ action: 'mcp-delete', id: deleting.id, revision: deleting.revision }).then(() => setDeleting(null)).catch(() => {}); }}>{t('删除')}</Button></div>}><p>{deleting?.name}</p><p>{t('删除会断开该 MCP，并移除对应的配置条目。')}</p></ResourceModal>
  </section>;
}

export function HubSidebarButton({ wide, usePanelInfo, ctx, panelId, brand }) {
  const selected = usePanelInfo(state => state.activePanelId === panelId);
  return <><style>{css}</style><Tooltip label={brand.navTitle} disabled={wide}><Button className={`hub-sidebar-button ${wide ? 'is-wide' : 'is-rail'}`} aria-label={brand.navTitle} aria-pressed={selected} icon={<IconCordisPluginOutline14 size={18}/>} onClick={() => ctx.layout.selectPanel(selected ? null : panelId)}>{wide && <span>{brand.navTitle}</span>}</Button></Tooltip></>;
}
