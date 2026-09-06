import { spawn } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { collectHostPeers } from './host-peers.js';
import { releaseAgeArgument } from './release-age.js';

/** All knowledge about the DSH process and its profile lives in this adapter. */
export function dshEnvironment(profile = 'web') {
  if (!/^[a-zA-Z0-9_-]+$/.test(profile)) throw new Error('profile 名称无效');
  const cli = realpathSync(process.argv[1]);
  const manifest = JSON.parse(readFileSync(join(dirname(cli), '..', 'package.json'), 'utf8'));
  if (manifest.name !== '@deepseek-ai/dsh') throw new Error('请通过 DSH CLI 启动此插件');
  const configuredHome = process.env.DSH_HOME?.trim() || join(homedir(), '.dsh');
  const home = configuredHome === '~' ? homedir() : /^~[/\\]/.test(configuredHome) ? join(homedir(), configuredHome.slice(2)) : configuredHome;
  const profileDir = resolve(home, 'profiles', profile);
  const peers = collectHostPeers(join(dirname(cli), '..', 'package.json'));
  return { cli, profileDir, profile, host: { dsh: manifest.version, node: process.versions.node, platform: process.platform, arch: process.arch, peers } };
}

export function createDshInstaller(environment, config) {
  let child;
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
  async function run(args, log) {
    await new Promise((resolve, reject) => {
        child = spawn(process.execPath, args, { cwd: process.cwd(), env: process.env, stdio: ['ignore', 'pipe', 'pipe'], shell: false, windowsHide: true });
        const timer = setTimeout(() => { child.kill('SIGTERM'); reject(new Error('插件操作超时，请检查 profile 后重试')); }, 180000);
        const onData = bytes => log(bytes.toString('utf8').replace(/Bearer\s+\S+/gi, 'Bearer [redacted]').slice(-1500));
        child.stdout.on('data', onData); child.stderr.on('data', onData);
        child.once('error', error => { clearTimeout(timer); reject(error); });
        child.once('exit', code => { clearTimeout(timer); child = null; code === 0 ? resolve() : reject(new Error(`插件命令失败（退出码 ${code}）`)); });
      });
  }
  return {
    installed,
    async install(packageName, version, log) {
      const args = [...process.execArgv, environment.cli, 'plugin', '--profile', environment.profile, 'add', `${packageName}@${version}`, '--save-exact', `--registry=${config.registry}`, releaseAgeArgument(config)];
      log(`安装 ${packageName}@${version}`);
      await run(args, log);
      if ((await installed())[packageName] !== version) throw new Error('安装命令结束，但实际版本不匹配');
      const manifest = JSON.parse(readFileSync(join(environment.profileDir, 'package.json'), 'utf8'));
      if (!manifest.dsh?.profile?.bundles?.includes(packageName)) throw new Error('包已下载，但尚未注册为 DSH bundle');
      log('安装并注册完成，请手动重启 DSH 后验证加载');
    },
    async uninstall(packageName, log) {
      if (!(await installed())[packageName]) throw new Error('该插件尚未安装');
      const args = [...process.execArgv, environment.cli, 'plugin', '--profile', environment.profile, 'remove', packageName];
      log(`卸载 ${packageName}`);
      await run(args, log);
      const manifest = JSON.parse(readFileSync(join(environment.profileDir, 'package.json'), 'utf8'));
      if (manifest.dependencies?.[packageName] || manifest.dsh?.profile?.bundles?.includes(packageName)) throw new Error('卸载命令结束，但插件仍在 profile 中');
      log('卸载并取消注册完成，请手动重启 DSH 结束已加载实例');
    },
    close() { child?.kill('SIGTERM'); },
  };
}
