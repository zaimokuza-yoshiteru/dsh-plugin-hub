import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, writeFile, readFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
const root = process.cwd();
const npmCache = process.env.npm_config_cache || (existsSync('.local/npm-cache/_cacache') ? join(root, '.local/npm-cache') : spawnSync('npm', ['config', 'get', 'cache'], { encoding: 'utf8' }).stdout.trim());
await mkdir('.local/verify', { recursive: true });
const temp = await mkdtemp(resolve('.local/verify/run-'));
const manifests = JSON.parse(await readFile('.local/dist/manifest.json', 'utf8'));
const fixture = { name: 'packed-check', private: true, type: 'module', dependencies: Object.fromEntries(manifests.map(p => [p.name, 'file:' + resolve('.local/dist', p.filename)])) };
await writeFile(join(temp, 'package.json'), JSON.stringify(fixture));
// npm ci caches tarballs, but need not cache registry metadata. Reuse its exact
// dependency graph so this offline consumer never needs a registry resolution.
const workspaceLock = JSON.parse(await readFile('package-lock.json', 'utf8'));
const packages = Object.fromEntries(Object.entries(workspaceLock.packages).filter(([path, value]) => path.startsWith('node_modules/') && !value.link));
packages[''] = fixture;
for (const entry of manifests) {
  const manifest = JSON.parse(await readFile(`packages/${entry.folder}/package.json`, 'utf8'));
  const prefix = `packages/${entry.folder}/`;
  for (const [path, dependency] of Object.entries(workspaceLock.packages)) {
    if (path.startsWith(prefix + 'node_modules/') && !dependency.link) {
      packages[`node_modules/${entry.name}/${path.slice(prefix.length)}`] = dependency;
    }
  }
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
const cli = join(temp, 'node_modules/@zaimokuza/create-dsh-plugin-hub/lib/bin.js');
for (const kind of ['market', 'source']) {
  const directory = join(temp, kind);
  const args = [cli, 'create-' + kind, directory, '--name', '@company/' + kind, '--market-id', 'enterprise', '--title', 'Team', '--datasource', 'npm:@company/catalog', ...(kind === 'market' ? [] : ['--source-id', 'team'])];
  const generated = spawnSync(process.execPath, args, { cwd: temp, encoding: 'utf8' });
  assert.equal(generated.status, 0, generated.stderr);
  const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
  assert.equal(manifest.engines.dsh, undefined);
  assert.equal(manifest.publishConfig, undefined);
  assert.equal(JSON.parse(await readFile(join(directory, 'hub.config.json'), 'utf8')).registry, undefined);
  assert.equal(manifest.dshPluginHub.hostCompatibility, 'capability-based');
  assert.deepEqual(manifest.dshPluginHub.testedDshVersions, ['0.1.2-rc.1']);
  npm(['run', 'build'], directory);
  npm(['pack', '--json'], directory);
  const entry = await import(pathToFileURL(join(directory, 'lib/index.js')));
  assert.equal(entry.name, '@company/' + kind);
  if (kind === 'source') {
    let descriptor;
    entry.apply({ dshPluginHub_enterprise: { apiVersion: 1, registerSource: source => { descriptor = source; return () => {}; } }, effect: fn => fn() });
    assert.equal(descriptor.packageName, '@company/catalog');
    assert.equal(descriptor.id, 'team');
  }
}
const catalog = JSON.parse(await readFile(join(temp, 'node_modules/@zaimokuza/dsh-plugin-hub-catalog-demo/plugins.json'), 'utf8'));
assert(catalog.plugins.some(p => p.packageName === '@zaimokuza/dsh-plugin-hub-source-demo'));
const child = await import(pathToFileURL(join(temp, 'node_modules/@zaimokuza/dsh-plugin-hub-source-demo/src/index.js')));
let descriptor;
child.apply({ dshPluginHub_hub: { apiVersion: 1, registerSource: value => { descriptor = value; return () => {}; } }, effect: fn => fn() });
assert.equal(child.name, '@zaimokuza/dsh-plugin-hub-source-demo');
assert.equal(descriptor.packageName, '@zaimokuza/dsh-plugin-hub-source-catalog-demo');
assert.equal(descriptor.id, 'zaimokuza');
console.log('Verified all five tarballs offline; generated market/source builds; source package is discoverable and registers the correct separate catalog.');
