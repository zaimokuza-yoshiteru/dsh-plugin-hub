export const MARKET_PACKAGE = '@zaimokuza/dsh-plugin-hub';
export const CATALOG_PACKAGE = '@zaimokuza/dsh-plugin-hub-catalog-demo';
export const DEFAULT_BRAND = Object.freeze({ title: 'Plugin Hub', subTitle: 'DSH EXTENSIONS', primaryColor: '#596579', navTitle: 'Plugin Hub' });
export function marketIdentity(id = 'hub') {
  if (typeof id !== 'string' || !/^[a-z][a-z0-9-]{0,47}$/.test(id)) throw new Error('marketId must be a lowercase identifier (max 48 characters)');
  return { id, service: 'dshPluginHub_' + id.replaceAll('-', '_'), api: `/dsh-plugin-hub/${id}/api/`, help: `/dsh-plugin-hub/${id}/demo/help` };
}
export function normalizeBrand(value = {}) {
  const brand = { ...DEFAULT_BRAND, ...value };
  for (const key of ['title', 'subTitle', 'navTitle']) if (typeof brand[key] !== 'string' || !brand[key].trim() || brand[key].length > 80) throw new Error(`Invalid brand ${key}`);
  const colors = { red: '#c92536', blue: '#2563eb', green: '#16805d', purple: '#7c3aed', orange: '#c65d0b' };
  brand.primaryColor = colors[brand.primaryColor] ?? brand.primaryColor;
  if (!/^#[a-f\d]{6}$/i.test(brand.primaryColor)) throw new Error('primaryColor must be #RRGGBB or red/blue/green/purple/orange');
  return Object.fromEntries(['title','subTitle','navTitle','primaryColor'].map(key => [key, brand[key]]));
}
