import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { releasePlan, getManifest, waitForPublished } from './release.mjs';

const bytes = Buffer.from('verified artifact');
const integrity = 'sha512-' + createHash('sha512').update(bytes).digest('base64');
const hub = { name: '@zaimokuza/dsh-plugin-hub', version: '0.2.0', filename: 'hub.tgz', integrity };
const io = { readTarball: async () => bytes, getManifest: async () => null };

test('publication verification tolerates propagation delay but rejects digest mismatches and bounded timeouts', async () => {
  let requests = 0;
  const pauses = [];
  await waitForPublished(hub, { lookup: async () => ++requests < 10 ? null : { dist: { integrity } }, pause: async ms => pauses.push(ms) });
  assert.equal(requests, 10);
  assert.deepEqual(pauses, Array(9).fill(5000));
  await assert.rejects(waitForPublished(hub, { lookup: async () => ({ dist: { integrity: 'different' } }), pause: async () => assert.fail('Do not retry mismatches') }), /integrity mismatch/);
  await assert.rejects(waitForPublished(hub, { lookup: async () => null, pause: async () => {}, attempts: 2 }), /not visible yet/);
});

test('post-publish verification bypasses cached preflight 404s without hiding registry errors', async () => {
  const requests = [];
  const fetcher = async (url, options) => {
    requests.push({ url: String(url), options });
    return requests.length === 1 ? new Response(null, { status: 404 }) : Response.json({ dist: { integrity } });
  };
  assert.equal(await getManifest(hub.name, hub.version, fetcher), null);
  assert.equal((await getManifest(hub.name, hub.version, fetcher)).dist.integrity, integrity);
  assert.notEqual(requests[0].url, requests[1].url);
  assert.equal(new URL(requests[0].url).pathname, '/%40zaimokuza%2Fdsh-plugin-hub/0.2.0');
  assert.equal(requests[1].options.headers['cache-control'], 'no-cache');
  await assert.rejects(getManifest(hub.name, hub.version, async () => new Response(null, { status: 503 })), /HTTP 503/);
});

test('release plan skips identical published artifacts and rejects conflicting or modified artifacts', async () => {
  const published = { ...io, getManifest: async () => ({ dist: { integrity } }) };
  assert.equal((await releasePlan([hub], published))[0].published, true);
  await assert.rejects(releasePlan([hub], { ...io, getManifest: async () => ({ dist: { integrity: 'different' } }) }), /different contents/);
  await assert.rejects(releasePlan([hub], { ...io, readTarball: async () => Buffer.from('modified') }), /integrity mismatch/);
});

test('release plan requires exactly one Hub artifact and rejects unsafe paths', async () => {
  assert.equal((await releasePlan([hub], io)).length, 1);
  await assert.rejects(releasePlan([], io), /Expected one/);
  await assert.rejects(releasePlan([hub, hub], io), /Expected one/);
  await assert.rejects(releasePlan([{ ...hub, name: '@zaimokuza/unrelated' }], io), /Invalid release manifest/);
  await assert.rejects(releasePlan([{ ...hub, filename: '../other.tgz' }], io), /Invalid release manifest/);
});
