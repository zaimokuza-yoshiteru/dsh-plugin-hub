import { MockAgent, fetch } from 'undici';
import { mkdtemp, writeFile, readFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { c } from 'tar';

export const DEMO_CATALOG_PACKAGE = '@zaimokuza/dsh-plugin-hub-catalog';
export const DEMO_REGISTRY = 'https://nexus.example.example.invalid/repository/npm-group/';

const entries = [
  ['@example/dsh-knowledge-search', '知识库搜索', '在对话中查找团队知识、操作手册与内部文档，让答案附带可追溯的来源。', 'Knowledge Platform', 'internal', ['knowledge', 'integration']],
  ['@example/dsh-bitbucket-review', 'Bitbucket 代码审阅', '读取 Pull Request 的变更与讨论，帮助整理审阅清单和代码上下文。', 'Developer Experience', 'internal', ['developer-tools', 'integration']],
  ['@example/dsh-release-notes', '发布说明助手', '将提交和工单整理成团队发布说明。最新版本正在等待 48 小时窗口结束。', 'Engineering Enablement', 'internal', ['productivity', 'developer-tools']],
  ['@example/dsh-workflow-kit', '团队工作流', '把常用开发步骤组织成可复用工作流。此示例用于展示宿主版本不匹配。', 'Platform Engineering', 'internal', ['productivity']],
  ['@example/dsh-query-assistant', '数据查询助手', '连接团队数据工具。维护者尚未补充 DSH 兼容声明，暂不推荐安装。', 'Data Enablement', 'internal', ['integration']],
  ['@zaimokuza/dsh-acp-adapter', 'Devin · ACP 接入', '从 DSH 连接已有的 Devin Agent，沿用外部 Agent 的登录、模型与工具。', 'Agent Platform', 'community', ['agent', 'integration']],
  ['dsh-markdown-tools', 'Markdown 工具箱', '轻量的表格、目录和文本整理工具，让日常文档处理更顺手。', 'Community', 'community', ['productivity', 'knowledge']],
  ['@example/dsh-service-catalog', '服务目录', '查找团队服务与负责人。此示例模拟单个 npm 包查询失败，其它插件不受影响。', 'Service Platform', 'internal', ['integration']],
];

const english = {
  '@example/dsh-knowledge-search': ['Knowledge search', 'Find team knowledge, runbooks and internal documents with traceable sources.'],
  '@example/dsh-bitbucket-review': ['Bitbucket code review', 'Read pull request changes and discussions to prepare review checklists and code context.'],
  '@example/dsh-release-notes': ['Release notes', 'Turn commits and tickets into release notes. Recent versions are still within the 48-hour window.'],
  '@example/dsh-workflow-kit': ['Team workflows', 'Reuse common development workflows. This example demonstrates a host version mismatch.'],
  '@example/dsh-query-assistant': ['Data query assistant', 'Connect team data tools. No DSH compatibility has been declared, so installation is not recommended yet.'],
  '@zaimokuza/dsh-acp-adapter': ['Devin · ACP access', 'Connect an existing Devin Agent with its own authentication, models and tools.'],
  'dsh-markdown-tools': ['Markdown toolkit', 'Lightweight tables, contents and text utilities for everyday documentation.'],
  '@example/dsh-service-catalog': ['Service catalog', 'Find services and owners. This example simulates one failed npm lookup without affecting other plugins.'],
  '@example/dsh-api-explorer': ['API explorer', 'A newly registered plugin appears after a catalog refresh, without restarting DSH.'],
};

function plugin(row) {
  const [packageName, displayName, description, owner, origin, tags] = row;
  const result = { packageName, displayName, description, owner, origin, tags, locales: { en: { displayName: english[packageName][0], description: english[packageName][1] } }, troubleshootingUrl: `https://confluence.example.example.invalid/display/DSH/${encodeURIComponent(packageName)}` };
  // Cover both links, either link, and no links in the same preview catalog.
  if (!packageName.includes('release-notes') && !packageName.includes('service-catalog')) result.documentationUrl = `https://confluence.example.example.invalid/display/DSH/intro-${encodeURIComponent(packageName)}`;
  if (packageName.includes('query-assistant') || packageName.includes('service-catalog')) delete result.troubleshootingUrl;
  return result;
}

/** Per-market dispatcher intercepts only the demo transport, never other DSH requests. */
export async function createDemoTransport(hostVersion, clock = Date.now) {
  const agent = new MockAgent();
  agent.disableNetConnect();
  const state = { scenario: 'normal', requests: [] };
  const base = entries.map(plugin);
  const extra = plugin(['@example/dsh-api-explorer', 'API 探索器', '新登记的团队插件：刷新目录后即时出现，无需重启 DSH。', 'API Platform', 'internal', ['developer-tools', 'integration']]);
  const archives = {};
  const folder = await mkdtemp(join(tmpdir(), 'example-catalog-fixture-'));
  try {
    await mkdir(join(folder, 'package'));
    for (const [scenario, plugins] of [['normal', base], ['updated', [...base, extra]], ['broken', base]]) {
      await writeFile(join(folder, 'package/plugins.json'), scenario === 'broken' ? '{"schemaVersion":1,"plugins":[' : JSON.stringify({ schemaVersion: 1, plugins }));
      await writeFile(join(folder, 'package/package.json'), JSON.stringify({ name: DEMO_CATALOG_PACKAGE, version: scenario === 'updated' ? '1.1.0' : '1.0.0' }));
      await c({ gzip: true, cwd: folder, file: join(folder, 'catalog.tgz') }, ['package']);
      archives[scenario] = await readFile(join(folder, 'catalog.tgz'));
    }
  } finally { await rm(folder, { recursive: true, force: true }); }
  const metadata = name => {
    const releases = {};
    const time = {};
    const add = (version, hours, range = hostVersion) => {
      releases[version] = { name, version, engines: { node: '>=22.19.0', ...(range === null ? {} : { dsh: range }) } };
      time[version] = new Date(clock() - hours * 3600000).toISOString();
    };
    if (name.includes('release-notes')) { add('1.2.0', 12); add('1.1.0', 24); }
    else if (name.includes('workflow-kit')) { add('2.0.0', 180, '>=0.2.0'); add('1.9.0', 280, '>=0.2.0'); }
    else if (name.includes('query-assistant')) { add('0.3.0', 96, null); }
    else if (name.includes('knowledge-search')) { add('1.5.0', 8); add('1.4.2', 120); add('1.4.1', 360); }
    else if (name.includes('acp-adapter')) { add('0.1.2-rc.1.1', 240); }
    else { add('1.2.0', 168); add('1.1.0', 500); }
    return { name, 'dist-tags': { latest: Object.keys(releases)[0] }, versions: releases, time };
  };
  const registry = new URL(DEMO_REGISTRY);
  agent.get(registry.origin).intercept({ path: path => path.startsWith(registry.pathname), method: 'GET' }).reply(options => {
    const name = decodeURIComponent(options.path.slice(registry.pathname.length));
    if (name === DEMO_CATALOG_PACKAGE) {
      if (state.scenario === 'offline') return { statusCode: 503, data: 'Catalog package unavailable' };
      const version = state.scenario === 'updated' ? '1.1.0' : state.scenario === 'broken' ? '1.0.1' : '1.0.0';
      const bytes = archives[state.scenario];
      const tarball = `${DEMO_REGISTRY}${DEMO_CATALOG_PACKAGE}/-/${state.scenario}.tgz`;
      return { statusCode: 200, data: JSON.stringify({ name, 'dist-tags': { latest: version }, versions: { [version]: { dist: { tarball, integrity: 'sha512-' + createHash('sha512').update(bytes).digest('base64') } } } }), responseOptions: { headers: { 'content-type': 'application/json' } } };
    }
    if (name.startsWith(DEMO_CATALOG_PACKAGE + '/-/')) {
      const scenario = name.split('/').pop().replace('.tgz', '');
      return archives[scenario] ? { statusCode: 200, data: archives[scenario], responseOptions: { headers: { 'content-type': 'application/octet-stream' } } } : { statusCode: 404, data: 'Not found' };
    }

    if (name.includes('service-catalog')) return { statusCode: 502, data: '模拟 Nexus 上游暂不可用' };
    if (name !== '@example/dsh-team-handbook' && ![...base, extra].some(p => p.packageName === name)) return { statusCode: 404, data: 'Package not found' };
    return { statusCode: 200, data: JSON.stringify(metadata(name)), responseOptions: { headers: { 'content-type': 'application/json' } } };
  }).persist();
  return {
    state,
    async fetch(url, options = {}) {
      const record = { url: String(url), time: new Date().toISOString(), status: null, intercepted: true };
      state.requests.unshift(record); state.requests.length = Math.min(40, state.requests.length);
      const response = await fetch(url, { ...options, dispatcher: agent });
      record.status = response.status;
      return response;
    },
    close: () => agent.close(),
  };
}
