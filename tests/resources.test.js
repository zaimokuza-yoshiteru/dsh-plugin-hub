import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { NativeResources, describeMcp, validateMcp } from '../src/resources.js';
import { dshEnvironment } from '../src/dsh.js';
import { connectionRequest } from '../src/client/api.js';

async function fixture(t, name = 'alpha') {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'hub-resources-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const profileDir = join(root, 'profiles', name); await mkdir(profileDir, { recursive: true });
  const project = join(root, 'project'); await mkdir(project);
  const original = { name: 'sample', description: 'A native skill', provider: 'filesystem', source: 'user-dsh', invocation: { modelInvocable: true, userInvocable: true }, resourceBase: { kind: 'directory', path: join(root, 'shared-skills/sample') } };
  let provider;
  const entries = [];
  const ctx = {
    root: { baseUrl: pathToFileURL(profileDir + '/').href },
    skills: { registerProvider(create) { provider = create({ invalidate() {}, signal: new AbortController().signal }); }, async snapshot(options = {}) {
      const overrides = provider?.list(options) ?? [];
      return { skills: overrides.length ? overrides : [original], complete: true };
    } },
    workspaceRegistry: { list: () => [{ id: 'project', path: project, title: 'Project' }] },
    loader: { entries: () => entries, import: async () => ({ apply() {} }) },
    plugin: () => ({ state: 2, dispose: async () => {} }),
  };
  const environment = { profileDir, profile: name, installation: 'cli' };
  const service = new NativeResources(ctx, environment, join(profileDir, '.hub'), { installed: async () => ({}) });
  await service.init(); t.after(() => service.close());
  return { root, ctx, service, environment, original, entries, project, provider: () => provider };
}

