import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inScope, resolveScope } from '../src/client/scope.js';
import { CatalogProviders } from '../src/providers.js';
import { Marketplace } from '../src/service.js';
import { createProviderApi } from '../src/provider-api.js';
import { apply as applyExample } from '../../../examples/custom-catalog/index.js';
import { createDemoTransport, DEMO_REGISTRY, DEMO_CATALOG_PACKAGE } from './fixtures/demo.js';
const sample = JSON.parse(await readFile(new URL('../catalog.example.json', import.meta.url), 'utf8'));
const catalog = (name, displayName = name) => ({ schemaVersion: 1, plugins: [{ ...sample.plugins[0], packageName: name, displayName }] });
async function fixture(t, timeoutMs = 100) {
  const cacheDir = await mkdtemp(join(tmpdir(), 'catalog-providers-'));
  const transport = await createDemoTransport('0.1.3-alpha.1');
  const options = { cacheDir, registry: DEMO_REGISTRY, fetcher: transport.fetch, timeoutMs };
  const providers = new CatalogProviders(options);
  t.after(async () => { providers.close(); await transport.close(); await rm(cacheDir, { recursive: true, force: true }); });
  return { providers, options, transport };
}
test('public v1 data API accepts independent plugin catalogs and cleans up optional registration', async t => {
  const { providers } = await fixture(t);
  const api = createProviderApi(providers);
  assert(Object.isFrozen(api));
  assert.deepEqual(Object.keys(api).sort(), ['apiVersion', 'registerSource']);
  const primary = catalog('@zaimokuza/dsh-acp-adapter', 'Primary entry');
  providers.registerSource({ id: 'main', kind: 'json', getCatalog: () => primary }, { primary: true });
  // Model optional Cordis binding: callback starts only when the service exists.
  let activate; let cleanups = []; let stop;
  const ctx = {
    inject(services, callback) {
      assert.deepEqual(services, ['dshPluginHub_enterprise']);
      activate = hub => callback({ dshPluginHub_enterprise: hub, effect: fn => cleanups.push(fn()) });
      return { dispose() { for (const dispose of cleanups.splice(0)) dispose(); } };
    },
    effect(fn) { stop = fn(); },
  };
  applyExample(ctx, { marketId: 'enterprise' });
  await providers.refresh(); assert.equal(providers.snapshot().sources.length, 1);
  activate({ apiVersion: 2 }); assert.equal(providers.snapshot().sources.length, 1);
  activate(api); await providers.refresh();
  const state = providers.snapshot();
  assert.equal(state.sources.find(s => s.id === 'custom-catalog-example').count, 1);
  assert.equal(state.plugins.length, 1);
  assert.equal(state.plugins[0].displayName, 'ACP Adapter');
  assert.deepEqual(state.plugins[0].catalogSourceIds, ['custom-catalog-example', 'main']);
  stop(); stop();
  assert.equal(providers.snapshot().plugins[0].displayName, 'Primary entry');
  activate(api); await providers.refresh(); assert.equal(providers.snapshot().sources.length, 2);
  stop();
});

