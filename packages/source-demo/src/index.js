import { createSourcePlugin } from '@zaimokuza/dsh-plugin-hub/source-plugin';
const plugin = createSourcePlugin({
  packageName: '@zaimokuza/dsh-plugin-hub-source-demo',
  marketId: 'hub', id: 'zaimokuza', displayName: 'Zaimokuza', priority: 100,
  kind: 'npm', catalogPackage: '@zaimokuza/dsh-plugin-hub-source-catalog-demo',
});
export const name = plugin.name;
export const inject = plugin.inject;
export const apply = plugin.apply;
