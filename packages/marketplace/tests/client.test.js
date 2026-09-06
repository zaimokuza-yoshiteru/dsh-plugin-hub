import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from '../src/client/api.js';
import { words, diagnostic, localizePlugin } from '../src/client/locale.js';
import { validateCatalog } from '../src/catalog.js';
import { demoHelp } from './fixtures/help.js';

const translate = language => (key, values = {}) => (words[language][key] ?? key).replace(/\{(\w+)\}/g, (_, name) => String(values[name] ?? `{${name}}`));
const sample = { packageName: '@team/search', displayName: '搜索', description: '说明', owner: 'Docs', origin: 'internal', tags: ['knowledge'], troubleshootingUrl: 'https://help.example.test/search', locales: { en: { displayName: 'Search', description: 'Find documents', packageName: 'cannot-change-package' } } };

test('connection loss has an actionable message and the next request can recover', async () => {
  let online = false;
  const fetcher = async () => { if (!online) throw new TypeError('Failed to fetch'); return Response.json({ demo: true }); };
  await assert.rejects(request('state', undefined, { fetcher }), /连接已断开/);
  online = true;
  assert.deepEqual(await request('state', undefined, { fetcher }), { demo: true });
});
test('authentication, invalid responses, timeouts and cancelled requests stay distinct', async () => {
  await assert.rejects(request('state', undefined, { fetcher: async () => new Response('login', { status: 401 }) }), /请先登录/);
  await assert.rejects(request('state', undefined, { fetcher: async () => new Response('<html>') }), /无效响应/);
  await assert.rejects(request('state', undefined, { fetcher: async () => { throw new DOMException('timed out', 'TimeoutError'); } }), /请求超时/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(request('state', undefined, { signal: controller.signal, fetcher: async () => { throw controller.signal.reason; } }), error => error.name === 'AbortError');
});
test('English diagnostics translate compatibility, age and catalog errors without hiding external diagnostics', () => {
  const t = translate('en');
  assert.equal(diagnostic('要求 DSH >=0.2.0，当前为 0.1.3-alpha.1', t, 'en'), 'Requires DSH >=0.2.0; current version is 0.1.3-alpha.1');
  assert.equal(diagnostic('发布未满 48 小时', t, 'en'), 'Published less than 48 hours ago');
  assert.equal(diagnostic('请求失败（HTTP 502）', t, 'en'), 'Request failed (HTTP 502)');
  assert.match(diagnostic('返回内容不是有效 JSON，已保留上一份可用数据', t, 'en'), /Invalid JSON/);
  assert.equal(diagnostic('目录第 2 条：npm 包名重复', t, 'en'), 'Catalog entry 2: Duplicate npm package name');
  assert.equal(diagnostic('目录第 1 条：documentationUrl 必须是无凭据的 HTTPS 链接', t, 'en'), 'Catalog entry 1: documentationUrl must be an HTTPS URL without credentials');
  assert.equal(diagnostic('npm ERR! E403 company policy', t, 'en'), 'npm ERR! E403 company policy');
});
test('localized catalog text is validated, cannot change identity, and falls back to original copy', () => {
  const plugin = validateCatalog({ schemaVersion: 1, plugins: [sample] }).plugins[0];
  assert.equal(localizePlugin(plugin, 'en-US').displayName, 'Search');
  assert.equal(localizePlugin(plugin, 'en').packageName, '@team/search');
  assert.equal(localizePlugin(plugin, 'zh').displayName, '搜索');
  assert.throws(() => validateCatalog({ schemaVersion: 1, plugins: [{ ...sample, locales: { en: { displayName: 42 } } }] }), /locales/);
  assert.match(demoHelp(plugin, 'en'), /Local demo help/);
  assert.match(demoHelp(plugin, 'zh'), /本地演示帮助页/);
});

test('Nexus transport uses scoped npm credentials for metadata and tarball without cross-origin or redirect forwarding', async () => {
  const { createRegistryFetch } = await import('../src/registry.js');
  const { default: token } = await import('registry-auth-token');
  const requests = [];
  const registry = 'https://nexus.example.test/repository/npm-group/';
  const npmrc = { '//nexus.example.test/repository/npm-group/:_authToken': 'test-only-token' };
  const read = createRegistryFetch(registry, { authLookup: url => token(url, { recursive: true, npmrc }), fetcher: async (url, options) => { requests.push({ url: url.href, ...options }); return Response.json({}); } });
  await read(registry + 'catalog', { headers: { accept: 'application/json' } });
  await read(registry + 'catalog/-/catalog-1.0.0.tgz');
  assert(requests.every(r => r.headers.get('authorization') === 'Bearer test-only-token' && r.redirect === 'error'));
  assert.equal(requests[0].headers.get('accept'), 'application/json');
  await assert.rejects(read('https://other.example.test/tarball'), /Nexus/);
  assert.equal(requests.length, 2);
});

test('all first-party UI literals and interpolation fields have Chinese and English translations', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('../src/client/index.jsx', import.meta.url), 'utf8');
  const literals = [...source.replace(/\.includes\('[^']*'\)/g, '').matchAll(/'([^'\n]*)'/g)].map(match => match[1]).filter(value => /\p{Script=Han}/u.test(value));
  for (const key of literals) {
    assert(words.zh[key], `Missing Chinese key: ${key}`);
    assert(words.en[key], `Missing English key: ${key}`);
  }
  for (const key of Object.keys(words.zh)) {
    assert(words.en[key], key);
    assert.deepEqual([...words.zh[key].matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort(), [...words.en[key].matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort(), key);
  }
  assert.doesNotMatch(source, /plugin\.stars|★/);
});