test('public API validates independent sources and isolates invalid catalogs from healthy data', async t => {
  const { providers } = await fixture(t);
  const api = createProviderApi(providers);
  let broken = false;
  api.registerSource({ id: 'direct', kind: 'json', primary: true, getCatalog: () => broken ? { schemaVersion: 9 } : catalog('@team/direct') });
  api.registerSource({ id: 'healthy', kind: 'json', getCatalog: () => catalog('@team/healthy') });
  await providers.refresh(); broken = true; await providers.refresh();
  const state = providers.snapshot();
  assert.equal(state.sources.find(s => s.id === 'direct').stale, true);
  assert(state.sources.every(s => !s.primary));
  assert.equal(state.plugins.length, 2);
  assert.throws(() => api.registerSource({ id: 'direct', kind: 'json', getCatalog: () => sample }), /Duplicate/);
  assert.throws(() => api.registerSource({ id: 'no-loader', kind: 'json' }), /getCatalog/);
});
test('child sources override primary data and preserve membership across tabs', async t => {
  const { providers } = await fixture(t);
  providers.registerSource({ id: 'company', kind: 'npm', packageName: DEMO_CATALOG_PACKAGE, priority: 1000 }, { primary: true });
  providers.registerSource({ id: 'team', kind: 'json', getCatalog: async () => catalog('@example/dsh-team-handbook') });
  providers.registerSource({ id: 'duplicate', kind: 'json', priority: -1000, getCatalog: async () => catalog('@example/dsh-knowledge-search', 'Team title') });
  await providers.refresh(); const state = providers.snapshot();
  assert.equal(state.plugins.length, 9); assert.equal(state.sources.length, 3);
  assert.equal(state.plugins.find(p => p.packageName === '@example/dsh-knowledge-search').catalogSource.id, 'duplicate');
  assert.equal(state.conflicts.length, 1);
  const selected = state.plugins.find(p => p.packageName === '@example/dsh-knowledge-search');
  assert.equal(selected.displayName, 'Team title');
  assert.deepEqual(selected.catalogSourceIds, ['duplicate', 'company']);
  assert.equal(inScope(selected, 'source:duplicate'), true);
  assert.equal(inScope(selected, 'source:team'), false);
  assert.equal(inScope(selected, 'installed'), false);
  assert.equal(inScope({ ...selected, installedVersion: '1.0.0' }, 'installed'), true);
  assert.equal(resolveScope('source:removed', state.sources), 'all');
  const remove = providers.registerSource({ id: 'override', kind: 'json', priority: 200, getCatalog: async () => catalog('@example/dsh-knowledge-search', 'Override') });
  await providers.refresh(); assert.equal(providers.snapshot().plugins.find(p => p.packageName === '@example/dsh-knowledge-search').displayName, 'Override');
  remove(); assert.equal(providers.snapshot().plugins.find(p => p.packageName === '@example/dsh-knowledge-search').catalogSource.id, 'duplicate');
  assert.throws(() => providers.registerSource({ id: 'team', kind: 'json', getCatalog: () => sample }), /Duplicate/);
});
test('bad source keeps only its own cache across restart, while other sources update', async t => {
  const { providers, options } = await fixture(t);
  let broken = false; let name = '@team/first';
  const source = { id: 'stable', kind: 'json', getCatalog: async () => broken ? { schemaVersion: 7 } : catalog('@team/stable') };
  providers.registerSource(source); providers.registerSource({ id: 'changing', kind: 'json', getCatalog: async () => catalog(name) });
  await providers.refresh(); broken = true; name = '@team/second'; await providers.refresh();
  assert.deepEqual(providers.snapshot().plugins.map(p => p.packageName).sort(), ['@team/second', '@team/stable']);
  assert.equal(providers.snapshot().sources.find(s => s.id === 'stable').stale, true);
  const restarted = new CatalogProviders(options); restarted.registerSource(source); await restarted.refresh();
  assert.equal(restarted.snapshot().plugins[0].packageName, '@team/stable'); restarted.close();
  const newIdentity = new CatalogProviders(options); newIdentity.registerSource({ ...source, cacheVersion: '2' }); await newIdentity.refresh();
  assert.equal(newIdentity.snapshot().plugins.length, 0); newIdentity.close();
});
test('timed-out and removed providers cannot block refresh or resurrect late results', async t => {
  const { providers } = await fixture(t, 25);
  let release; const remove = providers.registerSource({ id: 'slow', kind: 'json', getCatalog: () => new Promise(resolve => { release = resolve; }) });
  providers.registerSource({ id: 'fast', kind: 'json', getCatalog: async () => catalog('@team/fast') });
  await providers.refresh(); assert.match(providers.snapshot().sources.find(s => s.id === 'slow').error, /超时/);
  remove(); release(catalog('@team/late')); await new Promise(r => setTimeout(r, 10));
  assert.deepEqual(providers.snapshot().plugins.map(p => p.packageName), ['@team/fast']);
});
test('market refreshes dynamic registration and removes its cards when the provider is disposed', async t => {
  const { options, transport } = await fixture(t);
  const market = new Marketplace({ config: { ...options, minimumAgeHours: 48, sources: [{ id: 'company', kind: 'npm', packageName: DEMO_CATALOG_PACKAGE }] }, fetcher: transport.fetch, host: { dsh: '0.1.3-alpha.1', node: '22.19.0', peers: {} }, installer: { installed: async () => ({}) } });
  t.after(() => market.close()); await market.init();
  const remove = market.providers.registerSource({ id: 'team', kind: 'json', getCatalog: async () => catalog('@example/dsh-team-handbook') });
  await market.refresh(); assert.equal((await market.snapshot()).plugins.length, 9);
  remove(); assert.equal((await market.snapshot()).plugins.length, 8);
  await market.refresh(); assert.equal((await market.snapshot()).sources.length, 1);
});
