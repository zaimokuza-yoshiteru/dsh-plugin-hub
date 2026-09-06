/** Source tabs show catalog membership while sharing the single merged package record. */
export function inScope(plugin, scope) {
  if (scope === 'all') return true;
  if (scope === 'installed') return Boolean(plugin.installedVersion);
  return scope.startsWith('source:') && (plugin.catalogSourceIds ?? [plugin.catalogSource?.id]).includes(scope.slice(7));
}
export function resolveScope(scope, sources) {
  return scope === 'all' || scope === 'installed' || sources.some(source => scope === 'source:' + source.id) ? scope : 'all';
}
