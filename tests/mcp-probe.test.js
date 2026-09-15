import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as pause } from 'node:timers/promises';
import { createServer } from 'node:http';
import { McpServer, createMcpHandler } from '@modelcontextprotocol/server';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { probeMcp } from '../src/mcp-probe.js';

const fixture = fileURLToPath(new URL('./fixtures/mcp-modern-server.mjs', import.meta.url));
const legacy = fileURLToPath(new URL('./fixtures/mcp-server.mjs', import.meta.url));
const config = args => ({ transport: 'stdio', command: process.execPath, args });
async function records(path) { return (await readFile(path, 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line)); }
function alive(pid) { try { process.kill(pid, 0); return true; } catch { return false; } }
async function observed(t, mode) {
  const directory = await mkdtemp(join(tmpdir(), 'hub-probe-'));
  const log = join(directory, 'events.jsonl');
  t.after(async () => {
    // Assert process ownership even on failure, then clean up any regression.
    const pids = [...new Set((await records(log)).map(row => row.pid))];
    for (let attempt = 0; attempt < 40 && pids.some(alive); attempt++) await pause(50);
    try { assert.deepEqual(pids.filter(alive), [], 'all probe/serving processes must exit'); }
    finally { for (const pid of pids.filter(alive)) process.kill(pid, 'SIGKILL'); await rm(directory, { recursive: true, force: true }); }
  });
  return { log, config: config([fixture, mode, log]) };
}

test('modern-only stdio negotiation aggregates pages and never uses instructions as description', async t => {
  const input = await observed(t, 'tools');
  const result = await probeMcp(input.config);
  assert.equal(result.status, 'success'); assert.equal(result.tools, 2);
  assert.equal(result.version, '2.0.0'); assert.equal(result.description, '');
  const events = await records(input.log);
  assert.equal(events.filter(row => row.event === 'tools/list').length, 2);
  assert(!events.some(row => row.event === 'tools/call'));
});

test('resource-only servers pass without listing/reading resources or calling tools', async t => {
  const input = await observed(t, 'resources');
  const result = await probeMcp(input.config);
  assert.equal(result.status, 'success'); assert.equal(result.tools, 0);
  assert.equal(result.capabilities.resources, true);
  assert((await records(input.log)).every(row => row.event === 'start'));
});

test('a host instruction limit can reject a connected server without using its instructions as description', async t => {
  const input = await observed(t, 'resources');
  const result = await probeMcp({ ...input.config, serverName: 'limited', maxInstructionBytes: 10 });
  assert.equal(result.status, 'failed');
  assert.doesNotMatch(JSON.stringify(result), /model instructions/);
});

test('SDK 1 servers still connect through legacy fallback', async () => {
  const result = await probeMcp(config([legacy]));
  assert.equal(result.status, 'success'); assert.equal(result.tools, 1);
  assert.equal(result.version, '1.0.0'); assert(result.description);
});

test('cancelling discovery closes the negotiating child; pre-cancelled tests spawn nothing', async t => {
  const input = await observed(t, 'silent');
  const controller = new AbortController();
  const pending = probeMcp(input.config, { signal: controller.signal });
  for (let attempt = 0; attempt < 100 && !(await records(input.log)).length; attempt++) await pause(25);
  assert((await records(input.log)).length);
  controller.abort();
  assert.equal((await pending).status, 'failed');
  const count = (await records(input.log)).length;
  assert.equal((await probeMcp(input.config, { signal: controller.signal })).status, 'failed');
  assert.equal((await records(input.log)).length, count);
});

test('timeout after handshake closes the serving process', async t => {
  const input = await observed(t, 'hang-tools');
  assert.equal((await probeMcp(input.config, { timeoutMs: 2000 })).status, 'failed');
  assert((await records(input.log)).some(row => row.event === 'tools/list'));
});

test('Streamable HTTP uses modern negotiation and configured headers', async t => {
  const handler = createMcpHandler(() => {
    const mcp = new McpServer({ name: 'http-fixture', version: '2.0.0', description: 'HTTP fixture' }, { supportedProtocolVersions: ['2026-07-28'] });
    mcp.registerTool('fixture', { description: 'Never executed' }, async () => { assert.fail('must not execute'); });
    return mcp;
  }, { legacy: 'reject' });
  const handle = toNodeHandler(handler);
  let authenticated = 0;
  const server = createServer((req, res) => {
    if (req.headers.authorization !== 'Bearer fixture') { res.writeHead(403).end(); return; }
    authenticated++;
    handle(req, res).catch(() => { if (!res.headersSent) res.writeHead(500); res.end(); });
  });
  t.after(async () => { await handler.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const result = await probeMcp({ transport: 'streamable-http', url: `http://127.0.0.1:${server.address().port}/mcp`, headers: { Authorization: 'Bearer fixture' } });
  assert.equal(result.status, 'success'); assert.equal(result.tools, 1); assert(authenticated >= 2);
  assert.doesNotMatch(JSON.stringify(result), /Bearer fixture/);
});
