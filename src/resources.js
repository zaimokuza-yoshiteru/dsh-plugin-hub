import { readFile, mkdir, realpath } from 'node:fs/promises';
import { join, relative, isAbsolute } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

import { parseMcpDocument, formatMcpDocument, parseConfigText, resolveEnvironment } from './mcp-config.js';

import { findMcpDefinition, deleteMcpDefinition, atomicWrite } from './profile-files.js';

const MCP = '@deepseek-ai/dsh-mcp-client';
const fingerprint = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const inside = (root, path) => { const rel = relative(root, path); return !rel.startsWith('..') && !isAbsolute(rel); };
const record = value => value && typeof value === 'object' && !Array.isArray(value);
const safeIcon = value => { try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password && !url.search ? url.href : null; } catch { return null; } };
const safeUrl = value => { try { const u = new URL(value); return `${u.protocol}//${u.host}${u.pathname}`; } catch { return ''; } };

/** Card metadata excludes credentials, executable arguments and URL queries. */
export function describeMcp(config = {}) {
  return { name: typeof config.serverName === 'string' ? config.serverName : 'MCP', transport: typeof config.transport === 'string' ? config.transport : 'unknown',
    endpoint: config.transport === 'stdio' ? (typeof config.command === 'string' ? config.command : '') : safeUrl(config.url),
  };
}

