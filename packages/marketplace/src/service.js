import { verifyNpmIdentity } from './npm-identity.js';
import { MARKET_PACKAGE } from './identity.js';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { releaseList } from './catalog.js';
import { fetchJson } from './source.js';
import { CatalogProviders } from './providers.js';

async function readSaved(file) {
  try { return JSON.parse(await readFile(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT' || error instanceof SyntaxError) return null; throw error; }
}

export class Marketplace {
  constructor({ config, host, fetcher, installer, demo }) {
    Object.assign(this, { config, host, fetcher, installer, demo });
    this.metadataPending = new Set(); this.metadataWork = Promise.resolve();
    this.metadataCache = new Map(); this.metadataProgress = { running:false, done:0, total:0 };
    this.plugins = []; this.jobs = []; this.catalog = null; this.catalogError = null;
    this.refreshing = null; this.worker = null; this.closed = false; this.persistence = Promise.resolve();
    this.providers = new CatalogProviders({ ...config, fetcher, onChange: () => {
      if (!this.initialized || this.closed) return;
      this.plugins = this.plugins.filter(p => this.providers.entries.has(p.catalogSource.id));
      this.needsRefresh = true; void this.refresh().catch(error => { this.catalogError = error.message; });
    } });
    const configured = config.sources ?? [{ id: 'company', displayName: 'Company catalog', priority: 100, ...config.source }];
    configured.forEach((source, index) => this.providers.registerSource(source, { primary: index === 0 }));
    this.simulatedInstalled = demo ? { '@zaimokuza/dsh-acp-adapter': '0.1.2-rc.1.1', 'dsh-markdown-tools': '1.2.0' } : {};
  }
  async init({ refresh = true } = {}) {
    await mkdir(this.config.cacheDir, { recursive: true });
    const operations = await readSaved(join(this.config.cacheDir, this.demo ? 'demo-jobs.json' : 'jobs.json'));
    if (Array.isArray(operations)) this.jobs = operations.slice(-30).map(job => ['queued', 'installing'].includes(job.status) ? { ...job, status: 'failed', error: '上次进程中断，请重新安装' } : job);
    for (const job of this.jobs) if (this.demo && job.status === 'completed') {
      if (job.action === 'uninstall') delete this.simulatedInstalled[job.packageName];
      else this.simulatedInstalled[job.packageName] = job.version;
    }
    this.initialized = true;
    if (refresh) await this.refresh();
  }
  persistJobs() {
    // Serialize concurrent queue mutations and atomically replace the persisted snapshot.
    const file = join(this.config.cacheDir, this.demo ? 'demo-jobs.json' : 'jobs.json');
    const contents = JSON.stringify(this.jobs, null, 2);
    this.persistence = this.persistence.catch(() => { /* The caller received the earlier write failure; allow a later snapshot to recover. */ }).then(async () => {
      await writeFile(file + '.tmp', contents);
      await rename(file + '.tmp', file);
    });
    return this.persistence;
  }
  async refresh() {
    if (this.refreshing) return this.refreshing;
    this.refreshing = (async () => { do { this.needsRefresh = false; await this.refreshData(); } while (this.needsRefresh && !this.closed); })().finally(() => { this.refreshing = null; });
    return this.refreshing;
  }
  async refreshData() {
    await this.providers.refresh();
    const activeRows = new Map(this.providers.entries);
    const merged = this.providers.snapshot();
    this.catalog = { catalog: { plugins: merged.plugins }, version: merged.sources.map(s => s.version).filter(Boolean).join(' / ') || null, updatedAt: merged.sources.map(s => s.updatedAt).filter(Boolean).sort().at(-1) ?? null, source: merged.sources.map(s => s.packageName ?? s.id).join(', ') };
    this.catalogError = merged.sources.filter(s => s.error).map(s => s.error).join('; ') || null;
    const plugins = merged.plugins.map(plugin => ({ ...plugin, versions: [], recommendedVersion: null, queryError: null, metadataLoading: true }));
    this.plugins = plugins;
    this.metadataProgress = { running:true, done:0, total:plugins.length };
    this.lazyMetadata = plugins.length > 200;
    if(this.lazyMetadata){ await this.loadReleases(plugins.slice(0,40).map(p=>p.packageName)); return; }
    // Keep registry load bounded even when the catalog grows.
    for (let i = 0; !this.closed && i < this.catalog.catalog.plugins.length; i += 6) {
      const batch = await Promise.all(this.catalog.catalog.plugins.slice(i, i + 6).map(async plugin => {
        return this.resolvePlugin(plugin);
      }));
      plugins.splice(i, batch.length, ...batch);
      this.plugins = plugins.filter(p => this.providers.entries.get(p.catalogSource.id) === activeRows.get(p.catalogSource.id));
      this.metadataProgress.done = Math.min(i+batch.length,plugins.length);
    }
    this.metadataProgress.running = false;
    this.plugins = plugins.filter(p => this.providers.entries.get(p.catalogSource.id) === activeRows.get(p.catalogSource.id));
  }
  async resolvePlugin(plugin) {
        try {
          const cached = this.metadataCache.get(plugin.packageName);
          const value = !this.demo && cached && Date.now()-cached.time < 300000 ? cached.value : (await fetchJson(this.fetcher, this.config.registry + encodeURIComponent(plugin.packageName))).value;
          if(!this.demo) { this.metadataCache.set(plugin.packageName,{time:Date.now(),value}); if(this.metadataCache.size>100)this.metadataCache.delete(this.metadataCache.keys().next().value); }
          verifyNpmIdentity(value, plugin);
          const versions = releaseList(value, this.host, Date.now(), this.config.minimumAgeHours, plugin);
          if (!versions.length) throw new Error('仓库没有返回有效的发行版本');
          return { ...plugin, versions, recommendedVersion: versions.find(v => v.canInstall)?.version ?? null, queryError: null };
        } catch (error) { return { ...plugin, versions: [], recommendedVersion: null, queryError: error.status === 404 ? '当前 npm 仓库未找到此包（404）' : error.message }; }
  }
  async loadReleases(names) {
    if(!Array.isArray(names)||names.length>40||names.some(name=>typeof name!=='string'))throw new Error('Invalid release request');
    const wanted=new Set(names);
    const targets=this.plugins.filter(p=>wanted.has(p.packageName)&&p.metadataLoading&&!this.metadataPending.has(p));
    for(const plugin of targets)this.metadataPending.add(plugin);
    if(!targets.length)return this.metadataWork;
    this.metadataWork=this.metadataWork.catch(()=>{}).then(async()=>{
      this.metadataProgress.running=true;
      try {
        for(let i=0;!this.closed&&i<targets.length;i+=6){
          const batch=targets.slice(i,i+6);const values=await Promise.all(batch.map(p=>this.resolvePlugin(p)));
          batch.forEach((target,index)=>{if(this.plugins.includes(target))Object.assign(target,values[index],{metadataLoading:false});});
          this.metadataProgress.done=this.plugins.filter(p=>!p.metadataLoading).length;
        }
      }finally{for(const p of targets)this.metadataPending.delete(p);this.metadataProgress.running=false;}
    });
    return this.metadataWork;
  }
  async snapshot() {
    const installed = this.demo ? this.simulatedInstalled : await this.installer.installed();
    const sourceState = this.providers.snapshot();
    return {
      metadataProgress: this.metadataProgress, lazyMetadata: this.lazyMetadata,
      brand: this.config.brand, marketId: this.config.identity?.id, sources: sourceState.sources, sourceConflicts: sourceState.conflicts,
      marketVersion: '0.1.0', host: this.host, demo: Boolean(this.demo), minimumAgeHours: this.config.minimumAgeHours,
      catalog: { version: this.catalog?.version ?? null, updatedAt: this.catalog?.updatedAt ?? null, source: this.catalog?.source ?? this.config.source?.packageName ?? '', error: this.catalogError, stale: sourceState.sources.some(s => s.stale), count: this.plugins.length },
      plugins: this.plugins.map(plugin => ({ ...plugin, installedVersion: installed[plugin.packageName] ?? null })),
      jobs: this.jobs, pendingRestart: this.jobs.filter(job => job.status === 'completed').length,
      scenario: this.demo?.state.scenario, requests: this.demo?.state.requests ?? [],
    };
  }
  async enqueue(packageName, version, action = 'install') {
    if (!['install', 'uninstall'].includes(action)) throw new Error('无效的插件操作');
    if ([MARKET_PACKAGE, this.config.packageName].includes(packageName)) throw new Error('请通过 DSH CLI 管理市场插件自身');
    if (this.closed) throw new Error('市场正在关闭');
    if (!this.plugins.some(plugin => plugin.packageName === packageName)) throw new Error('插件不在当前目录中');
    const pending = this.jobs.find(job => job.packageName === packageName && ['queued', 'installing'].includes(job.status));
    if (pending) {
      if ((pending.action ?? 'install') !== action) throw new Error('该插件已有其它操作，请等待完成');
      return pending;
    }
    if (action === 'uninstall') {
      const installed = this.demo ? this.simulatedInstalled : await this.installer.installed();
      version = installed[packageName];
      if (!version) throw new Error('该插件尚未安装');
    } else {
      const { value } = await fetchJson(this.fetcher, this.config.registry + encodeURIComponent(packageName));
      const plugin = this.plugins.find(item => item.packageName === packageName);
      verifyNpmIdentity(value, plugin);
      const release = releaseList(value, this.host, Date.now(), this.config.minimumAgeHours, plugin).find(item => item.version === version);
      if (!release?.canInstall) throw new Error(release?.reasons.join('；') || '该版本不可安装');
    }
    // Recheck after network I/O so simultaneous clicks cannot enqueue duplicate work.
    const raced = this.jobs.find(job => job.packageName === packageName && ['queued', 'installing'].includes(job.status));
    if (raced) {
      if ((raced.action ?? 'install') !== action) throw new Error('该插件已有其它操作，请等待完成');
      return raced;
    }
    if (this.jobs.filter(job => ['queued', 'installing'].includes(job.status)).length >= 20) throw new Error('安装队列已满');
    const job = { id: randomUUID(), packageName, version, action, status: 'queued', demo: Boolean(this.demo), createdAt: new Date().toISOString(), log: [], error: null };
    this.jobs.push(job);
    if (this.jobs.length > 30) this.jobs = this.jobs.filter(j => ['queued', 'installing'].includes(j.status) || this.jobs.indexOf(j) >= this.jobs.length - 20);
    await this.persistJobs();
    if (!this.worker) this.worker = this.drain().finally(() => { this.worker = null; });
    return job;
  }
  async drain() {
    while (!this.closed) {
      const job = this.jobs.find(item => item.status === 'queued');
      if (!job) return;
      job.status = 'installing'; await this.persistJobs();
      try {
        const log = text => { job.log.push(text); job.log = job.log.slice(-12); };
        if (this.demo) {
          log(job.action === 'uninstall' ? '演示：模拟卸载，不修改真实插件' : '演示：模拟下载与安装，不运行 npm/pnpm，也不修改真实插件');
          await new Promise(resolve => setTimeout(resolve, 1400));
          if (job.action === 'uninstall') delete this.simulatedInstalled[job.packageName];
          else this.simulatedInstalled[job.packageName] = job.version;
          log(job.action === 'uninstall' ? '演示卸载完成；正式卸载需手动重启结束已加载实例' : '演示安装完成；正式安装将在手动重启后加载');
        } else if (job.action === 'uninstall') await this.installer.uninstall(job.packageName, log);
        else await this.installer.install(job.packageName, job.version, log);
        job.status = 'completed';
      } catch (error) { job.status = 'failed'; job.error = error.message; }
      await this.persistJobs();
    }
  }
  async setScenario(scenario) {
    if (!this.demo || !['normal', 'broken', 'offline', 'updated'].includes(scenario)) throw new Error('无效的演示场景');
    if (this.refreshing) await this.refreshing;
    this.demo.state.scenario = scenario;
    await this.refresh();
  }
  async resetDemo() {
    if (!this.demo) throw new Error('只在演示模式可用');
    if (this.worker) await this.worker;
    this.jobs = [];
    this.simulatedInstalled = { '@zaimokuza/dsh-acp-adapter': '0.1.2-rc.1.1', 'dsh-markdown-tools': '1.2.0' };
    await this.persistJobs();
  }
  async close() { this.closed = true; this.providers.close(); if (this.refreshing) await this.refreshing; if (this.worker) await this.worker; await this.metadataWork; await this.demo?.close(); }
}
