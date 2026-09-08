import { MARKET_PACKAGE, CATALOG_PACKAGE, marketIdentity, normalizeBrand, catalogVerification } from './identity.js';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { createRegistryFetch } from './registry.js';
import { Marketplace } from './service.js';
import { dshEnvironment, createDshInstaller } from './dsh.js';
import { PACKAGE_NAME, validateCatalog } from './catalog.js';
import { createProviderApi } from './provider-api.js';
import { readReleaseAge } from './release-age.js';

export const name = MARKET_PACKAGE;
export const inject = ['webServer', 'connection'];


const json = (res, status, value) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(value)); };

async function body(req) {
  const buffers = []; let size = 0;
  for await (const bytes of req) { size += bytes.length; if (size > 16384) throw new Error('请求过大'); buffers.push(bytes); }
  return JSON.parse(Buffer.concat(buffers).toString('utf8'));
}

export async function apply(ctx, options = {}) {
  for (const [name, fn] of [['connection.requestRejection', ctx.connection?.requestRejection], ['webServer.register', ctx.webServer?.register], ['provide', ctx.provide], ['effect', ctx.effect]]) {
    if (typeof fn !== 'function') throw new Error(`Plugin Hub cannot start: required DSH API ${name} is unavailable. / 市场无法启动：当前 DSH 缺少必要接口 ${name}。`);
  }
  const identity = marketIdentity(options.marketId);
  const API = identity.api;
  const brand = normalizeBrand(options.brand);
  const environment = dshEnvironment(options.profile ?? 'web');
  const source = { kind: 'npm', packageName: options.catalogPackage ?? CATALOG_PACKAGE };
  if (options.source) throw new Error('目录来源已改为 Nexus npm 包，请使用 catalogPackage 配置');
  if (!PACKAGE_NAME.test(source.packageName)) throw new Error('目录 npm 包名无效');
  const registry = new URL(options.registry ?? 'https://registry.npmjs.org/');
  if (registry.protocol !== 'https:' || registry.username || registry.password) throw new Error('npm registry 必须是无凭据的 HTTPS 地址');
  const releaseAge = await readReleaseAge(environment.profileDir);
  const sources = options.catalogSources ?? [{ id: 'company', displayName: source.packageName === CATALOG_PACKAGE ? 'Demo catalog' : brand.title, ...source, priority: 100 }];
  if (!Array.isArray(sources) || sources.length > 20 || sources.some(s => s?.kind !== 'npm')) throw new Error('catalogSources must contain at most 20 npm sources; JSON providers register through the plugin API');
  const config = { source, sources, brand, identity, catalogVerification: catalogVerification(options.catalogVerification), packageName: options.packageName ?? MARKET_PACKAGE, registry: registry.href.replace(/\/?$/, '/'), cacheDir: join(environment.profileDir, '.dsh-plugin-hub', identity.id), ...releaseAge };
  const installer = createDshInstaller(environment, config);
  const market = new Marketplace({ config, host: environment.host, fetcher: createRegistryFetch(config.registry), installer });
  // The public package ships an independent catalog snapshot for first-open discovery.
  // Enterprise wrappers do not read it: their catalog name differs from CATALOG_PACKAGE.
  if (source.packageName === CATALOG_PACKAGE && !options.catalogSources) {
    try {
      const file = createRequire(import.meta.url).resolve(CATALOG_PACKAGE + '/plugins.json');
      market.providers.entries.get('company').value = { catalog: validateCatalog(JSON.parse(await readFile(file, 'utf8'))), source: CATALOG_PACKAGE, version: 'bundled', updatedAt: null };
    } catch { /* A registry refresh remains available if a snapshot is absent. */ }
  }
  if (options.initialCatalog) market.providers.registerSource({ id: 'bundled', displayName: brand.title, kind: 'json', getCatalog: async () => options.initialCatalog }, { primary: true });
  // Registry availability must not delay or fail DSH boot.
  await market.init({ refresh: false });
  ctx.provide(identity.service, createProviderApi(market.providers));
  void market.refresh().catch(error => { market.catalogError = error.message; });
  ctx.effect(() => () => { installer.close(); return market.close(); }, 'Plugin Hub: lifecycle');
  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: API.slice(0, -1), async handler(req, res) {
    const rejection = ctx.connection.requestRejection(req);
    if (rejection) { json(res, rejection, { error: '请先登录当前 DSH 实例' }); return; }
    if (req.method === 'POST') {
      let origin;
      try { origin = new URL(req.headers.origin).host; } catch { origin = null; }
      if (!origin || origin !== req.headers.host) { json(res, 403, { error: '请求来源不匹配' }); return; }
    }
    try {
      const path = new URL(req.url, 'http://localhost').pathname.slice(API.length);
      if (path === 'state' && req.method === 'GET') { json(res, 200, await market.snapshot()); return; }
      if (req.method !== 'POST') { json(res, 405, { error: '不支持的请求方法' }); return; }
      if (path === 'refresh-start' && req.method === 'POST') { void market.refresh().catch(error => { market.catalogError = error.message; }); json(res, 202, await market.snapshot()); return; }
      if (path === 'refresh') { await market.refresh(); json(res, 200, await market.snapshot()); return; }
      const data = await body(req);
      if (path === 'releases') { void market.loadReleases(data.packageNames).catch(error => { market.catalogError = error.message; }); json(res, 202, await market.snapshot()); return; }
      if (path === 'install') { json(res, 202, await market.enqueue(data.packageName, data.version)); return; }
      if (path === 'uninstall') { json(res, 202, await market.enqueue(data.packageName, undefined, 'uninstall')); return; }
      json(res, 404, { error: '接口不存在' });
    } catch (error) { json(res, 400, { error: error.message }); }
  } }), 'Plugin Hub: HTTP routes');

}

/** Generated brands use this factory without activating the default demo bundle. */
export function createMarketplace(defaults) {
  marketIdentity(defaults.marketId);
  return { name: defaults.packageName, inject, apply: (ctx, options = {}) => apply(ctx, { ...defaults, ...options, brand: { ...defaults.brand, ...options.brand }, marketId: defaults.marketId, packageName: defaults.packageName }) };
}
