import { fetch } from 'undici';
import getRegistryAuthToken from 'registry-auth-token';

/** Use existing npm credentials for the configured Nexus origin; never send them to redirects. */
export function createRegistryFetch(registry, { fetcher = fetch, authLookup = getRegistryAuthToken } = {}) {
  const origin = new URL(registry).origin;
  return async (value, options = {}) => {
    const url = new URL(value);
    if (url.origin !== origin || url.protocol !== 'https:' || url.username || url.password) throw new Error('仓库请求地址不属于配置的 Nexus');
    const auth = authLookup(url.href, { recursive: true });
    const headers = new Headers(options.headers);
    if (auth) headers.set('authorization', `${auth.type} ${auth.token}`);
    return fetcher(url, { ...options, headers, redirect: 'error' });
  };
}
