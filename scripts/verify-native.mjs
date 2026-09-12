/** Integration verification against an installed, unmodified DSH. No real profile is used. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, mkdir, readFile, writeFile, symlink, realpath } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';

const root = process.cwd();
if (!process.env.DSH_TEST_ROOT) throw new Error('Set DSH_TEST_ROOT to a directory containing node_modules/@deepseek-ai/dsh.');
const runtime = resolve(process.env.DSH_TEST_ROOT);
const cli = join(runtime, 'node_modules/@deepseek-ai/dsh/lib/bin.js');
const hostManifest = JSON.parse(await readFile(join(runtime, 'node_modules/@deepseek-ai/dsh/package.json'), 'utf8'));
await mkdir('.local/native-verification', { recursive: true });
const directory = await realpath(await mkdtemp(resolve('.local/native-verification/run-')));
const home = join(directory, 'home');
const children = new Set();
const checks = [];
const fixtureSkill = '---\nname: hub-fixture\ndescription: Native profile isolation fixture\n---\nSkill source must remain untouched.\n';
await mkdir(join(home, 'skills/hub-fixture'), { recursive: true });
await writeFile(join(home, 'skills/hub-fixture/SKILL.md'), fixtureSkill);

async function freePort() {
  const server = createServer(); await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port;
}
async function start(name) {
  const profile = join(home, 'profiles', name);
  await mkdir(join(profile, 'node_modules/@zaimokuza'), { recursive: true });
  await mkdir(join(profile, 'node_modules/@deepseek-ai'), { recursive: true });
  for (const [packageName, target] of [['@zaimokuza/dsh-plugin-hub', resolve('.')], ['@deepseek-ai/dsh', join(runtime, 'node_modules/@deepseek-ai/dsh')]]) {
    try { await symlink(target, join(profile, 'node_modules', packageName), 'dir'); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
  await writeFile(join(profile, 'package.json'), JSON.stringify({ name: `hub-${name}-fixture`, private: true,
    dependencies: { '@zaimokuza/dsh-plugin-hub': `file:${resolve('.')}` },
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@zaimokuza/dsh-plugin-hub'], patchReload: 'live' } },
  }));
  const externalConfig = { serverName: 'external_fixture', transport: 'stdio', command: process.execPath, args: [resolve('tests/fixtures/mcp-server.mjs')] };
  await writeFile(join(profile, 'cordis.patch.yml'), JSON.stringify([{ insert: [{ id: 'external-fixture', name: '@deepseek-ai/dsh-mcp-client', disabled: true, config: externalConfig }] }]), { flag: 'wx' }).catch(error => { if (error.code !== 'EEXIST') throw error; });
  const port = await freePort();
  const child = spawn(process.execPath, [cli, '--profile', name, '--no-open', '--port', String(port)], {
    env: { ...process.env, DSH_HOME: home, DSH_AGENTS_HOME: join(directory, 'agents-home'), DSH_TELEMETRY_DISABLED: '1' },
    cwd: root, stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.add(child);
  let output = ''; child.stdout.on('data', bytes => { output += bytes; }); child.stderr.on('data', bytes => { output += bytes; });
  let launch;
  for (let attempt = 0; attempt < 225; attempt++) {
    launch = output.match(/http:\/\/127\.0\.0\.1:\d+\/\?token=[\w-]+/)?.[0];
    if (launch || child.exitCode !== null) break;
    await pause(200);
  }
  await writeFile(join(directory, `${name}.log`), output.replace(/token=[\w-]+/g, 'token=[redacted]'));
  if (!launch) throw new Error(`DSH ${name} did not start: ${output.slice(-2200)}`);
  const origin = new URL(launch).origin;
  const login = await fetch(launch, { redirect: 'manual' }); assert.equal(login.status, 303);
  const cookie = login.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
  async function rpc(path, payload = {}) {
    const method = `dshPluginHub_hub/${path}`;
    const res = await fetch(`${origin}/api/${method}`, { method: 'POST', headers: { cookie, origin, 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: crypto.randomUUID(), method, payload }), signal: AbortSignal.timeout(20000) });
    assert.equal(res.status, 200); const body = await res.json();
    if (!body.result?.ok) throw new Error(body.result?.error?.message ?? JSON.stringify(body));
    return body.result.value;
  }
  return { child, rpc, profile, origin, cookie, launch };
}
async function stop(child) {
  if (child.exitCode !== null) { children.delete(child); return; }
  const exit = new Promise(resolve => child.once('exit', resolve)); child.kill('SIGTERM');
  const timer = setTimeout(() => child.kill('SIGKILL'), 8000); await exit; clearTimeout(timer); children.delete(child);
}
async function active(host, id) {
  for (let index = 0; index < 40; index++) {
    const row = (await host.rpc('resources')).mcps.find(row => row.id === id);
    if (row?.activation === 'active') return row;
    await pause(150);
  }
  throw new Error(`Native MCP ${id} did not activate`);
}

try {
  let alpha = await start('alpha'); const beta = await start('beta');
  let state = await alpha.rpc('resources'); assert.equal(state.profile.directory, alpha.profile); assert.equal(state.profile.name, 'alpha');
  assert(state.skills.some(row => row.id === 'hub-fixture')); checks.push('native preset Skill inventory');
  assert.equal((await fetch(`${alpha.origin}/api/dshPluginHub_hub/resources`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 401);
  assert.equal((await fetch(`${alpha.origin}/api/dshPluginHub_hub/resources`, { method: 'POST', headers: { cookie: alpha.cookie, origin: 'https://foreign.invalid', 'content-type': 'application/json' }, body: '{}' })).status, 403);
  checks.push('native authentication and foreign-origin rejection');
  state = await alpha.rpc('resource-mutate', { profile: alpha.profile, action: 'skill-toggle', id: 'hub-fixture', enabled: false });
  assert.equal(state.skills.find(row => row.id === 'hub-fixture').enabled, false);
  assert.equal((await beta.rpc('resources')).skills.find(row => row.id === 'hub-fixture').enabled, true);
  await assert.rejects(alpha.rpc('resource-mutate', { profile: beta.profile, action: 'skill-toggle', id: 'hub-fixture', enabled: true }), /profile 已变化/);
  assert.equal(await readFile(join(home, 'skills/hub-fixture/SKILL.md'), 'utf8'), fixtureSkill); checks.push('two profiles isolated; shared Skill bytes unchanged');
  state = await alpha.rpc('resource-mutate', { profile: alpha.profile, action: 'mcp-add', description: 'Integration fixture', config: { serverName: 'hub_fixture', transport: 'stdio', command: process.execPath, args: [resolve('tests/fixtures/mcp-server.mjs')] } });
  let row = state.mcps.find(row => row.name === 'hub_fixture'); row = await active(alpha, row.id); assert.equal(row.connection, 'unknown');
  state = await alpha.rpc('mcp-test', { profile: alpha.profile, id: row.id, revision: row.revision }); row = state.mcps.find(item => item.id === row.id);
  assert.equal(row.probe.status, 'success'); assert.equal(row.probe.tools, 1); checks.push('native MCP activation and independent SDK handshake/tools-list');
  state = await alpha.rpc('resource-mutate', { profile: alpha.profile, action: 'mcp-edit', id: row.id, revision: row.revision, config: { serverName: 'hub_fixture', transport: 'stdio', toolCallTimeoutMs: 42000 } });
  row = await active(alpha, row.id); assert.equal(JSON.parse((await alpha.rpc('mcp-config', { profile: alpha.profile, id: row.id, revision: row.revision })).text).toolCallTimeoutMs, 42000);
  state = await alpha.rpc('resource-mutate', { profile: alpha.profile, action: 'mcp-toggle', id: row.id, revision: row.revision, enabled: false }); row = state.mcps.find(item => item.id === row.id); assert.equal(row.enabled, false);
  await alpha.rpc('resource-mutate', { profile: alpha.profile, action: 'mcp-toggle', id: row.id, revision: row.revision, enabled: true }); row = await active(alpha, row.id);
  await alpha.rpc('resource-mutate', { profile: alpha.profile, action: 'mcp-reconnect', id: row.id, revision: row.revision }); row = await active(alpha, row.id);
  checks.push('MCP edit, toggle and reconnect preserve configuration');
  let external = (await alpha.rpc('resources')).mcps.find(row => row.name === 'external_fixture');
  state = await alpha.rpc('resource-mutate', { profile: alpha.profile, action: 'mcp-edit', id: external.id, revision: external.revision, description: 'External override', config: { serverName: 'external_fixture', transport: 'stdio' } }); external = state.mcps.find(row => row.id === external.id);
  state = await alpha.rpc('resource-mutate', { profile: alpha.profile, action: 'mcp-delete', id: external.id, revision: external.revision });
  assert(!state.mcps.some(row => row.id === external.id));
  const source = await readFile(join(alpha.profile, 'cordis.patch.yml'), 'utf8'); assert(!source.includes('external-fixture')); checks.push('owned native MCP definition is deleted from its profile source');
  await stop(alpha.child); alpha = await start('alpha'); state = await alpha.rpc('resources');
  assert.equal(state.skills.find(row => row.id === 'hub-fixture').enabled, false); row = await active(alpha, row.id); assert.equal(JSON.parse((await alpha.rpc('mcp-config', { profile: alpha.profile, id: row.id, revision: row.revision })).text).toolCallTimeoutMs, 42000);
  assert.equal((await beta.rpc('resources')).mcps.some(row => row.name === 'hub_fixture'), false); checks.push('restart persistence and MCP profile isolation');
  state = await alpha.rpc('resource-mutate', { profile: alpha.profile, action: 'mcp-delete', id: row.id, revision: row.revision }); assert(!state.mcps.some(item => item.id === row.id));
  await alpha.rpc('resource-mutate', { profile: alpha.profile, action: 'skill-toggle', id: 'hub-fixture', enabled: true }); checks.push('MCP deletion and Skill restoration');
  if (process.env.DSH_PLAYWRIGHT_PATH) {
    const { chromium } = await import(resolve(process.env.DSH_PLAYWRIGHT_PATH));
    const browser = await chromium.launch({ headless: true, ...(process.env.DSH_CHROME_PATH ? { executablePath: process.env.DSH_CHROME_PATH } : {}) });
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }); const errors = []; page.on('pageerror', error => errors.push(error.message));
      await page.goto(alpha.launch);
      const proceed = page.getByRole('button', { name: /^(继续|Continue)$/ }); await proceed.waitFor({ timeout: 5000 }).then(() => proceed.click()).catch(() => {});
      await page.getByRole('button', { name: 'Plugin Hub', exact: true }).click(); await page.getByRole('heading', { name: 'hub-fixture', exact: true }).waitFor();
      await page.getByRole('tab', { name: /MCP/ }).click(); await page.getByRole('button', { name: '添加 MCP' }).waitFor();
      await page.getByRole('button', { name: '添加 MCP', exact: true }).click();
      let dialog = page.getByRole('dialog');
      await dialog.getByLabel('MCP 配置', { exact: true }).fill(JSON.stringify({ mcpServers: { ui_fixture: { command: process.execPath, args: [resolve('tests/fixtures/mcp-server.mjs')] } } }));
      await dialog.getByRole('button', { name: '保存', exact: true }).click();
      let card = page.locator('article').filter({ has: page.getByRole('heading', { name: /^ui_fixture@/ }) });
      await card.waitFor();
      await card.getByRole('button', { name: '编辑', exact: true }).click();
      dialog = page.getByRole('dialog'); await dialog.getByLabel('MCP 配置', { exact: true }).fill(JSON.stringify({ serverName: 'ui_fixture_edited', transport: 'stdio', command: process.execPath, args: [resolve('tests/fixtures/mcp-server.mjs')] }));
      await dialog.getByRole('button', { name: '保存', exact: true }).click();
      card = page.locator('article').filter({ has: page.getByRole('heading', { name: /^ui_fixture_edited@/ }) }); await card.waitFor();
      await card.getByRole('button', { name: '删除', exact: true }).click();
      await page.getByRole('dialog').getByRole('button', { name: '删除', exact: true }).click(); await card.waitFor({ state: 'hidden' });
      checks.push('native Modal MCP add/edit/delete through the UI');
      await page.getByRole('tab', { name: /Plugin/ }).click(); await page.getByRole('heading', { name: /^@zaimokuza\/dsh-plugin-hub@/ }).waitFor();
      assert.equal(await page.getByRole('button', { name: /浏览插件市场|管理版本/ }).count(), 0);
      await page.getByRole('tab', { name: /Skill/ }).click(); await page.screenshot({ path: join(directory, 'hub-wide.png') });
      await page.getByRole('button', { name: /折叠侧边栏|收起侧边栏|Collapse sidebar/ }).click();
      const hubButton = page.getByRole('button', { name: 'Plugin Hub', exact: true });
      for (let index = 0; index < 50 && (await hubButton.innerText()).trim(); index++) await pause(100);
      assert.equal((await hubButton.innerText()).trim(), ''); assert(await hubButton.isVisible());
      await pause(350);
      await page.screenshot({ path: join(directory, 'hub-collapsed.png') });
      await page.setViewportSize({ width: 700, height: 900 });
      await pause(500);
      const overflow = await page.locator('.hub-resource-page').evaluate(node => node.scrollWidth > node.clientWidth + 1); assert.equal(overflow, false);
      await page.screenshot({ path: join(directory, 'hub-narrow.png') });
      assert.deepEqual(errors, []); checks.push('native UI tabs, collapsed icon, narrow layout and no browser errors');
    } finally { await browser.close(); }
  }
  await writeFile(join(directory, 'evidence.json'), JSON.stringify({ dsh: hostManifest.version, checks, checkedAt: new Date().toISOString() }, null, 2));
  console.log(`DSH ${hostManifest.version}: ${checks.length} integration checks passed. Evidence: ${directory}`);
} finally { await Promise.all([...children].map(stop)); }