test('profile comes from boot root; plugin scope, default web and mismatching options cannot redirect it', async t => {
  const { root, ctx, environment } = await fixture(t);
  const install = join(root, 'runtime'); await mkdir(join(install, 'bin'), { recursive: true });
  const cli = join(install, 'bin/dsh.js'); await writeFile(cli, '');
  await writeFile(join(install, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', version: '0.1.5-rc.2' }));
  const runtime = { argv: ['node', cli], env: { DSH_HOME: root }, versions: { node: '24.0.0' }, platform: 'darwin', arch: 'arm64' };
  ctx.baseUrl = pathToFileURL(install + '/').href;
  const resolved = dshEnvironment(ctx, undefined, runtime);
  assert.equal(resolved.profileDir, environment.profileDir);
  assert.equal(resolved.profile, 'alpha'); assert.equal(resolved.installation, 'cli');
  assert.throws(() => dshEnvironment(ctx, 'web', runtime), /不一致/);
  assert.throws(() => dshEnvironment({ baseUrl: ctx.baseUrl }, undefined, runtime), /无法确认/);
});

test('skill disabling uses a native provider isolated to this profile and workspace; never renames shared files', async t => {
  const { service, environment, original, provider, project } = await fixture(t);
  const result = await service.mutate({ action: 'skill-toggle', id: 'sample', enabled: false, workspaceId: 'project', profile: environment.profileDir });
  assert.equal(result.skills[0].enabled, false);
  assert.equal(result.skills[0].directory, original.resourceBase.path);
  assert.equal((await service.snapshot()).skills[0].enabled, true);
  assert.equal(provider().list({ cwd: join(project, 'src') }).length, 1);
  assert.equal(provider().list({ cwd: project + '-other' }).length, 0);
  await assert.rejects(service.mutate({ action: 'skill-toggle', id: 'sample', enabled: true, profile: '/another/profile' }), /profile 已变化/);
  const persisted = JSON.parse(await readFile(service.file, 'utf8')); assert.equal(persisted.skills[0].cwd, project);
  await service.mutate({ action: 'skill-toggle', id: 'sample', enabled: true, workspaceId: 'project', profile: environment.profileDir });
  assert.equal((await service.snapshot('project')).skills[0].enabled, true);
});

test('MCP metadata never exposes credentials, args or URL query secrets; live connection remains unknown', async t => {
  const { service, environment } = await fixture(t);
  const config = { serverName: 'tools', transport: 'streamable-http', url: 'https://example.test/mcp?token=secret-query', headers: { Authorization: 'Bearer secret-header' } };
  const result = await service.mutate({ action: 'mcp-add', profile: environment.profileDir, config, description: 'Test' });
  assert.equal(result.mcps[0].connection, 'unknown'); assert.equal(result.mcps[0].activation, 'active');
  assert.doesNotMatch(JSON.stringify(result), /secret-query|secret-header/);
  assert.deepEqual(describeMcp(config).endpoint, 'https://example.test/mcp');
  const row = result.mcps[0];
  const updated = await service.mutate({ action: 'mcp-edit', id: row.id, revision: row.revision, profile: environment.profileDir, description: 'Changed', config: { serverName: 'tools_renamed', transport: 'streamable-http' } });
  assert.equal(service.state.mcps[0].config.headers.Authorization, 'Bearer secret-header');
  assert.equal(updated.mcps[0].description, ''); // User text is not server metadata.
  await assert.rejects(service.mutate({ action: 'mcp-delete', id: row.id, revision: row.revision, profile: environment.profileDir }), /配置已变化/);
});

test('native entry toggles persist in Hub and do not call tree write or overwrite the source file', async t => {
  const { service, environment, entries } = await fixture(t);
  const entry = { id: 'root:external', options: { name: '@deepseek-ai/dsh-mcp-client', config: { serverName: 'external', transport: 'stdio', command: 'node' } },
    parent: { tree: { filename: '/shipped/cordis.yml', write() { assert.fail('must not rewrite host source'); } } },
    disabled: false, fiber: { state: 2 }, async update(value) { this.disabled = value.disabled; },
  }; entries.push(entry);
  const row = (await service.snapshot()).mcps[0];
  await service.mutate({ action: 'mcp-toggle', id: row.id, revision: row.revision, enabled: false, profile: environment.profileDir });
  assert.equal(entry.disabled, true);
  assert.deepEqual(JSON.parse(await readFile(service.file, 'utf8')).overrides['root:external'], { enabled: false });
});

test('MCP configuration validates protocol, names and structure before side effects', () => {
  assert.throws(() => validateMcp({ serverName: '../oops' }), /名称/);
  assert.throws(() => validateMcp({ serverName: 'ok', transport: 'sse' }), /协议/);
  assert.throws(() => validateMcp({ serverName: 'ok', transport: 'stdio', command: 'node', args: 'shell string' }), /数组/);
  assert.throws(() => validateMcp({ serverName: 'ok', transport: 'streamable-http', url: 'file:///etc/passwd' }), /HTTP/);
});

test('Web and Desktop share native RPC without a separate plugin-management bridge', async () => {
  const calls = [];
  const connection = { rpc: { async call(...args) { calls.push(args); return { ok: true, value: { mcps: [] } }; } } };
  const request = connectionRequest(connection, 'acme-tools');
  assert.deepEqual(await request('resources', { profile: '/profile' }), { mcps: [] });
  assert.equal(calls[0][0], '/api'); assert.equal(calls[0][1], 'dshPluginHub_acme_tools/resources');
  assert.deepEqual(calls[0][2], { profile: '/profile' });
  const failing = connectionRequest({ rpc: { call: async () => ({ ok: false, error: { message: 'profile changed' } }) } }, 'hub');
  await assert.rejects(failing('resources'), /profile changed/);
});


test('MCP text edits round-trip effective credentials only on explicit profile-bound reads; omitted keys are removed', async t => {
  const { service, environment } = await fixture(t);
  const profile = environment.profileDir;
  let state = await service.mutate({ action: 'mcp-add', profile, text: JSON.stringify({ mcpServers: { sample: { command: 'node', args: ['server.mjs'], env: { TOKEN: 'private-value' }, reconnect: { enabled: false } } } }) });
  const row = state.mcps[0];
  assert.doesNotMatch(JSON.stringify(state), /private-value/);
  await assert.rejects(service.configuration({ id: row.id, revision: row.revision, profile: '/wrong' }), /profile/);
  const doc = await service.configuration({ id: row.id, revision: row.revision, profile });
  assert.equal(JSON.parse(doc.text).env.TOKEN, 'private-value');
  const yaml = service.formatConfiguration({ text: doc.text, format: 'yaml', profile });
  const json = service.formatConfiguration({ text: yaml.text, format: 'json', profile });
  assert.deepEqual(JSON.parse(json.text), JSON.parse(doc.text));
  state = await service.mutate({ action: 'mcp-edit', profile, id: row.id, revision: row.revision, text: `serverName: sample
transport: stdio
command: node
args: []
` });
  assert.equal(service.state.mcps[0].config.env, undefined);
  await assert.rejects(service.configuration({ id: row.id, revision: row.revision, profile }), /配置已变化/);
});

test('Plugin inventory excludes official packages and non-plugins', async t => {
  const { service, environment } = await fixture(t);
  const manifests = { '@deepseek-ai/official': { dsh: { bundle: {} } }, '@team/community': { dsh: { client: {} } }, 'ordinary-library': {} };
  for (const [name, manifest] of Object.entries(manifests)) {
    const dir = join(environment.profileDir, 'node_modules', name); await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'package.json'), JSON.stringify({ name, ...manifest }));
  }
  service.inventory.installed = async () => Object.fromEntries(Object.keys(manifests).map(name => [name, '1.0.0']));
  assert.deepEqual((await service.snapshot()).plugins.map(row => row.name), ['@team/community']);
});

test('external text edits replace credentials without modifying the native source config', async t => {
  const { service, environment, entries } = await fixture(t);
  const source = { serverName: 'external', transport: 'stdio', command: 'node', args: ['server.mjs'], env: { TOKEN: 'old-secret' } };
  let applied;
  entries.push({ id: 'root:editable', options: { name: '@deepseek-ai/dsh-mcp-client', config: structuredClone(source) }, parent: { tree: { filename: '/source/cordis.yml' } }, disabled: true,
    async update(value) { applied = value; this.disabled = value.disabled; } });
  const row = (await service.snapshot()).mcps[0];
  await service.mutate({ action: 'mcp-edit', id: row.id, revision: row.revision, profile: environment.profileDir, text: JSON.stringify({ serverName: 'external', transport: 'stdio', command: 'node' }) });
  assert.equal(applied.config.env, undefined);
  assert.equal(applied.config.args, undefined);
  assert.deepEqual(entries[0].options.config, source);
  const updated = (await service.snapshot()).mcps[0];
  const doc = await service.configuration({ id: row.id, revision: updated.revision, profile: environment.profileDir });
  assert.doesNotMatch(doc.text, /old-secret/);
});
