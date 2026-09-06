import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { c } from 'tar';
import { validateCatalog, evaluateVersion } from '../src/catalog.js';
import { Marketplace } from '../src/service.js';
import { createDemoTransport, DEMO_CATALOG_PACKAGE, DEMO_REGISTRY } from './fixtures/demo.js';
import { loadCatalogSource, readCatalogTarball, checkIntegrity } from '../src/source.js';

const sample = JSON.parse(await readFile(new URL('../catalog.example.json', import.meta.url), 'utf8'));
const host = { dsh: '0.1.3-alpha.1', node: '22.19.0', platform: 'darwin', arch: 'arm64', peers: { '@deepseek-ai/cordis': '4.0.2' } };
const now = Date.parse('2026-09-05T08:00:00Z');
const hoursAgo = hours => new Date(now - hours * 3600000).toISOString();

test('malformed catalog, duplicate package and unsafe help URL never become a valid catalog', () => {
  assert.equal(validateCatalog(sample).plugins.length, 1);
  assert.throws(() => validateCatalog({ schemaVersion: 2, plugins: [] }), /schemaVersion/);
  assert.throws(() => validateCatalog({ ...sample, plugins: [sample.plugins[0], sample.plugins[0]] }), /重复/);
  assert.throws(() => validateCatalog({ ...sample, plugins: [{ ...sample.plugins[0], troubleshootingUrl: 'javascript:alert(1)' }] }), /HTTPS/);
  assert.throws(() => validateCatalog({ ...sample, plugins: [{ ...sample.plugins[0], tags: ['agent', 'agent'] }] }), /tags/);
});

test('a prerelease host requires explicit matching declaration; no implicit widening', () => {
  assert.equal(evaluateVersion('1.0.0', { engines: { dsh: '>=0.1.2 <0.2.0' } }, hoursAgo(60), host, now).compatibility, 'incompatible');
  assert.equal(evaluateVersion('1.0.0', { engines: { dsh: '0.1.3-alpha.1' } }, hoursAgo(60), host, now).canInstall, true);
  assert.equal(evaluateVersion('1.0.0', {}, hoursAgo(60), host, now).compatibility, 'unknown');
});

test('48-hour boundary, missing timestamps and mismatched peers remain distinct', () => {
  const manifest = { engines: { dsh: host.dsh } };
  assert.equal(evaluateVersion('1.0.0', manifest, hoursAgo(48), host, now).canInstall, true);
  assert.equal(evaluateVersion('1.0.0', manifest, hoursAgo(47.99), host, now).age, 'waiting');
  assert.equal(evaluateVersion('1.0.0', manifest, undefined, host, now).age, 'unknown');
  const incompatible = evaluateVersion('1.0.0', { ...manifest, peerDependencies: { '@deepseek-ai/cordis': '^5.0.0' } }, hoursAgo(60), host, now);
  assert.equal(incompatible.compatibility, 'incompatible');
  assert.equal(incompatible.canInstall, false);
});

async function fixture(t, options = {}) {
  const cacheDir = await mkdtemp(join(tmpdir(), 'example-market-test-'));
  const transport = await createDemoTransport(host.dsh);
  const config = { cacheDir, source: { kind: 'npm', packageName: DEMO_CATALOG_PACKAGE }, registry: DEMO_REGISTRY, minimumAgeHours: 48 };
  const installer = options.installer ?? { installed: async () => ({}), install: async () => {} };
  const market = new Marketplace({ config, host, fetcher: transport.fetch, installer, demo: options.demo ? transport : null });
  t.after(async () => { await market.close(); if (!options.demo) await transport.close(); await rm(cacheDir, { recursive: true, force: true }); });
  await market.init();
  return { market, transport, cacheDir };
}

