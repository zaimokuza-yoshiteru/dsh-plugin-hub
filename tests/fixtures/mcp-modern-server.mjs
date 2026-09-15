import { appendFileSync } from 'node:fs';
import { Server } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';

const [mode, log] = process.argv.slice(2);
const record = event => { if (log) appendFileSync(log, JSON.stringify({ pid: process.pid, event }) + '\n'); };
record('start');
if (mode === 'silent') {
  process.stdin.resume();
  setInterval(() => {}, 1000);
} else {
  const resourcesOnly = mode === 'resources';
  const server = new Server({ name: 'modern-fixture', version: '2.0.0' }, {
    supportedProtocolVersions: ['2026-07-28'],
    instructions: 'These are model instructions, not a card description.',
    capabilities: resourcesOnly ? { resources: {} } : { tools: {} },
  });
  if (resourcesOnly) {
    server.setRequestHandler('resources/list', async () => { record('resources/list'); return { resources: [] }; });
    server.setRequestHandler('resources/templates/list', async () => ({ resourceTemplates: [] }));
    server.setRequestHandler('resources/read', async () => { record('resources/read'); return { contents: [] }; });
  } else {
    server.setRequestHandler('tools/list', async params => {
      record('tools/list');
      if (mode === 'hang-tools') return new Promise(() => {});
      return { tools: [{ name: params?.cursor ? 'second' : 'first', inputSchema: { type: 'object' } }], ...(!params?.cursor ? { nextCursor: 'page-2' } : {}) };
    });
    server.setRequestHandler('tools/call', async () => { record('tools/call'); throw new Error('Probe must not execute tools'); });
  }
  await server.connect(new StdioServerTransport());
}
