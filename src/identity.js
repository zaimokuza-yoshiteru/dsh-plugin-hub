export const MARKET_PACKAGE = '@zaimokuza/dsh-plugin-hub';
export const DEFAULT_BRAND = Object.freeze({ title: 'Plugin Hub', subTitle: 'DSH EXTENSIONS', primaryColor: '#596579', navTitle: 'Plugin Hub' });
export function marketIdentity(id = 'hub') {
  if (typeof id !== 'string' || !/^[a-z][a-z0-9-]{0,47}$/.test(id)) throw new Error('marketId must be a lowercase identifier (max 48 characters)');
  return { id, service: 'dshPluginHub_' + id.replaceAll('-', '_') };
}
