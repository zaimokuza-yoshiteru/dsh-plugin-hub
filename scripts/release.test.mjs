import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { releasePlan, getManifest } from './release.mjs';

const bytes = Buffer.from('verified artifact');
const integrity = 'sha512-' + createHash('sha512').update(bytes).digest('base64');
const catalog = { folder: 'catalog', name: '@zaimokuza/catalog', version: '0.1.0', filename: 'catalog.tgz', integrity, dependencies: {} };
const market = { ...catalog, folder: 'marketplace', name: '@zaimokuza/market', filename: 'market.tgz', dependencies: { '@zaimokuza/catalog': '0.1.0' } };
const io = { readTarball: async () => bytes, getManifest: async () => null };

test('post-publish verification bypasses cached preflight 404s without hiding registry errors', async () => {
  const requests = [];
  const fetcher = async (url, options) => {
    requests.push({ url: String(url), options });
    return requests.length === 1 ? new Response(null, { status: 404 }) : Response.json({ dist: { integrity } });
  };
  assert.equal(await getManifest(catalog.name, catalog.version, fetcher), null);
  assert.equal((await getManifest(catalog.name, catalog.version, fetcher)).dist.integrity, integrity);
  assert.notEqual(requests[0].url, requests[1].url);
  assert.equal(new URL(requests[0].url).pathname, '/%40zaimokuza%2Fcatalog/0.1.0');
  assert.equal(requests[1].options.headers['cache-control'], 'no-cache');
  await assert.rejects(getManifest(catalog.name, catalog.version, async () => new Response(null, { status: 503 })), /HTTP 503/);
});

test('release plan preserves dependency order and requires omitted dependencies to exist', async () => {
  assert.deepEqual((await releasePlan([catalog, market], 'all', io)).map(p => p.name), [catalog.name, market.name]);
  await assert.rejects(releasePlan([catalog, market], 'marketplace', io), /Publish dependency first/);
  await assert.rejects(releasePlan([market, catalog], 'all', io), /Publish dependency first/);
  assert.equal((await releasePlan([catalog, market], 'marketplace', { ...io, getManifest: async name => name === catalog.name ? {} : null })).length, 1);
});

test('release plan skips identical published artifacts and rejects conflicting or modified artifacts', async () => {
  const published = { ...io, getManifest: async () => ({ dist: { integrity } }) };
  assert.equal((await releasePlan([catalog], 'all', published))[0].published, true);
  await assert.rejects(releasePlan([catalog], 'all', { ...io, getManifest: async () => ({ dist: { integrity: 'different' } }) }), /different contents/);
  await assert.rejects(releasePlan([catalog], 'all', { ...io, readTarball: async () => Buffer.from('modified') }), /integrity mismatch/);
});

test('release plan rejects invalid selections and artifact paths', async () => {
  await assert.rejects(releasePlan([catalog], 'unknown', io), /Unknown release package/);
  await assert.rejects(releasePlan([], 'all', io), /No release packages/);
  await assert.rejects(releasePlan([{ ...catalog, filename: '../other.tgz' }], 'all', io), /Invalid release manifest/);
});
