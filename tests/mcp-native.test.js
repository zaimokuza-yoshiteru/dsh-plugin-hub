import test from 'node:test';
import assert from 'node:assert/strict';
import z from '@deepseek-ai/schemastery';
import { validateNativeMcp, mcpSchemaFields, NativeMcp } from '../src/mcp-native.js';
import { hostSchema } from './fixtures/mcp-schema.js';

test('validation and help follow the current host, including new fields and defaults', () => {
  const old = hostSchema();
  const current = hostSchema({ maxInstructionBytes: z.number().step(1).min(1).default(32768),
    futureOption: z.boolean().default(true) });
  const raw = { serverName: 'test', transport: 'stdio', command: 'node', maxInstructionBytes: 40000, futureOption: false };
  const original = structuredClone(raw);
  assert.equal(validateNativeMcp(current, raw).maxInstructionBytes, 40000);
  assert.equal(validateNativeMcp(current, raw).futureOption, false);
  assert.deepEqual(raw, original); // Schema defaults must never change editor text.
  assert.throws(() => validateNativeMcp(old, raw), /不支持的字段/);
  assert.throws(() => validateNativeMcp(current, { ...raw, maxInstructionBytes: 0 }), /字段类型/);
  assert.throws(() => validateNativeMcp(current, { ...raw, maxInstructionBytes: 1.5 }), /字段类型/);
  assert.throws(() => validateNativeMcp(current, { ...raw, reconnect: { enabeld: true } }), /不支持的字段/);
  const fields = mcpSchemaFields(current);
  assert.equal(fields.find(f => f.key === 'maxInstructionBytes').default, 32768);
  assert.equal(fields.find(f => f.key === 'futureOption').default, true);
  assert.deepEqual(fields.find(f => f.key === 'command').transports, ['stdio']);
  assert.equal(fields.find(f => f.key === 'reconnect.enabled').default, true);
  assert(!mcpSchemaFields(old).some(f => f.key === 'maxInstructionBytes'));
});

test('schema errors do not echo credentials; absent host APIs fail explicitly and can recover', async () => {
  assert.throws(() => validateNativeMcp(hostSchema(), { serverName: 'test', transport: 'stdio', command: 'node', env: { TOKEN: { secret: 'private' } } }), error => !error.message.includes('private'));
  let module = {};
  const native = new NativeMcp({ import: async () => module });
  await assert.rejects(native.fields(), /未提供/);
  module = { Config: hostSchema() };
  assert((await native.fields()).length > 0);
});
