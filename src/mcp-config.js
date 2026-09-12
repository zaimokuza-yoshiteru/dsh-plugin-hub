import { parseDocument, stringify } from 'yaml';
const object = value => value && typeof value === 'object' && !Array.isArray(value);
// This is the same serialized expression shape used by Cordis. Only environment
// references are accepted here; Hub never evaluates arbitrary JavaScript.
function envExpression(expr) {
  const direct = /^process\.env\.([A-Za-z_][A-Za-z0-9_]*)$/.exec(expr);
  if (direct) return { name: direct[1], prefix: '', suffix: '' };
  const template = /^`([^`$]*)\$\{process\.env\.([A-Za-z_][A-Za-z0-9_]*)\}([^`$]*)`$/.exec(expr);
  if (template) return { name: template[2], prefix: template[1], suffix: template[3] };
  throw new Error('仅支持 process.env.NAME 或带此前缀的模板字符串，不执行任意 JavaScript');
}
export const jsTag = {
  tag: 'tag:yaml.org,2002:js',
  identify: value => object(value) && Object.keys(value).length === 1 && typeof value.__jsExpr === 'string',
  resolve: value => ({ __jsExpr: value }),
  stringify: item => JSON.stringify(item.value.__jsExpr),
};
export function parseConfigText(text) {
  if (typeof text !== 'string' || text.length > 24000) throw new Error('配置文本最长 24000 字符');
  const doc = parseDocument(text, { uniqueKeys: true, schema: 'core', customTags: [jsTag] });
  if (doc.errors.length || doc.warnings.length) throw new Error('JSON / YAML 格式无效，请检查缩进、引号和重复字段');
  let value;
  try { value = doc.toJS({ maxAliasCount: 0 }); } catch { throw new Error('配置不支持 YAML 别名'); }
  if (!object(value)) throw new Error('请提供一个 MCP 配置对象');
  // Validate reference syntax without resolving values or adding defaults.
  resolveEnvironment(value, {}, true);
  return value;
}
export function parseMcpDocument(text) {
  let value = parseConfigText(text);
  if (Object.hasOwn(value, 'mcpServers')) {
    if (!object(value.mcpServers) || Object.keys(value).length !== 1 || Object.keys(value.mcpServers).length !== 1) throw new Error('每次请粘贴一个 mcpServers 服务配置');
    const [name, config] = Object.entries(value.mcpServers)[0];
    if (!object(config)) throw new Error('MCP 配置必须是对象');
    value = { serverName: name, ...config };
  } else if (value.name === '@deepseek-ai/dsh-mcp-client' && object(value.config)) {
    if (Object.keys(value).some(key => !['name', 'config', 'id'].includes(key))) throw new Error('请仅编辑 MCP 的 config 段，启停使用卡片开关');
    value = value.config;
  }
  const config = { ...value };
  if (config.type !== undefined) {
    const transport = config.type === 'http' ? 'streamable-http' : config.type;
    if (config.transport && config.transport !== transport) throw new Error('type 与 transport 不一致');
    config.transport = transport; delete config.type;
  }
  config.transport ??= config.command ? 'stdio' : config.url ? 'streamable-http' : undefined;
  return config;
}
export function resolveEnvironment(value, env = process.env, syntaxOnly = false) {
  if (Array.isArray(value)) return value.map(item => resolveEnvironment(item, env, syntaxOnly));
  if (!object(value)) return value;
  if (Object.hasOwn(value, '__jsExpr')) {
    if (Object.keys(value).length !== 1 || typeof value.__jsExpr !== 'string') throw new Error('环境变量引用无效');
    const ref = envExpression(value.__jsExpr);
    if (syntaxOnly) return 'environment-reference';
    if (typeof env[ref.name] !== 'string') throw new Error(`启动 DSH 的环境中未设置 ${ref.name}`);
    return ref.prefix + env[ref.name] + ref.suffix;
  }
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolveEnvironment(item, env, syntaxOnly)]));
}
export function formatMcpDocument(config, format) {
  if (format === 'json') return JSON.stringify(config, null, 2);
  if (format === 'yaml') return stringify(config, { lineWidth: 0, customTags: [jsTag] });
  throw new Error('格式必须为 JSON 或 YAML');
}
