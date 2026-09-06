import { createHash } from 'node:crypto';
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { PACKAGE_NAME, validateCatalog } from './catalog.js';
import { loadCatalogSource } from './source.js';

/** Host-only v1 API. Providers contribute data; registry and installation policy stay market-owned. */
export class CatalogProviders {
  constructor({ cacheDir, registry, fetcher, onChange = () => {}, timeoutMs = 15000 }) {
    Object.assign(this, { cacheDir, registry, fetcher, onChange, timeoutMs });
    this.entries = new Map();
  }
  registerSource(input, { primary = false } = {}) {
    if (!input || typeof input.id !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,79}$/.test(input.id)) throw new Error('Invalid catalog source id');
    if (this.entries.has(input.id)) throw new Error(`Duplicate catalog source id: ${input.id}`);
    if (this.entries.size >= 20) throw new Error('At most 20 catalog sources are supported');
    if (!['npm', 'json'].includes(input.kind)) throw new Error('Catalog source kind must be npm or json');
    if (input.kind === 'npm' && (typeof input.packageName !== 'string' || !PACKAGE_NAME.test(input.packageName) || input.packageName.length > 214)) throw new Error('Invalid catalog package name');
    if (input.kind === 'json' && typeof input.getCatalog !== 'function') throw new Error('JSON source requires getCatalog({ signal })');
    if (input.priority !== undefined && (!Number.isInteger(input.priority) || Math.abs(input.priority) > 1000)) throw new Error('Source priority must be an integer between -1000 and 1000');
    if (input.displayName !== undefined && (typeof input.displayName !== 'string' || input.displayName.length > 80)) throw new Error('Invalid source displayName');
    if (input.cacheVersion !== undefined && (typeof input.cacheVersion !== 'string' || input.cacheVersion.length > 80)) throw new Error('Invalid source cacheVersion');
    const source = Object.freeze({ ...input, displayName: input.displayName || input.id, priority: input.priority ?? 0 });
    const key = JSON.stringify([this.registry, source.id, source.kind, source.packageName, source.cacheVersion ?? '1']);
    const row = { source, primary, key, value: null, error: null, loaded: false, controller: null };
    row.file = join(this.cacheDir, 'sources', createHash('sha256').update(key).digest('hex') + '.json');
    this.entries.set(source.id, row); this.onChange();
    return () => {
      if (this.entries.get(source.id) !== row) return;
      this.entries.delete(source.id); row.controller?.abort(); this.onChange();
    };
  }
  async refresh() {
    // Bounded batches keep a failed or slow provider from exhausting the registry.
    const rows = [...this.entries.values()];
    for (let i = 0; i < rows.length; i += 4) await Promise.all(rows.slice(i, i + 4).map(row => this.refreshOne(row)));
  }
  async refreshOne(row) {
    if (this.entries.get(row.source.id) !== row) return;
    if (!row.loaded) {
      row.loaded = true;
      try {
        const saved = JSON.parse(await readFile(row.file, 'utf8'));
        if (saved.key === row.key) row.value = { ...saved.value, catalog: validateCatalog(saved.value.catalog) };
      } catch { /* No valid cached snapshot; fetch a fresh one. */ }
    }
    const controller = new AbortController(); row.controller = controller;
    let timer;
    try {
      const load = async () => {
        if (row.source.kind === 'npm') return loadCatalogSource(row.source, this.registry, this.fetcher);
        const data = await row.source.getCatalog({ signal: controller.signal });
        if (Buffer.byteLength(JSON.stringify(data)) > 32 * 1024 * 1024) throw new Error('响应超过大小限制');
        return { catalog: validateCatalog(data), source: row.source.id, version: row.source.cacheVersion ?? '1' };
      };
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => { reject(new Error('目录来源读取超时')); controller.abort(); }, this.timeoutMs);
        controller.signal.addEventListener('abort', () => reject(new Error('目录来源读取已取消')), { once: true });
      });
      const next = await Promise.race([load(), timeout]);
      if (this.entries.get(row.source.id) !== row) return;
      const value = { ...next, updatedAt: new Date().toISOString() };
      await mkdir(join(this.cacheDir, 'sources'), { recursive: true });
      await writeFile(row.file + '.tmp', JSON.stringify({ key: row.key, value }));
      await rename(row.file + '.tmp', row.file);
      if (this.entries.get(row.source.id) === row) { row.value = value; row.error = null; }
    } catch (error) { row.error = error.message; }
    finally { clearTimeout(timer); row.controller = null; }
  }
  snapshot() {
    const rows = [...this.entries.values()].sort((a, b) => Number(a.primary) - Number(b.primary) || b.source.priority - a.source.priority || (a.source.id < b.source.id ? -1 : a.source.id > b.source.id ? 1 : 0));
    const plugins = new Map(); const conflicts = [];
    for (const row of rows) for (const plugin of row.value?.catalog.plugins ?? []) {
      if (plugins.has(plugin.packageName)) { plugins.get(plugin.packageName).catalogSourceIds.push(row.source.id); conflicts.push({ packageName: plugin.packageName, selectedSource: plugins.get(plugin.packageName).catalogSource.id, ignoredSource: row.source.id }); continue; }
      plugins.set(plugin.packageName, { ...plugin, catalogSourceIds: [row.source.id], catalogSource: { id: row.source.id, displayName: row.source.displayName } });
    }
    return {
      plugins: [...plugins.values()], conflicts,
      sources: rows.map(({ source, primary, value, error }) => ({ primary, id: source.id, displayName: source.displayName, kind: source.kind, packageName: source.packageName, priority: source.priority, version: value?.version ?? null, updatedAt: value?.updatedAt ?? null, count: value?.catalog.plugins.length ?? 0, error, stale: Boolean(error && value) })),
    };
  }
  close() { for (const row of this.entries.values()) row.controller?.abort(); this.entries.clear(); }
}
