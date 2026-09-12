import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMcpDocument, formatMcpDocument } from '../src/mcp-config.js';
import { validateMcp } from '../src/resources.js';
test('agent JSON and native YAML convert without dropping supported connection fields', () => {
 const input = { mcpServers: { sample: { type: 'http', url: 'https://example.test/mcp?token=secret', headers: { Authorization: 'Bearer secret' }, reconnect: { enabled: true, maxAttempts: 5 } } } };
 const config = validateMcp(parseMcpDocument(JSON.stringify(input)));
 assert.equal(config.serverName, 'sample'); assert.equal(config.transport, 'streamable-http');
 assert.deepEqual(parseMcpDocument(formatMcpDocument(config, 'yaml')), config);
 const entry = `name: '@deepseek-ai/dsh-mcp-client'\nconfig:\n  serverName: sample\n  command: node\n  args: [server.mjs]\n`;
 assert.equal(validateMcp(parseMcpDocument(entry)).args[0], 'server.mjs');
});
test('ambiguous, unsupported or malformed configuration is rejected without echoing secrets', () => {
 for (const text of ['x: &value secret\ny: *value', 'serverName: secret\nserverName: duplicated', '{"mcpServers":{"one":{},"two":{}}}']) assert.throws(() => parseMcpDocument(text), error => !error.message.includes('secret'));
 assert.throws(() => validateMcp(parseMcpDocument('{"serverName":"x","command":"node","invented":"secret"}')), /不支持/);
 assert.throws(() => validateMcp(parseMcpDocument('{"serverName":"x","type":"sse","url":"https://example.test"}')), /协议/);
 assert.throws(() => validateMcp({ serverName: 'x', transport: 'stdio', command: 'node', reconnect: { initialDelayMs: 2000, maxDelayMs: 1000 } }), /间隔/);
});

test('format switches preserve minimal documents and credential references without expanding defaults', async () => {
 const { parseConfigText, resolveEnvironment } = await import('../src/mcp-config.js');
 const minimal = { mcpServers: { example: { command: 'node', env: { TOKEN: { __jsExpr: 'process.env.MCP_TOKEN' } } } } };
 const yaml = formatMcpDocument(minimal, 'yaml');
 assert.match(yaml, /!!js/);
 const back = parseConfigText(yaml);
 assert.deepEqual(back, minimal);
 assert.deepEqual(parseConfigText(formatMcpDocument(back, 'json')), minimal);
 assert.equal(resolveEnvironment(back, { MCP_TOKEN: 'secret-value' }).mcpServers.example.env.TOKEN, 'secret-value');
 assert.doesNotMatch(yaml, /secret-value|toolCallTimeoutMs|failOnStartupError/);
 assert.throws(() => parseConfigText('env:\n  TOKEN: !!js process.exit()'), /JavaScript/);
 assert.throws(() => resolveEnvironment(back, {}), /MCP_TOKEN/);
});
