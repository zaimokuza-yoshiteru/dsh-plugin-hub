import z from '@deepseek-ai/schemastery';

// A small synthetic host contract. Real DSH schemas are covered by verify:native.
export function hostSchema(extra = {}) {
  const shared = { serverName: z.string().required().pattern(/^[A-Za-z0-9_-]{1,32}$/),
    toolCallTimeoutMs: z.number().default(60000), failOnStartupError: z.boolean().default(false),
    reconnect: z.object({ enabled: z.boolean().default(true), initialDelayMs: z.number(), maxDelayMs: z.number(), maxAttempts: z.number() }), ...extra };
  return z.union([
    z.object({ ...shared, transport: z.const('stdio'), command: z.string().required(), args: z.array(String).default([]), env: z.dict(String).default({}), cwd: z.string().default('') }),
    z.object({ ...shared, transport: z.const('streamable-http'), url: z.string().required(), headers: z.dict(String).default({}) }),
  ]);
}
