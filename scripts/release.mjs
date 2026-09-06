import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { packageFolders } from './packages.mjs';

const registry = 'https://registry.npmjs.org/';
const integrity = bytes => 'sha512-' + createHash('sha512').update(bytes).digest('base64');

export async function releasePlan(entries, selection, { readTarball, getManifest }) {
  if (selection !== 'all' && !packageFolders.includes(selection)) throw new Error('Unknown release package');
  const selected = entries.filter(entry => selection === 'all' || entry.folder === selection);
  if (!selected.length) throw new Error('No release packages');
  const plan = [];
  // Validate the complete selection before the first registry write.
  for (const entry of selected) {
    if (!packageFolders.includes(entry.folder) || !/^[\w.-]+\.tgz$/.test(entry.filename)) throw new Error('Invalid release manifest');
    if (integrity(await readTarball(entry.filename)) !== entry.integrity) throw new Error(`Tarball integrity mismatch: ${entry.name}`);
    const existing = await getManifest(entry.name, entry.version);
    if (existing && existing.dist?.integrity !== entry.integrity) throw new Error(`${entry.name}@${entry.version} already exists with different contents; bump its version.`);
    plan.push({ ...entry, published: Boolean(existing) });
  }
  const available = new Set();
  for (const entry of plan) {
    for (const [name, version] of Object.entries(entry.dependencies ?? {}).filter(([name]) => name.startsWith('@zaimokuza/'))) {
      if (!available.has(`${name}@${version}`) && !(await getManifest(name, version))) throw new Error(`Publish dependency first: ${name}@${version}`);
    }
    available.add(`${entry.name}@${entry.version}`);
  }
  return plan;
}

async function getManifest(name, version) {
  const response = await fetch(`${registry}${encodeURIComponent(name)}/${encodeURIComponent(version)}`, { signal: AbortSignal.timeout(20000) });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Registry check failed for ${name}: HTTP ${response.status}`);
  return response.json();
}

async function main() {
  const publish = process.argv.includes('--publish');
  if (publish && (process.env.GITHUB_ACTIONS !== 'true' || process.env.GITHUB_REPOSITORY !== 'zaimokuza-yoshiteru/dsh-plugin-hub' || process.env.GITHUB_REF !== 'refs/heads/main')) {
    throw new Error('Publish through the main-branch GitHub workflow.');
  }
  const dir = resolve('.local/dist');
  const entries = JSON.parse(await readFile(resolve(dir, 'manifest.json'), 'utf8'));
  const plan = await releasePlan(entries, process.env.RELEASE_PACKAGE ?? 'all', {
    readTarball: filename => readFile(resolve(dir, filename)), getManifest,
  });
  for (const entry of plan) console.log(`${entry.published ? 'Already published' : 'Publish'}: ${entry.name}@${entry.version}`);
  if (!publish) { console.log('Verification only. No packages published.'); return; }
  for (const entry of plan.filter(entry => !entry.published)) {
    const result = spawnSync('npm', ['publish', resolve(dir, entry.filename), '--access', 'public', '--tag', 'latest', `--registry=${registry}`, '--provenance'], { stdio: 'inherit' });
    if (result.status !== 0) throw new Error(`Publishing failed: ${entry.name} (${result.status ?? result.error})`);
    // Wait for registry visibility before publishing a dependent package.
    let published;
    for (let attempt = 0; attempt < 12; attempt++) {
      published = await getManifest(entry.name, entry.version);
      if (published) break;
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
    if (published?.dist?.integrity !== entry.integrity) throw new Error(`Published integrity could not be verified: ${entry.name}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
