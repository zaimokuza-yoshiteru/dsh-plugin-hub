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
import { CatalogProviders } from '../src/providers.js';

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

test('owner and origin are optional, preserve supplied metadata and reject invalid supplied values', () => {
  for (const omitted of [[], ['owner'], ['origin'], ['owner', 'origin']]) {
    const entry = { ...sample.plugins[0] };
    for (const key of omitted) delete entry[key];
    assert.deepEqual(validateCatalog({ schemaVersion: 1, plugins: [entry] }).plugins[0], entry);
  }
  for (const owner of [null, '', ' ', 42, 'x'.repeat(81)]) {
    assert.throws(() => validateCatalog({ schemaVersion: 1, plugins: [{ ...sample.plugins[0], owner }] }), /owner/);
  }
  for (const origin of [null, '', 'other', 42]) {
    assert.throws(() => validateCatalog({ schemaVersion: 1, plugins: [{ ...sample.plugins[0], origin }] }), /origin/);
  }
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
  const shasum = createHash('sha1').update(bytes).digest('hex');
  const legacyFetcher = async url => String(url).endsWith('.tgz') ? new Response(bytes) : Response.json({ 'dist-tags': { latest: '1.2.3' }, versions: { '1.2.3': { dist: { tarball: 'https://registry.example.invalid/catalog.tgz', shasum } } } });
  const legacyResult = await loadCatalogSource({ kind: 'npm', packageName: 'catalog' }, 'https://registry.example.invalid/', legacyFetcher);
  assert.equal(legacyResult.version, '1.2.3');
  assert.deepEqual(legacyResult.catalog, sample);
});

test('legacy registry shasum verifies bytes when integrity is absent', () => {
  const bytes = Buffer.from('catalog data');
  const shasum = createHash('sha1').update(bytes).digest('hex');
  for (const missing of [undefined, null, '', ' ']) checkIntegrity(bytes, missing, shasum);
  checkIntegrity(bytes, undefined, shasum.toUpperCase());
  checkIntegrity(bytes, 'sha1-' + createHash('sha1').update(bytes).digest('base64'));
  assert.throws(() => checkIntegrity(Buffer.from('changed data'), undefined, shasum), /完整性/);
  for (const invalid of [undefined, '', 'abc', 'g'.repeat(40), '0'.repeat(39), '0'.repeat(41)]) {
    assert.throws(() => checkIntegrity(bytes, undefined, invalid, 'required'), /integrity 或 shasum/);
  }
});

test('a valid shasum cannot bypass an invalid integrity field or a stronger digest', () => {
  const bytes = Buffer.from('catalog data');
  const shasum = createHash('sha1').update(bytes).digest('hex');
  const valid = 'sha512-' + createHash('sha512').update(bytes).digest('base64');
  const wrong = 'sha512-' + createHash('sha512').update('different data').digest('base64');
  checkIntegrity(bytes, valid, '0'.repeat(40));
  for (const invalid of [wrong, 'malformed', 123, `${wrong} sha1-${Buffer.from(shasum, 'hex').toString('base64')}`]) {
    assert.throws(() => checkIntegrity(bytes, invalid, shasum), /完整性/);
  }
});

test('catalog checksum policy is configurable without bypassing JSON validation or reusing a weaker cache', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'catalog-policy-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, 'package'));
  const pack = async catalog => {
    await writeFile(join(dir, 'package/plugins.json'), JSON.stringify(catalog));
    await c({ gzip: true, file: join(dir, 'data.tgz'), cwd: dir }, ['package/plugins.json']);
    return readFile(join(dir, 'data.tgz'));
  };
  let bytes = await pack(sample);
  const registry = 'https://registry.example.invalid/';
  let dist = { tarball: registry + 'data.tgz' };
  const fetcher = async url => String(url).endsWith('.tgz') ? new Response(bytes) : Response.json({ 'dist-tags': { latest: '1.0.0' }, versions: { '1.0.0': { dist } } });
  const source = { id: 'company', kind: 'npm', packageName: 'catalog' };
  const result = await loadCatalogSource(source, registry, fetcher);
  assert.deepEqual(result.verification, { policy: 'if-present', method: 'unavailable' });
  assert.deepEqual(result.catalog, sample);
  const compatible = new CatalogProviders({ cacheDir: dir, registry, fetcher });
  compatible.registerSource(source); await compatible.refresh(); compatible.close();
  const strict = new CatalogProviders({ cacheDir: dir, registry, fetcher, catalogVerification: 'required' });
  strict.registerSource(source); await strict.refresh();
  assert.equal(strict.snapshot().plugins.length, 0);
  assert.match(strict.snapshot().sources[0].error, /integrity 或 shasum/); strict.close();
  dist = { ...dist, integrity: 'sha512-' + createHash('sha512').update('wrong data').digest('base64') };
  for (const policy of ['if-present', 'required']) await assert.rejects(loadCatalogSource(source, registry, fetcher, policy), /完整性/);
  assert.equal((await loadCatalogSource(source, registry, fetcher, 'none')).verification.method, 'disabled');
  bytes = await pack({ schemaVersion: 999, plugins: [] });
  await assert.rejects(loadCatalogSource(source, registry, fetcher, 'none'), /schemaVersion/);
  await assert.rejects(loadCatalogSource(source, registry, fetcher, 'typo'), /catalogVerification/);
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
