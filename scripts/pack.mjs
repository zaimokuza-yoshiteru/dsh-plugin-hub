import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { packageFolders } from './packages.mjs';
const target = resolve('.local/dist');
await mkdir(target, { recursive: true });
const entries = [];
for (const folder of packageFolders) {
  const result = spawnSync('npm', ['pack', '--workspace', './packages/' + folder, '--pack-destination', target, '--json'], { env: { ...process.env, npm_config_cache: resolve('.local/npm-cache') }, encoding: 'utf8', shell: process.platform === 'win32' });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  const [packed] = JSON.parse(result.stdout);
  const manifest = JSON.parse(await readFile(`packages/${folder}/package.json`, 'utf8'));
  const forbidden = packed.files.filter(({ path }) => /(^|\/)(?:node_modules|\.local|\.env|\.npmrc|tests|reference|scripts)(\/|$)|\.map$|\.log$|\.tgz$/.test(path));
  // The CLI ships a build template, never repository development scripts.
  if (forbidden.length) throw new Error(`Unexpected packed files in ${manifest.name}: ${forbidden.map(f => f.path)}`);
  entries.push({ folder, name: manifest.name, version: manifest.version, filename: packed.filename, integrity: packed.integrity, dependencies: manifest.dependencies ?? {}, files: packed.files.map(f => f.path) });
  console.log(`${manifest.name}@${manifest.version}: ${packed.filename} (${packed.size} bytes)`);
}
await writeFile(resolve(target, 'manifest.json'), JSON.stringify(entries, null, 2) + '\n');