test('Nexus catalog metadata and tarball requests are intercepted and a single failed npm lookup does not break other plugins', async t => {
  const { market, transport } = await fixture(t);
  const state = await market.snapshot();
  assert.equal(state.plugins.length, 8);
  assert.equal(state.plugins.filter(p => p.queryError).length, 1);
  assert.equal(state.plugins.find(p => p.packageName.endsWith('knowledge-search')).recommendedVersion, '1.4.2');
  assert.equal(transport.state.requests.find(r => r.url === DEMO_REGISTRY + encodeURIComponent(DEMO_CATALOG_PACKAGE)).status, 200);
  assert(transport.state.requests.some(r => r.url.endsWith('/normal.tgz')));
  assert(transport.state.requests.every(r => !r.url.includes('bitbucket.')));
  assert(transport.state.requests.every(r => r.intercepted));
});

test('broken or unavailable catalog preserves last valid snapshot; recovered catalog adds a new plugin', async t => {
  const { market, transport, cacheDir } = await fixture(t);
  const cacheFile = market.providers.entries.get('company').file;
  const before = await readFile(cacheFile, 'utf8');
  transport.state.scenario = 'broken'; await market.refresh();
  assert.equal((await market.snapshot()).catalog.stale, true);
  assert.equal((await market.snapshot()).plugins.length, 8);
  assert.equal(await readFile(cacheFile, 'utf8'), before);
  transport.state.scenario = 'offline'; await market.refresh();
  assert.match((await market.snapshot()).catalog.error, /503/);
  transport.state.scenario = 'updated'; await market.refresh();
  assert.equal((await market.snapshot()).catalog.error, null);
  assert.equal((await market.snapshot()).plugins.length, 9);
});

test('install API rejects unknown packages, incompatible and young versions', async t => {
  const { market } = await fixture(t);
  await assert.rejects(market.enqueue('not-in-catalog', '1.0.0'), /不在当前目录/);
  await assert.rejects(market.enqueue('@example/dsh-knowledge-search', '1.5.0'), /48/);
  await assert.rejects(market.enqueue('@example/dsh-workflow-kit', '2.0.0'), /当前/);
  assert.equal(market.jobs.length, 0);
});

test('concurrent submissions are deduplicated and installations run serially', async t => {
  let running = 0; let maximum = 0; const operations = [];
  const installer = { installed: async () => ({}), async install(name) { running++; maximum = Math.max(maximum, running); operations.push(name); await new Promise(resolve => setTimeout(resolve, 20)); running--; } };
  const { market } = await fixture(t, { installer });
  const [one, duplicate] = await Promise.all([market.enqueue('@example/dsh-knowledge-search', '1.4.2'), market.enqueue('@example/dsh-knowledge-search', '1.4.2')]);
  assert.equal(one.id, duplicate.id);
  await market.enqueue('@example/dsh-bitbucket-review', '1.2.0');
  await market.worker;
  assert.equal(maximum, 1);
  assert.equal(operations.length, 2);
  assert(market.jobs.every(job => job.status === 'completed'));
});

test('failed installation remains a failed task, not pending successful restart', async t => {
  const installer = { installed: async () => ({}), install: async () => { throw new Error('Nexus blocked a transitive dependency'); } };
  const { market } = await fixture(t, { installer });
  await market.enqueue('@example/dsh-bitbucket-review', '1.2.0'); await market.worker;
  const state = await market.snapshot();
  assert.equal(state.jobs[0].status, 'failed');
  assert.equal(state.pendingRestart, 0);
  assert.match(state.jobs[0].error, /transitive/);
});

