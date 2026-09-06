/** Public host-side contract; contributors never receive installer or registry access. */
export function createProviderApi(providers) {
  return Object.freeze({
    apiVersion: 1,
    registerSource: source => providers.registerSource(source),
  });
}
