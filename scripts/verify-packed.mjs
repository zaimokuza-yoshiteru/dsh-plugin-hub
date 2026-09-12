import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, writeFile, readFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
const root = process.cwd();
const npmCache = process.env.npm_config_cache || (existsSync('.local/npm-cache/_cacache') ? join(root, '.local/npm-cache') : spawnSync('npm', ['config', 'get', 'cache'], { encoding: 'utf8', shell: process.platform === 'win32' }).stdout.trim());
await mkdir('.local/verify', { recursive: true });
const temp = await mkdtemp(resolve('.local/verify/run-'));
const manifests = JSON.parse(await readFile('.local/dist/manifest.json', 'utf8'));
const fixture = { name: 'packed-check', private: true, type: 'module', dependencies: Object.fromEntries(manifests.map(p => [p.name, 'file:' + resolve('.local/dist', p.filename)])) };
await writeFile(join(temp, 'package.json'), JSON.stringify(fixture));
// npm ci caches tarballs, but need not cache registry metadata. Reuse its exact
// dependency graph so this offline consumer never needs a registry resolution.
const projectLock = JSON.parse(await readFile('package-lock.json', 'utf8'));
const packages = Object.fromEntries(Object.entries(projectLock.packages).filter(([path, value]) => path.startsWith('node_modules/') && !value.link));
packages[''] = fixture;
for (const entry of manifests) {
  const manifest = JSON.parse(await readFile('package.json', 'utf8'));
  packages['node_modules/' + entry.name] = {
    version: entry.version, resolved: fixture.dependencies[entry.name], integrity: entry.integrity,
    ...Object.fromEntries(['dependencies', 'optionalDependencies', 'peerDependencies', 'peerDependenciesMeta', 'engines', 'bin', 'os', 'cpu'].filter(key => manifest[key]).map(key => [key, manifest[key]])),
  };
}
await writeFile(join(temp, 'package-lock.json'), JSON.stringify({ name: fixture.name, lockfileVersion: 3, requires: true, packages }));
function npm(args, cwd = temp) {
  const r = spawnSync('npm', args, { cwd, encoding: 'utf8', shell: process.platform === 'win32', env: { ...process.env, npm_config_cache: npmCache } });
  if (r.status !== 0) throw new Error(r.stdout + '\n' + r.stderr);
  return r.stdout;
}
npm(['ci', '--offline', '--ignore-scripts', '--no-audit', '--no-fund']);
assert.equal(manifests.length, 1);
assert.equal(manifests[0].name, '@zaimokuza/dsh-plugin-hub');
const installed = join(temp, 'node_modules/@zaimokuza/dsh-plugin-hub');
const runtime = await import(pathToFileURL(join(installed, 'src/index.js')));
assert.equal(typeof runtime.apply, 'function');
const manifest = JSON.parse(await readFile(join(installed, 'package.json'), 'utf8'));
assert.deepEqual(Object.keys(manifest.dependencies).sort(), ['@modelcontextprotocol/sdk', 'yaml']);
const client = await readFile(join(installed, 'lib/client.js'), 'utf8');
assert(client.includes('SKILL.md'));
assert(!client.includes('create-dsh-plugin-hub'));
assert(!client.includes('sourceMappingURL='));
assert(!manifests[0].files.some(file => file.startsWith('src/client/')));
console.log('Verified the single Hub tarball offline, including runtime dependencies and browser bundle.');
