import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { atomicWrite } from './profile-files.js';
const bundles = ['@deepseek-ai/dsh-experimental-agent-team-profile', '@deepseek-ai/dsh-experimental-agent-team-web-profile'];
export class Experiments {
  constructor(environment) { this.environment = environment; this.file = join(environment.profileDir, 'package.json'); this.initial = null; this.busy = false; }
  async snapshot() {
    const manifest = JSON.parse(await readFile(this.file, 'utf8'));
    const configuredBundles = manifest.dsh?.profile?.bundles;
    const desktopSetting = manifest.dsh?.desktop?.agentTeams;
    const enabled = this.environment.installation === 'desktop'
      ? (typeof desktopSetting === 'boolean' ? desktopSetting : null)
      : (Array.isArray(configuredBundles) ? bundles.every(name => configuredBundles.includes(name)) : null);
    this.initial ??= enabled;
    const resolver = createRequire(this.file);
    const installed = bundles.every(name => { try { resolver.resolve(name + '/package.json'); return true; } catch { return false; } });
    return [{ id: 'agent-teams', name: 'Agent Teams', description: '实验性多 Agent 协作工具与团队面板。切换后需重启 DSH，会话数据保留。', installed, enabled, pendingRestart: this.initial !== enabled, canToggle: this.environment.installation === 'cli' && installed, canInstall: this.environment.installation === 'cli', busy: this.busy }];
  }
  async mutate(data) {
    if (data.profile !== this.environment.profileDir || data.id !== 'agent-teams') throw new Error('实例或功能已变化，请刷新');
    if (this.busy) throw new Error('实验性功能正在更新');
    if (this.environment.installation !== 'cli') throw new Error('请通过 Desktop 原生插件管理窗口切换 Agent Teams');
    this.busy = true;
    try {
      if (data.action === 'install') {
        for (const name of bundles) await new Promise((resolve, reject) => {
          const child = spawn(process.execPath, [this.environment.cli, 'plugin', '--profile', this.environment.profile, 'add', `${name}@${this.environment.host.dsh}`, '--save-exact'], { cwd: this.environment.profileDir, env: { ...process.env, DSH_HOME: this.environment.home }, stdio: 'ignore', windowsHide: true, shell: false });
          this.child = child;
          const timer = setTimeout(() => { child.kill(); reject(new Error('安装超时，请检查 DSH 插件管理状态')); }, 180000);
          child.once('error', error => { clearTimeout(timer); reject(error); });
          child.once('exit', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error('原生 DSH 安装失败，请确认此 DSH 版本提供 Agent Teams 包')); });
        });
      } else {
        if (typeof data.enabled !== 'boolean') throw new Error('无效的开关值');
        if (!(await this.snapshot())[0].installed) throw new Error('请先安装 Agent Teams');
        const manifest = JSON.parse(await readFile(this.file, 'utf8'));
        const current = manifest.dsh?.profile?.bundles;
        if (!Array.isArray(current)) throw new Error('当前 profile 未提供原生 bundle 列表');
        manifest.dsh.profile.bundles = data.enabled ? [...current.filter(name => !bundles.includes(name)), ...bundles] : current.filter(name => !bundles.includes(name));
        await atomicWrite(this.file, JSON.stringify(manifest, null, 2) + '\n');
      }
      return await this.snapshot();
    } finally { this.busy = false; this.child = null; }
  }
  close() { this.child?.kill(); }
}
