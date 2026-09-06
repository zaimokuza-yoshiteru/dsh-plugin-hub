import { readFile } from 'node:fs/promises';

export const name = '@example/dsh-custom-catalog';

export function apply(ctx, { marketId = 'hub' } = {}) {
  if (!/^[a-z][a-z0-9-]{0,47}$/.test(marketId)) throw new Error('Invalid marketId');
  const service = 'dshPluginHub_' + marketId.replaceAll('-', '_');
  // Optional binding: the rest of this plugin runs even without Plugin Hub.
  // 可选接入：没有市场时，也不影响插件自身的其他功能。
  const binding = ctx.inject([service], scope => {
    const hub = scope[service];
    if (hub.apiVersion !== 1) return;
    scope.effect(() => hub.registerSource({
      id: 'custom-catalog-example',
      displayName: 'Custom catalog',
      kind: 'json',
      cacheVersion: '1',
      async getCatalog({ signal }) {
        // Replace with your own data service if needed; honor cancellation.
        // 可替换为自己的数据接口；请遵守 signal 取消请求。
        return JSON.parse(await readFile(new URL('./plugins.json', import.meta.url), { encoding: 'utf8', signal }));
      },
    }), 'Custom catalog: registration');
  });
  ctx.effect(() => () => binding.dispose(), 'Custom catalog: optional binding');
}
