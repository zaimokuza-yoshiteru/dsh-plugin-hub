import { isAbsolute } from 'node:path';

export const MCP_MODULE = '@deepseek-ai/dsh-mcp-client';
const object = value => value && typeof value === 'object' && !Array.isArray(value);

function variants(schema) {
  const nodes = schema?.type === 'union' ? schema.list : [schema];
  if (!nodes?.length || nodes.some(node => node?.type !== 'object' || !node.dict?.transport)) {
    throw new Error('当前 DSH 未提供可用的 MCP 配置规则');
  }
  return nodes;
}

// Schemastery preserves unknown keys. Reject typos using the host's field tree,
// without maintaining a second list of supported MCP options in Hub.
function knownFields(value, schema) {
  if (!object(value) || schema.type !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (!Object.hasOwn(schema.dict, key)) throw new Error('配置包含宿主不支持的字段，请核对 MCP 配置');
    knownFields(child, schema.dict[key]);
  }
}

/** The host owns types/defaults; Hub owns its editor's filesystem/URL boundary. */
export function validateNativeMcp(Config, input) {
  const branch = variants(Config).find(node => node.dict.transport.value === input?.transport);
  if (!branch) throw new Error('不支持的 MCP 协议');
  knownFields(input, branch);
  let config;
  try { config = Config(structuredClone(input)); }
  catch { throw new Error('MCP 配置不符合当前 DSH 的规则，请核对字段类型和取值'); }
  if (config.transport === 'stdio') {
    if (!config.command?.trim() || config.command.includes('\0')) throw new Error('需要有效的可执行命令');
    if (config.cwd && !isAbsolute(config.cwd)) throw new Error('cwd 必须是绝对路径');
  } else if (config.transport === 'streamable-http') {
    let url; try { url = new URL(config.url); } catch { throw new Error('需要有效的 MCP URL'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('MCP URL 必须使用 HTTP(S)，凭据请放入 headers');
  }
  if (config.reconnect?.initialDelayMs > config.reconnect?.maxDelayMs) throw new Error('重连初始间隔不能超过最大间隔');
  return config;
}

/** Only schema metadata crosses RPC; never resolved configuration or env values. */
export function mcpSchemaFields(Config) {
  const fields = new Map();
  function visit(schema, transport, prefix = '') {
    for (const [name, node] of Object.entries(schema.dict)) {
      const key = prefix + name;
      if (node.type === 'object') { visit(node, transport, key + '.'); continue; }
      const meta = node.meta ?? {};
      const field = { key, type: node.type, required: Boolean(meta.required) || node.type === 'const',
        ...(Object.hasOwn(meta, 'default') ? { default: meta.default } : {}), transports: [transport] };
      const previous = fields.get(key);
      // Keep distinct rows if transports ever acquire different defaults/types.
      const id = previous && JSON.stringify({ ...previous, transports: [] }) !== JSON.stringify({ ...field, transports: [] }) ? `${key}:${transport}` : key;
      if (fields.has(id)) fields.get(id).transports.push(transport);
      else fields.set(id, field);
    }
  }
  for (const branch of variants(Config)) visit(branch, branch.dict.transport.value);
  return [...fields.values()];
}

export class NativeMcp {
  constructor(loader) { this.loader = loader; }
  async module() {
    this.pending ??= this.loader.import(MCP_MODULE).then(module => {
      if (typeof module.Config !== 'function') throw new Error('当前 DSH 未提供可用的 MCP 配置规则');
      variants(module.Config);
      return module;
    }).catch(error => { this.pending = undefined; throw error; });
    return this.pending;
  }
  async validate(input) { return validateNativeMcp((await this.module()).Config, input); }
  async fields() { return mcpSchemaFields((await this.module()).Config); }
}
