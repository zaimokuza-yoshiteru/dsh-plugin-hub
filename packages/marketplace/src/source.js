import { createHash, timingSafeEqual } from 'node:crypto';
import { Parser } from 'tar';
import { validateCatalog } from './catalog.js';
import { catalogVerification } from './identity.js';

const LIMIT = 5 * 1024 * 1024;
const CATALOG_LIMIT = 32 * 1024 * 1024;

export async function boundedBytes(response, limit = LIMIT) {
  if (!response.ok) { const error = new Error(`请求失败（HTTP ${response.status}）`); error.status=response.status; throw error; }
  const parts = []; let size = 0;
  for await (const part of response.body) {
    size += part.length;
    if (size > limit) throw new Error('响应超过大小限制');
    parts.push(Buffer.from(part));
  }
  return Buffer.concat(parts);
}

export async function fetchJson(fetcher, url) {
  const response = await fetcher(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
  const bytes = await boundedBytes(response);
  try { return { value: JSON.parse(bytes.toString('utf8')), response }; }
  catch { throw new Error('返回内容不是有效 JSON，已保留上一份可用数据'); }
}

export function checkIntegrity(bytes, integrity, shasum, policy = 'if-present') {
  catalogVerification(policy);
  if (policy === 'none') return 'disabled';
  const missing = value => value == null || (typeof value === 'string' && !value.trim());
  // Older npm-compatible registries may expose only the tarball's SHA-1 sum.
  if (missing(integrity)) {
    if (missing(shasum) && policy === 'if-present') return 'unavailable';
    if (typeof shasum !== 'string' || !/^[a-f\d]{40}$/i.test(shasum)) throw new Error('目录 npm 包缺少有效的 integrity 或 shasum，无法校验');
    const actual = createHash('sha1').update(bytes).digest();
    if (!timingSafeEqual(actual, Buffer.from(shasum, 'hex'))) throw new Error('目录 npm 包完整性校验失败');
    return 'shasum';
  }
  if (typeof integrity !== 'string') throw new Error('目录 npm 包完整性校验失败');
  const options = integrity.trim().split(/\s+/).map(token => token.match(/^(sha512|sha384|sha256|sha1)-([A-Za-z0-9+/=]+)$/)).filter(Boolean);
  const strongest = ['sha512', 'sha384', 'sha256', 'sha1'].find(algorithm => options.some(option => option[1] === algorithm));
  // A present integrity field must verify; never fall back after a mismatch.
  if (!options.filter(option => option[1] === strongest).some(([, algorithm, digest]) => {
    const expected = Buffer.from(digest, 'base64');
    const actual = createHash(algorithm).update(bytes).digest();
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  })) throw new Error('目录 npm 包完整性校验失败');
  return 'integrity';
}

/** Read only the data entry from the archive; never extract paths or execute scripts. */
export function readCatalogTarball(bytes) {
  return new Promise((resolve, reject) => {
    let result; let found = 0;
    const parser = new Parser({ strict: true, onReadEntry(entry) {
      if (entry.path !== 'package/plugins.json' || entry.type !== 'File') { entry.resume(); return; }
      if (++found > 1 || entry.size > CATALOG_LIMIT) { reject(new Error('目录包 plugins.json 重复或过大')); entry.resume(); return; }
      const chunks = []; let size = 0;
      entry.on('data', chunk => { size += chunk.length; if (size > CATALOG_LIMIT) reject(new Error('目录过大')); else chunks.push(chunk); });
      entry.on('end', () => { result = Buffer.concat(chunks).toString('utf8'); });
    } });
    parser.on('error', reject);
    parser.on('end', () => {
      if (found !== 1 || result === undefined) { reject(new Error('目录包缺少 plugins.json')); return; }
      try { resolve(validateCatalog(JSON.parse(result))); } catch (error) { reject(error instanceof SyntaxError ? new Error('返回内容不是有效 JSON，已保留上一份可用数据') : error); }
    });
    parser.end(bytes);
  });
}

export async function loadCatalogSource(source, registry, fetcher, policy = 'if-present') {
  catalogVerification(policy);
  if (source.kind !== 'npm') throw new Error('目录来源必须是 npm 数据包');
  const { value: metadata } = await fetchJson(fetcher, registry + encodeURIComponent(source.packageName));
  const version = metadata['dist-tags']?.latest;
  const dist = metadata.versions?.[version]?.dist;
  if (!dist?.tarball) throw new Error('目录 npm 包没有可下载的 latest 版本');
  // A catalog must stay on its configured registry; no public fallback or credentials forwarding.
  const url = new URL(dist.tarball);
  if (url.origin !== new URL(registry).origin || url.username || url.password) throw new Error('目录 tarball 地址不属于配置的仓库');
  const response = await fetcher(url, { signal: AbortSignal.timeout(15000), redirect: 'error' });
  const bytes = await boundedBytes(response, CATALOG_LIMIT);
  const method = checkIntegrity(bytes, dist.integrity, dist.shasum, policy);
  return { catalog: await readCatalogTarball(bytes), version, source: source.packageName, verification: { policy, method } };
}
