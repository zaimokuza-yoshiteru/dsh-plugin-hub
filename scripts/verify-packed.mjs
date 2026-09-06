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
const packages = manifests.map(p => resolve('.local/dist', p.filename));
await writeFile(join(temp, 'package.json'), JSON.stringify({ name: 'packed-check', private: true, type: 'module' }));
function npm(args, cwd = temp) {
  const r = spawnSync('npm', args, { cwd, encoding: 'utf8', shell: process.platform === 'win32', env: { ...process.env, npm_config_cache: npmCache } });
  if (r.status !== 0) throw new Error(r.stdout + '\n' + r.stderr);
  return r.stdout;
}
npm(['install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', ...packages]);
const cli = join(temp, 'node_modules/@zaimokuza/create-dsh-plugin-hub/lib/bin.js');
for (const kind of ['market', 'source']) {
  const directory = join(temp, kind);
  const args = [cli, 'create-' + kind, directory, '--name', '@company/' + kind, '--market-id', 'enterprise', '--title', 'Team', '--datasource', 'npm:@company/catalog', ...(kind === 'market' ? ['--registry', 'https://nexus.example/repository/npm-group/'] : ['--source-id', 'team'])];
  const generated = spawnSync(process.execPath, args, { cwd: temp, encoding: 'utf8' });
  assert.equal(generated.status, 0, generated.stderr);
  const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
  assert.equal(manifest.engines.dsh, undefined);
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
