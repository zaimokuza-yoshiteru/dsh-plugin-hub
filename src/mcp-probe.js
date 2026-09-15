import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const safeIcon = value => { try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password && !url.search ? url.href : null; } catch { return null; } };

/** A bounded, independent observation, never the host's live connection state. */
export async function probeMcp(config, { signal, timeoutMs = 15000 } = {}) {
  const abort = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(timeoutMs)]);
  const started = Date.now();
  const client = new Client({ name: 'dsh-plugin-hub-probe', version: '1.0.0' }, {
    capabilities: {}, versionNegotiation: { mode: 'auto' },
  });
  let transport;
  let onAbort;
  try {
    abort.throwIfAborted();
    transport = config.transport === 'stdio' ? new StdioClientTransport({ command: config.command, args: config.args,
      env: { ...Object.fromEntries(['PATH', 'HOME', 'USERPROFILE', 'SystemRoot', 'TMPDIR', 'TEMP', 'LANG'].filter(k => process.env[k]).map(k => [k, process.env[k]])), ...config.env },
      cwd: config.cwd || undefined, stderr: 'ignore',
    }) : new StreamableHTTPClientTransport(new URL(config.url), { requestInit: { headers: config.headers } });
    const cancellation = new Promise((_, reject) => {
      onAbort = () => { reject(abort.reason); };
      abort.addEventListener('abort', onAbort, { once: true });
    });
    const result = await Promise.race([(async () => {
      await client.connect(transport, { signal: abort, timeout: timeoutMs });
      abort.throwIfAborted();
      // Match the host's instruction budget when its schema supplies one. Older
      // hosts omit this option; the independent probe must not invent a limit.
      const instructions = client.getInstructions();
      if (instructions && config.maxInstructionBytes !== undefined &&
        Buffer.byteLength(`### MCP server: ${config.serverName}\n\n${instructions}`) > config.maxInstructionBytes) {
        throw new Error('MCP server instructions exceed the host limit');
      }
      // SDK owns pagination and supports resource-only servers with zero tools.
      const { tools } = client.getServerCapabilities()?.tools ? await client.listTools(undefined, { signal: abort, timeout: timeoutMs }) : { tools: [] };
      const info = client.getServerVersion();
      const capabilities = client.getServerCapabilities();
      return { status: 'success', tools: tools.length, version: info?.version ?? null,
        icon: safeIcon(info?.icons?.[0]?.src), description: String(info?.description ?? '').slice(0, 8000),
        capabilities: { tools: Boolean(capabilities?.tools), resources: Boolean(capabilities?.resources), prompts: Boolean(capabilities?.prompts) },
      };
    })(), cancellation]);
    return { ...result, durationMs: Date.now() - started, at: new Date().toISOString() };
  } catch {
    return { status: 'failed', durationMs: Date.now() - started, at: new Date().toISOString() };
  } finally {
    if (onAbort) abort.removeEventListener('abort', onAbort);
    // During negotiation the transport (and its probe sibling) may not yet be
    // attached to Client. Both owners must be closed on cancellation/failure.
    await Promise.allSettled([client.close(), transport?.close()]);
  }
}
