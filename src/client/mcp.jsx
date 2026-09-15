import React, { useEffect, useState } from 'react';
import { Button, Tag, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives';
import { ResourceModal } from './resource-modal.jsx';
import { mcpDescriptions } from './mcp-help.js';

export function McpEditor({ row, t, busy, save, close, request, profile }) {
  const [format, setFormat] = useState('json');
  const [help, setHelp] = useState(false);
  const [fields, setFields] = useState([]);
  const [text, setText] = useState(JSON.stringify({ serverName: 'my_server', transport: 'stdio', command: 'npx', args: ['-y', 'mcp-server-package'] }, null, 2));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    Promise.all([
      request('mcp-schema', { profile }, { signal: controller.signal }),
      row ? request('mcp-config', { id: row.id, revision: row.revision, profile, format: 'json' }, { signal: controller.signal }) : Promise.resolve(null),
    ]).then(([schema, config]) => {
      if (!controller.signal.aborted) { setFields(schema.fields); if (config) setText(config.text); setReady(true); }
    }).catch(error => { if (!controller.signal.aborted) { setReady(false); setError(error.message); } }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
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
    </form>{help && <aside className="hub-editor-help"><h3>{t('MCP 配置帮助')}</h3><p>macOS / Linux: <code>export MCP_TOKEN=…</code><br/>Windows PowerShell: <code>$env:MCP_TOKEN=…</code></p><p>{t('下列默认值由 DSH 提供；切换格式不会补入这些字段。')}</p><dl>{fields.map(field => <div key={field.key + field.transports.join()}><dt><code>{field.key}</code>{field.transports.length === 1 && <Tag tone="neutral">{field.transports[0]}</Tag>}</dt><dd>{t(mcpDescriptions[field.key] ?? '由当前 DSH 提供的配置项。')}<span>{t(field.required ? '要求' : '默认值')} · {field.required ? t('必填') : Object.hasOwn(field, 'default') ? JSON.stringify(field.default) : t('未提供默认值')}</span></dd></div>)}</dl></aside>}</div>
  </ResourceModal>;
}

export function McpSummary({ row, t, activation }) {
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