export function validateMcp(input) {
  if (!record(input) || !/^[A-Za-z0-9_-]{1,32}$/.test(input.serverName)) throw new Error('MCP 名称只允许 1–32 位字母、数字、下划线和连字符');
  const common = ['serverName', 'transport', 'toolCallTimeoutMs', 'failOnStartupError', 'reconnect'];
  const allowed = [...common, ...(input.transport === 'stdio' ? ['command', 'args', 'env', 'cwd'] : ['url', 'headers'])];
  if (Object.keys(input).some(key => !allowed.includes(key))) throw new Error('配置包含宿主不支持的字段，请核对 MCP 配置');
  const config = { serverName: input.serverName, transport: input.transport };
  if (input.transport === 'stdio') {
    if (typeof input.command !== 'string' || !input.command.trim() || input.command.includes('\0')) throw new Error('需要有效的可执行命令');
    config.command = input.command;
    config.args = input.args ?? [];
    if (!Array.isArray(config.args) || config.args.some(x => typeof x !== 'string')) throw new Error('args 必须是字符串数组');
    config.env = input.env ?? {};
    config.cwd = input.cwd ?? '';
    if (typeof config.cwd !== 'string' || (config.cwd && !isAbsolute(config.cwd))) throw new Error('cwd 必须是绝对路径');
  } else if (input.transport === 'streamable-http') {
    let url; try { url = new URL(input.url); } catch { throw new Error('需要有效的 MCP URL'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('MCP URL 必须使用 HTTP(S)，凭据请放入 headers');
    config.url = url.href; config.headers = input.headers ?? {};
  } else throw new Error('不支持的 MCP 协议');
  for (const map of [config.env, config.headers].filter(Boolean)) {
    if (!record(map) || Object.values(map).some(x => typeof x !== 'string')) throw new Error('env / headers 必须是字符串键值对象');
  }
  config.toolCallTimeoutMs = input.toolCallTimeoutMs ?? 60000;
  if (!Number.isInteger(config.toolCallTimeoutMs) || config.toolCallTimeoutMs < 1000 || config.toolCallTimeoutMs > 300000) throw new Error('超时时间必须在 1000–300000 毫秒之间');
  config.failOnStartupError = input.failOnStartupError ?? false;
  if (typeof config.failOnStartupError !== 'boolean') throw new Error('failOnStartupError 必须是布尔值');
  if (input.reconnect !== undefined) {
    if (!record(input.reconnect) || Object.keys(input.reconnect).some(key => !['enabled', 'initialDelayMs', 'maxDelayMs', 'maxAttempts'].includes(key))) throw new Error('reconnect 配置无效');
    config.reconnect = { ...input.reconnect };
    for (const [key, value] of Object.entries(config.reconnect)) {
      if (key === 'enabled' ? typeof value !== 'boolean' : !Number.isSafeInteger(value) || value < 1 || (key !== 'maxAttempts' && value > 2147483647)) throw new Error('reconnect 配置无效');
    }
    if (config.reconnect.initialDelayMs && config.reconnect.maxDelayMs && config.reconnect.initialDelayMs > config.reconnect.maxDelayMs) throw new Error('重连初始间隔不能超过最大间隔');
  }
  return config;
}

/** Native resource adapter. Its durable state belongs exclusively to the boot profile. */
export class NativeResources {
  constructor(ctx, environment, directory, inventory) {
    Object.assign(this, { ctx, environment, directory, inventory });
    this.file = join(directory, 'resources.json');
    this.state = { version: 1, skills: [], mcps: [], overrides: {} };
    this.tail = Promise.resolve(); this.fibers = new Map(); this.applied = new WeakMap(); this.probes = new Map(); this.loadErrors = new Map();
    this.providerName = `plugin-hub-${fingerprint(directory).slice(0, 12)}`;
    this.invalidators = new Set(); this.invalidate = () => { for (const invalidate of this.invalidators) invalidate(); }; this.closed = false; this.scopes = new Map(); this.entryIds = new WeakMap(); this.lifecycle = new AbortController();
  }
  async init() {
    try { this.state = JSON.parse(await readFile(this.file, 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw new Error('Hub 资源配置不可读取，已停止管理，原文件未改动', { cause: error }); }
    if (this.state.version !== 1 || !Array.isArray(this.state.skills) || !Array.isArray(this.state.mcps) || !record(this.state.overrides)) throw new Error('Hub 资源配置格式无效');
    this.registerPolicy(this.ctx);
    if (this.ctx.agentPresets) {
      this.scopeApi = await this.ctx.loader.import('@deepseek-ai/dsh-scope');
      this.presetApi = await this.ctx.loader.import('@deepseek-ai/dsh-agent-presets');
      this.ctx.on('agent/created', ({ agent }) => {
        if (this.ctx.agentPresets.composedPreset(agent.ctx) !== undefined) this.registerScope(this.scopeApi.scopeOf(agent.ctx));
      });
      this.ctx.on('agent/disposed', ({ agent }) => {
        const key = this.scopeApi.scopeOf(agent.ctx); const scope = this.scopes.get(key);
        if (scope) { this.scopes.delete(key); void scope.dispose(); }
      });
      this.attachMountedPolicies();
    }
    // Start after this plugin's activation; awaiting loader readiness here would deadlock boot.
    this.timer = setInterval(() => { void this.serial(() => this.reconcile()).catch(() => {}); }, 2000);
    this.timer.unref?.();
  }
  registerPolicy(ctx) {
    if (!ctx.skills?.registerProvider) return;
    ctx.skills.registerProvider(control => {
      this.invalidators.add(control.invalidate);
      control.signal.addEventListener('abort', () => this.invalidators.delete(control.invalidate), { once: true });
      return { name: this.providerName,
        list: ({ cwd } = {}) => this.state.skills.filter(row => !row.cwd || (cwd && inside(row.cwd, cwd))).map(row => ({
          ...row.summary, provider: this.providerName, source: 'custom', rank: -1e9, locator: row.name,
          invocation: { modelInvocable: false, userInvocable: false },
        })),
        get: async candidate => ({ ...candidate, content: '', invocation: { modelInvocable: false, userInvocable: false } }),
      };
    });
  }
  registerScope(key) {
    if (!key || this.scopes.has(key)) return;
    const scope = this.scopeApi.createScope(this.ctx, key);
    this.scopes.set(key, scope); this.registerPolicy(scope.ctx);
  }
  mounts() { return this.presetApi?.livePresetMounts?.(this.ctx.root.fiber) ?? []; }
  attachMountedPolicies() { for (const mount of this.mounts()) this.registerScope(mount.key); }
  async view(presetId) {
    if (!this.ctx.agentPresets) return { presets: [] };
    const inventory = await this.ctx.agentPresets.compositionInventory();
    const presets = inventory.filter(preset => !preset.broken && preset.rows.some(row => row.moduleName === '@deepseek-ai/dsh-skill-filesystem' || row.moduleName === MCP || row.moduleName.startsWith('@deepseek-ai/dsh-tool-'))).map(row => ({ id: row.id, name: row.name ?? row.id }));
    const id = presetId || (inventory.find(row => row.id === this.ctx.agentPresets.defaultId && !row.broken && row.rows.some(item => item.moduleName === '@deepseek-ai/dsh-skill-filesystem'))?.id ?? inventory.find(row => !row.broken && row.rows.some(item => item.moduleName === '@deepseek-ai/dsh-skill-filesystem'))?.id ?? presets[0]?.id);
    if (!id) return { presets };
    if (!presets.some(row => row.id === id)) throw new Error('此预设没有原生 Skill 或 MCP 资源');
    const scope = await this.ctx.agentPresets.standingKeyFor(id);
    this.registerScope(scope); return { scope, presetId: id, presets };
  }

  serial(run) { const task = this.tail.then(() => { if (this.closed) throw new Error('Hub 正在关闭'); return run(); }); this.tail = task.catch(() => {}); return task; }
  async save(next) {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    if (!inside(this.environment.profileDir, await realpath(this.directory))) throw new Error('Hub 配置目录不在当前 profile 内');
    await atomicWrite(this.file, JSON.stringify(next, null, 2) + '\n');
    this.state = next; this.invalidate();
  }
  workspaces() { return this.ctx.workspaceRegistry?.list?.().map(({ id, title, path }) => ({ id, title, path })) ?? []; }
  workspace(id) {
    if (!id) return undefined;
    const item = this.workspaces().find(w => w.id === id);
    if (!item) throw new Error('当前实例没有这个工作区，请刷新');
    return item;
  }
  entries() {
    const root = [...(this.ctx.loader?.entries?.() ?? [])];
    for (const entry of root) this.entryIds.set(entry, entry.id);
    const scoped = this.mounts().flatMap(mount => [...mount.tree.entries()].map(entry => { this.entryIds.set(entry, `preset:${mount.presetId}:${entry.id}`); return entry; }));
    return [...root, ...scoped].filter(entry => entry.options.name === MCP);
  }
  entryId(entry) { return this.entryIds.get(entry) ?? entry.id; }
  async reconcile() {
    this.attachMountedPolicies();
    for (const row of this.state.mcps) {
      if (row.enabled && !this.fibers.has(row.id)) {
        try {
          const module = await this.ctx.loader.import(MCP);
          this.fibers.set(row.id, this.ctx.plugin(module, validateMcp(resolveEnvironment(row.config))));
          this.loadErrors.delete(row.id);
        } catch (error) { this.loadErrors.set(row.id, error.message); }
      }
    }
    for (const entry of this.entries()) {
      const override = this.state.overrides[this.entryId(entry)];
      if (!override || entry._initTask || this.applied.get(entry) === fingerprint({ override, options: entry.options })) continue;
      // Entry.update changes the live node only. Tree.update would rewrite a shipped bundle.
      await entry.update({ disabled: !override.enabled, ...(override.config ? { config: override.replaceConfig ? override.config : { ...entry.options.config, ...override.config } } : {}) }, false, true);
      this.applied.set(entry, fingerprint({ override, options: entry.options }));
    }
  }
  async snapshot(workspaceId, presetId) {
    const workspace = this.workspace(workspaceId);
    const view = await this.view(presetId);
    const options = { scope: view.scope, ...(workspace ? { cwd: workspace.path } : {}) };
    const catalog = this.ctx.skills?.snapshot ? await this.ctx.skills.snapshot(options) : { skills: [], complete: false };
    const skills = catalog.skills.map(summary => {
      const disabled = this.state.skills.find(row => row.name === summary.name && (!row.cwd || (workspace && inside(row.cwd, workspace.path))));
      const original = summary.provider === this.providerName && disabled ? disabled.summary : summary;
      return { id: summary.name, name: summary.name, description: original.description, source: original.source,
        provider: original.provider, directory: original.resourceBase?.kind === 'directory' ? original.resourceBase.path : null,
        enabled: summary.invocation.modelInvocable || summary.invocation.userInvocable,
        managed: Boolean(disabled), inherited: Boolean(disabled && disabled.cwd !== workspace?.path && disabled.cwd !== undefined),
        canToggle: Boolean(this.ctx.skills?.registerProvider) && (!disabled || (disabled.cwd ?? null) === (workspace?.path ?? null)),
      };
    });
    const mcps = [
      ...this.entries().map(entry => ({ id: this.entryId(entry), ...describeMcp(entry.options.config),
        description: '', source: entry.parent.tree.filename ?? 'DSH', enabled: !entry.disabled,
        activation: ['pending', 'loading', 'active', 'failed', 'disposed', 'unloading'][entry.fiber?.state] ?? (entry.disabled ? 'disabled' : 'unknown'),
        connection: 'unknown', managed: false, revision: fingerprint({ id: this.entryId(entry), config: entry.options.config, disabled: entry.disabled, override: this.state.overrides[this.entryId(entry)] }),
      })),
      ...this.state.mcps.map(row => ({ id: row.id, ...describeMcp(row.config), description: '', source: this.file,
        enabled: row.enabled, activation: ['pending', 'loading', 'active', 'failed', 'disposed', 'unloading'][this.fibers.get(row.id)?.state] ?? (row.enabled ? 'pending' : 'disabled'),
        connection: 'unknown', managed: true, revision: fingerprint(row),
      })),
    ].map(row => ({ ...row, description: this.probes.get(row.id)?.description ?? '', probe: this.probes.get(row.id) ?? null }));
    for (const row of mcps) {
      row.canDelete = row.managed || Boolean(await findMcpDefinition(this.environment.profileDir, this.entries().find(entry => this.entryId(entry) === row.id)));
      if (this.loadErrors.has(row.id)) row.activation = 'failed';
      row.version = row.probe?.version ?? null; row.icon = safeIcon(row.probe?.icon);
    }
    const installed = await this.inventory.installed();
    const plugins = await Promise.all(Object.entries(installed).map(async ([name, version]) => {
      let manifest = {}; try { manifest = JSON.parse(await readFile(join(this.environment.profileDir, 'node_modules', name, 'package.json'), 'utf8')); } catch {}
      return { name, version, icon: safeIcon(manifest.icon ?? manifest.dsh?.icon), description: typeof manifest.description === 'string' ? manifest.description : '', source: typeof manifest.repository === 'string' ? manifest.repository : manifest.repository?.url ?? '',
        native: Boolean(manifest.dsh?.bundle || manifest.dsh?.client), directory: join(this.environment.profileDir, 'node_modules', name),
      };
    }));
    return { profile: { name: this.environment.profile, directory: this.environment.profileDir, installation: this.environment.installation, platform: this.environment.host?.platform ?? process.platform },
      presets: view.presets, presetId: view.presetId ?? null, workspaces: this.workspaces(), workspaceId: workspace?.id ?? null, skills, skillsComplete: catalog.complete,
      mcps, plugins: plugins.filter(row => row.native && !row.name.startsWith('@deepseek-ai/')), updatedAt: new Date().toISOString() };
  }
  configuration(data) {
    return this.serial(async () => {
      if (data.profile !== this.environment.profileDir) throw new Error('实例 profile 已变化，请刷新');
      this.checkRevision(await this.snapshot(data.workspaceId), data);
      const row = this.state.mcps.find(row => row.id === data.id);
      const entry = this.entries().find(entry => this.entryId(entry) === data.id);
      const override = this.state.overrides[data.id];
      const config = row?.config ?? (override?.replaceConfig ? override.config : { ...entry?.options.config, ...override?.config });
      if (!config?.serverName) throw new Error('当前 MCP 没有可编辑的配置');
      return { text: formatMcpDocument(config, data.format ?? 'json') };
    });
  }
  formatConfiguration(data) {
    if (data.profile !== this.environment.profileDir) throw new Error('实例 profile 已变化，请刷新');
    return { text: formatMcpDocument(parseConfigText(data.text), data.format) };
  }
  async mutate(data) {
    return this.serial(async () => {
      const snapshot = await this.snapshot(data.workspaceId, data.presetId);
      if (data.profile !== this.environment.profileDir) throw new Error('实例 profile 已变化，请刷新后重试');
      const next = structuredClone(this.state);
      if (data.action === 'skill-toggle') {
        if (typeof data.enabled !== 'boolean') throw new Error('无效的开关值');
        const skill = snapshot.skills.find(row => row.id === data.id);
        if (!skill?.canToggle) throw new Error('此 Skill 的开关属于其它作用域，请切换范围');
        const cwd = this.workspace(data.workspaceId)?.path;
        next.skills = next.skills.filter(row => row.name !== data.id || row.cwd !== cwd);
        if (!data.enabled) {
          const { skills } = await this.ctx.skills.snapshot({ ...await this.view(data.presetId), ...(cwd ? { cwd } : {}) });
          const summary = skills.find(row => row.name === data.id);
          next.skills.push({ name: data.id, ...(cwd ? { cwd } : {}), summary });
        }
        await this.save(next);
      } else if (data.action === 'mcp-add' || data.action === 'mcp-edit') {
        const previous = next.mcps.find(row => row.id === data.id);
        const entry = this.entries().find(entry => this.entryId(entry) === data.id);
        const raw = data.text !== undefined ? parseMcpDocument(data.text) : { ...(previous?.config ?? entry?.options.config ?? {}), ...data.config };
        validateMcp(resolveEnvironment(raw));
        const config = raw;
        if (snapshot.mcps.some(row => row.name === config.serverName && row.id !== data.id)) throw new Error('当前 profile 已有同名 MCP');
        if (data.action === 'mcp-add') next.mcps.push({ id: `hub-${randomUUID()}`, config, enabled: true });
        else {
          const row = next.mcps.find(row => row.id === data.id);
          this.checkRevision(snapshot, data);
          if (row) { row.config = config; delete row.description; }
          else {
            if (!entry) throw new Error('MCP 已不存在');
            next.overrides[data.id] = { ...next.overrides[data.id], enabled: !entry.disabled, config, replaceConfig: true };
          }
        }
        await this.save(next);
        if (data.id) await this.stopMcp(data.id);
        await this.reconcile();
      } else if (['mcp-toggle', 'mcp-delete', 'mcp-reconnect'].includes(data.action)) {
        this.checkRevision(snapshot, data);
        const row = next.mcps.find(row => row.id === data.id);
        if (row) {
          if (data.action === 'mcp-delete') next.mcps = next.mcps.filter(row => row.id !== data.id);
          if (data.action === 'mcp-toggle') { if (typeof data.enabled !== 'boolean') throw new Error('无效的开关值'); row.enabled = data.enabled; }
        } else {
          const entry = this.entries().find(entry => this.entryId(entry) === data.id);
          if (!entry) throw new Error('MCP 已不存在');
          if (data.action === 'mcp-delete') {
            await deleteMcpDefinition(this.environment.profileDir, entry);
            delete next.overrides[data.id];
          } else if (data.action === 'mcp-reconnect') {
            if (entry.disabled) throw new Error('请先启用 MCP');
            await entry.update({ disabled: true }, false, true);
            await entry.update({ disabled: false }, false, true);
          } else {
            if (typeof data.enabled !== 'boolean') throw new Error('无效的开关值');
            next.overrides[data.id] = { ...next.overrides[data.id], enabled: data.enabled };
          }
        }
        await this.save(next); this.probes.delete(data.id);
        if (row) await this.stopMcp(data.id);
        await this.reconcile();
      } else throw new Error('未知的资源操作');
      return this.snapshot(data.workspaceId, data.presetId);
    });
  }
  checkRevision(snapshot, data) {
    if (snapshot.mcps.find(row => row.id === data.id)?.revision !== data.revision) throw new Error('MCP 配置已变化，请刷新后重试');
  }
  async stopMcp(id) { const fiber = this.fibers.get(id); if (fiber) { await fiber.dispose(); this.fibers.delete(id); } this.probes.delete(id); this.loadErrors.delete(id); }
  test(data, signal) { return this.serial(() => this.probe(data, signal)); }
  async probe(data, signal) {
    const snapshot = await this.snapshot(data.workspaceId, data.presetId); this.checkRevision(snapshot, data);
    if (data.profile !== this.environment.profileDir) throw new Error('实例 profile 已变化，请刷新');
    const row = this.state.mcps.find(row => row.id === data.id);
    const entry = this.entries().find(entry => this.entryId(entry) === data.id);
    const raw = row?.config ?? entry?.options.config;
    const config = raw && resolveEnvironment(raw);
    if (!config) throw new Error('当前 MCP 没有可用的已解析配置，请先启用');
    const client = new Client({ name: 'dsh-plugin-hub-probe', version: '1.0.0' });
    const abort = AbortSignal.any([this.lifecycle.signal, signal ?? new AbortController().signal, AbortSignal.timeout(15000)]);
    const transport = config.transport === 'stdio' ? new StdioClientTransport({ command: config.command, args: config.args ?? [],
      env: { ...Object.fromEntries(['PATH', 'HOME', 'USERPROFILE', 'SystemRoot', 'TMPDIR', 'TEMP', 'LANG'].filter(k => process.env[k]).map(k => [k, process.env[k]])), ...config.env },
      cwd: config.cwd || undefined, stderr: 'ignore',
    }) : new StreamableHTTPClientTransport(new URL(config.url), { requestInit: { headers: config.headers } });
    const started = Date.now();
    let onAbort;
    const cancellation = new Promise((_, reject) => {
      onAbort = () => { void transport.close(); reject(abort.reason); };
      abort.addEventListener('abort', onAbort, { once: true });
    });
    try {
      if (abort.aborted) throw abort.reason;
      const result = await Promise.race([(async () => { await client.connect(transport); return client.getServerCapabilities()?.tools ? client.listTools({}, { signal: abort, timeout: 15000 }) : { tools: [] }; })(), cancellation]);
      this.probes.set(data.id, { status: 'success', tools: result.tools.length, version: client.getServerVersion()?.version ?? null, icon: safeIcon(client.getServerVersion()?.icons?.[0]?.src), description: String(client.getServerVersion()?.description ?? client.getInstructions() ?? '').slice(0, 8000), durationMs: Date.now() - started, at: new Date().toISOString() });
    } catch { this.probes.set(data.id, { status: 'failed', at: new Date().toISOString(), durationMs: Date.now() - started }); }
    finally { abort.removeEventListener('abort', onAbort); await client.close().catch(() => {}); }
    return this.snapshot(data.workspaceId, data.presetId);
  }
  async skillFile(data) {
    const snapshot = await this.snapshot(data.workspaceId);
    if (data.profile !== this.environment.profileDir) throw new Error('实例 profile 已变化，请刷新');
    const row = snapshot.skills.find(row => row.id === data.id);
    if (!row?.directory) throw new Error('此 Skill 没有本地文件');
    const directory = await realpath(row.directory);
    const path = await realpath(join(directory, 'SKILL.md'));
    if (!inside(directory, path)) throw new Error('Skill 文件不在来源目录内');
    const text = await readFile(path, 'utf8');
    if (text.length > 1000000) throw new Error('Skill 文件过大，请打开目录查看');
    return { path, text };
  }
  async open(data) {
    const snapshot = await this.snapshot(data.workspaceId, data.presetId);
    if (data.profile !== this.environment.profileDir) throw new Error('实例 profile 已变化，请刷新');
    const path = data.kind === 'plugin' ? snapshot.plugins.find(row => row.name === data.id)?.directory : snapshot.skills.find(row => row.id === data.id)?.directory;
    if (!path) throw new Error('这个资源没有本地目录');
    const canonical = await realpath(path);
    const [command, args] = process.platform === 'darwin' ? ['open', [canonical]] : process.platform === 'win32' ? ['explorer.exe', [canonical]] : ['xdg-open', [canonical]];
    await new Promise((resolve, reject) => { const child = spawn(command, args, { shell: false, stdio: 'ignore' }); child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(new Error('宿主无法打开目录，请根据来源路径手动打开'))); });
    return { opened: true };
  }
  async close() { this.closed = true; this.lifecycle.abort(); clearInterval(this.timer); await this.tail; for (const id of this.fibers.keys()) await this.stopMcp(id); for (const scope of this.scopes.values()) await scope.dispose(); }
}
