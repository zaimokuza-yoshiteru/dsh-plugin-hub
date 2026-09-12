import { readFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const registry = 'https://registry.npmjs.org/';
const integrity = bytes => 'sha512-' + createHash('sha512').update(bytes).digest('base64');

export async function releasePlan(entries, { readTarball, getManifest }) {
  if (!Array.isArray(entries) || entries.length !== 1) throw new Error('Expected one Hub release artifact');
  const [entry] = entries;
  if (entry.name !== '@zaimokuza/dsh-plugin-hub' || !/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(entry.version) || !/^[\w.-]+\.tgz$/.test(entry.filename)) throw new Error('Invalid release manifest');
  if (integrity(await readTarball(entry.filename)) !== entry.integrity) throw new Error(`Tarball integrity mismatch: ${entry.name}`);
  const existing = await getManifest(entry.name, entry.version);
  if (existing && existing.dist?.integrity !== entry.integrity) throw new Error(`${entry.name}@${entry.version} already exists with different contents; bump its version.`);
  return [{ ...entry, published: Boolean(existing) }];
}

export async function getManifest(name, version, fetcher = fetch) {
  // Preflight 404s can be cached beyond a successful publish. Each verification
  // must query fresh metadata instead of replaying that cached negative result.
  const url = new URL(`${registry}${encodeURIComponent(name)}/${encodeURIComponent(version)}`);
  url.searchParams.set('verify', randomUUID());
  const response = await fetcher(url, { signal: AbortSignal.timeout(20000), headers: { 'cache-control': 'no-cache' } });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Registry check failed for ${name}: HTTP ${response.status}`);
  return response.json();
}

export async function waitForPublished(entry, { lookup = getManifest, pause = ms => new Promise(resolve => setTimeout(resolve, ms)), attempts = 60 } = {}) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const published = await lookup(entry.name, entry.version);
    if (published) {
      if (published.dist?.integrity !== entry.integrity) throw new Error(`Published integrity mismatch: ${entry.name}`);
      return;
    }
    if (attempt + 1 < attempts) await pause(5000);
  }
  throw new Error(`Published version is not visible yet: ${entry.name}@${entry.version}; rerun after registry propagation.`);
}

async function main() {
  const publish = process.argv.includes('--publish');
  if (publish && (process.env.GITHUB_ACTIONS !== 'true' || process.env.GITHUB_REPOSITORY !== 'zaimokuza-yoshiteru/dsh-plugin-hub' || process.env.GITHUB_REF !== 'refs/heads/main')) {
    throw new Error('Publish through the main-branch GitHub workflow.');
  }
  const dir = resolve('.local/dist');
  const entries = JSON.parse(await readFile(resolve(dir, 'manifest.json'), 'utf8'));
  const plan = await releasePlan(entries, {
    readTarball: filename => readFile(resolve(dir, filename)), getManifest,
  });
  for (const entry of plan) console.log(`${entry.published ? 'Already published' : 'Publish'}: ${entry.name}@${entry.version}`);
  if (!publish) { console.log('Verification only. No packages published.'); return; }
  for (const entry of plan.filter(entry => !entry.published)) {
    const result = spawnSync('npm', ['publish', resolve(dir, entry.filename), '--access', 'public', '--tag', 'latest', `--registry=${registry}`, '--provenance'], { stdio: 'inherit' });
    if (result.status !== 0) throw new Error(`Publishing failed: ${entry.name} (${result.status ?? result.error})`);
    // npm propagation can take minutes even after a successful publish.
    console.log(`Verifying registry visibility: ${entry.name}@${entry.version}`);
    await waitForPublished(entry);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
