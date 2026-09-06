import { marketIdentity } from './identity.js';
/** A provider has no UI bundle. Its host service dependency binds it to one market. */
export function createSourcePlugin({ packageName, catalogPackage, marketId = 'hub', ...source }) {
  const { service } = marketIdentity(marketId);
  return { name: packageName, inject: [service], apply(ctx) {
    if (ctx[service].apiVersion !== 1) throw new Error('Unsupported marketplace source API');
    ctx.effect(() => ctx[service].registerSource({ ...source, ...(source.kind === 'npm' ? { packageName: catalogPackage } : {}) }), 'Plugin Hub source registration');
  } };
}
