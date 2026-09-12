import { readFileSync, realpathSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';

/** All knowledge about the DSH process and its profile lives in this adapter. */
export function dshEnvironment(ctx, expectedProfile, runtime = process) {
  // Only the boot root owns the active profile anchor; plugin baseUrl is its package.
  const base = ctx.root?.baseUrl;
  if (typeof base !== 'string' || !base.startsWith('file:')) throw new Error('无法确认当前实例的 profile，已停止管理操作');
  const profileDir = realpathSync(fileURLToPath(base));
  const configuredHome = runtime.env.DSH_HOME?.trim() || join(homedir(), '.dsh');
  const home = resolve(configuredHome === '~' ? homedir() : /^~[/\\]/.test(configuredHome) ? join(homedir(), configuredHome.slice(2)) : configuredHome);
  const profile = basename(profileDir);
  if (expectedProfile !== undefined && expectedProfile !== profile) throw new Error('Hub profile 配置与当前实例不一致');
  let entryManifest, cli;
  try {
    const candidate = realpathSync(runtime.argv[1]);
    const file = join(dirname(candidate), '..', 'package.json');
    if (JSON.parse(readFileSync(file, 'utf8')).name === '@deepseek-ai/dsh') { cli = candidate; entryManifest = file; }
  } catch { /* Desktop workers do not run through the CLI. */ }
  entryManifest ??= createRequire(join(profileDir, 'package.json')).resolve('@deepseek-ai/dsh/package.json');
  const manifest = JSON.parse(readFileSync(entryManifest, 'utf8'));
  let cliProfile = false;
  try { cliProfile = Boolean(cli) && realpathSync(join(home, 'profiles', profile)) === profileDir; } catch { /* Never redirect to another profile. */ }
  return { cli, home, profileDir, profile, installation: cliProfile ? 'cli' : 'desktop',
    host: { dsh: manifest.version, node: runtime.versions.node, platform: runtime.platform, arch: runtime.arch } };
}

export function createDshInventory(environment) {
  const installed = async () => {
    let manifest;
    try { manifest = JSON.parse(readFileSync(join(environment.profileDir, 'package.json'), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return {}; throw error; }
    const result = {};
    for (const name of Object.keys(manifest.dependencies ?? {})) {
      try { result[name] = JSON.parse(readFileSync(join(environment.profileDir, 'node_modules', name, 'package.json'), 'utf8')).version; }
      catch { /* Missing files are not an installed version, even if a manifest entry remains. */ }
    }
    return result;
  };
  return { installed };
}
