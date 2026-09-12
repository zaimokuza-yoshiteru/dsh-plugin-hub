import { MARKET_PACKAGE, marketIdentity } from './identity.js';
import { join } from 'node:path';
import { dshEnvironment, createDshInventory } from './dsh.js';
import { NativeResources } from './resources.js';
import { Experiments } from './experiments.js';

export const name = MARKET_PACKAGE;
export const inject = ['connection', 'loader', 'skills', 'workspaceRegistry', 'agentPresets'];

export async function apply(ctx, options = {}) {
  for (const [name, fn] of [['connection.fetch.register', ctx.connection?.fetch?.register], ['loader.entries', ctx.loader?.entries], ['provide', ctx.provide], ['effect', ctx.effect]]) {
    if (typeof fn !== 'function') throw new Error(`Plugin Hub cannot start: required DSH API ${name} is unavailable. / Hub 无法启动：当前 DSH 缺少必要接口 ${name}。`);
  }
  const identity = marketIdentity(options.marketId);
  const environment = dshEnvironment(ctx, options.profile);
  const inventory = createDshInventory(environment);
  const resources = new NativeResources(ctx, environment, join(environment.profileDir, '.dsh-plugin-hub', identity.id), inventory);
  const experiments = new Experiments(environment);
  ctx.effect(() => () => { experiments.close(); return resources.close(); }, 'Plugin Hub: lifecycle');
  await resources.init();
  await experiments.snapshot();
  const dispatch = async (path, data = {}, signal) => {
    if (!data || typeof data !== 'object' || Array.isArray(data) || JSON.stringify(data).length > 32768) throw new Error('无效或过大的请求');
    if (path === 'resources') return resources.snapshot(data.workspaceId, data.presetId);
    if (path === 'resource-mutate') return resources.mutate(data);
    if (path === 'mcp-config') return resources.configuration(data);
    if (path === 'mcp-format') return resources.formatConfiguration(data);
    if (path === 'mcp-test') return resources.test(data, signal);
    if (path === 'open-directory') return resources.open(data);
    if (path === 'skill-file') return resources.skillFile(data);
    if (path === 'experiments') return experiments.snapshot();
    if (path === 'experiment-mutate') return experiments.mutate(data);
    throw new Error('接口不存在');
  };
  // The shared RPC interceptor belongs to DSH's Gateway. Exact Fetch routes
  // compose ahead of it on both the HTTP carrier and Desktop's worker carrier.
  for (const path of ['resources', 'resource-mutate', 'mcp-config', 'mcp-format', 'mcp-test', 'open-directory', 'skill-file', 'experiments', 'experiment-mutate']) {
    ctx.effect(() => ctx.connection.fetch.register({ path: `/api/${identity.service}/${path}`, methods: ['POST'], requestBody: 'buffered', async fetch(request) {
      let envelope;
      try { envelope = await request.json(); } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }); }
      if (envelope?.type !== 'client-request' || typeof envelope.rpcId !== 'string' || envelope.method !== `${identity.service}/${path}`) return Response.json({ error: 'Invalid RPC envelope' }, { status: 400 });
      let result;
      try { result = { ok: true, value: await dispatch(path, envelope.payload, request.signal) }; }
      catch (error) { result = { ok: false, error: { code: 'plugin-hub/request-failed', message: error.message, details: {} } }; }
      return Response.json({ type: 'server-response', rpcId: envelope.rpcId, result }, { headers: { 'cache-control': 'no-store' } });
    } }), 'Plugin Hub: native Connection ' + path);
  }

}