test('npm data package is verified and parsed as JSON without installing or running it', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'example-catalog-tar-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, 'package'));
  await writeFile(join(dir, 'package/plugins.json'), JSON.stringify(sample));
  await writeFile(join(dir, 'package/ignored.js'), 'throw new Error("must never execute")');
  await c({ gzip: true, file: join(dir, 'catalog.tgz'), cwd: dir }, ['package']);
  const bytes = await readFile(join(dir, 'catalog.tgz'));
  const integrity = 'sha512-' + createHash('sha512').update(bytes).digest('base64');
  assert.deepEqual(await readCatalogTarball(bytes), sample);
  checkIntegrity(bytes, integrity);
  assert.throws(() => checkIntegrity(Buffer.from('wrong bytes'), integrity), /完整性/);
  const fetcher = async url => String(url).endsWith('.tgz') ? new Response(bytes) : Response.json({ 'dist-tags': { latest: '1.2.3' }, versions: { '1.2.3': { dist: { tarball: 'https://registry.example.invalid/catalog.tgz', integrity } } } });
  const result = await loadCatalogSource({ kind: 'npm', packageName: 'catalog' }, 'https://registry.example.invalid/', fetcher);
  assert.equal(result.version, '1.2.3');
  assert.deepEqual(result.catalog, sample);
});

test('documentation and troubleshooting are independently optional and validated when supplied', () => {
  for (const keys of [[], ['documentationUrl'], ['troubleshootingUrl'], ['documentationUrl', 'troubleshootingUrl']]) {
    const entry = { ...sample.plugins[0] }; delete entry.troubleshootingUrl;
    for (const key of keys) entry[key] = 'https://docs.example.test/plugin';
    const result = validateCatalog({ schemaVersion: 1, plugins: [entry] }).plugins[0];
    assert.deepEqual(result, entry);
  }
  assert.throws(() => validateCatalog({ ...sample, plugins: [{ ...sample.plugins[0], documentationUrl: 'javascript:alert(1)' }] }), /HTTPS/);
});

test('uninstall does not require npm availability or release eligibility; conflict is rejected and failures preserve installation', async t => {
  const installed = { '@example/dsh-service-catalog': '0.0.1' };
  let calls = 0;
  const installer = { installed: async () => ({ ...installed }), async uninstall(name) { calls++; await new Promise(r => setTimeout(r, 20)); delete installed[name]; } };
  const { market, transport } = await fixture(t, { installer });
  const before = transport.state.requests.length;
  const [one, duplicate] = await Promise.all([market.enqueue('@example/dsh-service-catalog', null, 'uninstall'), market.enqueue('@example/dsh-service-catalog', null, 'uninstall')]);
  assert.equal(one.id, duplicate.id);
  await assert.rejects(market.enqueue('@example/dsh-service-catalog', '0.0.1'), /其它操作/);
  await market.worker;
  assert.equal(calls, 1);
  assert.equal(transport.state.requests.length, before);
  assert.equal((await market.snapshot()).plugins.find(p => p.packageName === '@example/dsh-service-catalog').installedVersion, null);
  await assert.rejects(market.enqueue('@example/dsh-service-catalog', null, 'uninstall'), /尚未安装/);
  await assert.rejects(market.enqueue('@zaimokuza/dsh-plugin-hub', null, 'uninstall'), /CLI/);
});

test('failed uninstall keeps installed state and does not count as a successful restart task', async t => {
  const installer = { installed: async () => ({ '@example/dsh-bitbucket-review': '1.2.0' }), uninstall: async () => { throw new Error('profile is locked'); } };
  const { market } = await fixture(t, { installer });
  await market.enqueue('@example/dsh-bitbucket-review', null, 'uninstall'); await market.worker;
  const state = await market.snapshot();
  assert.equal(state.jobs[0].status, 'failed'); assert.equal(state.pendingRestart, 0);
  assert.equal(state.plugins.find(p => p.packageName === '@example/dsh-bitbucket-review').installedVersion, '1.2.0');
});

test('completed simulated uninstall stays removed after loading persisted tasks', async t => {
  const { market } = await fixture(t, { demo: true });
  await market.enqueue('dsh-markdown-tools', null, 'uninstall'); await market.worker;
  assert.equal(market.simulatedInstalled['dsh-markdown-tools'], undefined);
  market.simulatedInstalled['dsh-markdown-tools'] = '1.2.0';
  await market.init({ refresh: false });
  assert.equal(market.simulatedInstalled['dsh-markdown-tools'], undefined);
});
